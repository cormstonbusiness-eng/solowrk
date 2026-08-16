import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  BookOpen,
  Check,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  SquareArrowOutUpRight,
  TriangleAlert,
  Upload,
  X
} from 'lucide-react'
import type { BusinessPlanStatus } from '@shared/types'
import {
  appendSection,
  coverage,
  parsePlan,
  replaceSection,
  wordCount,
  type PlanSection,
  type PlanSectionSpec
} from '@shared/plan'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The business plan, laid out as a plan rather than as a file.
 *
 * The document itself stays exactly what it was — markdown in the workspace,
 * openable in any editor. This page is a view of it: the sections it has, the
 * standard ones it is missing, and a way to edit one section at a time.
 *
 * One section at a time is the load-bearing decision, here and in the
 * assistant's tool. A plan is tens of thousands of characters someone wrote by
 * hand; a single edit that could replace all of it is a single edit that could
 * lose all of it.
 */
export function BusinessPlan(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const anchors = useRef(new Map<string, HTMLDivElement>())

  const { data: plan, isPending } = useQuery({
    queryKey: ['ai', 'businessPlan'],
    queryFn: () => window.solo.invoke('ai:businessPlan')
  })

  const text = plan?.preview ?? ''
  const sections = useMemo(() => parsePlan(text), [text])
  const cover = useMemo(() => coverage(sections), [sections])
  const missing = cover.filter((entry) => entry.section === null)

  const settle = (status: BusinessPlanStatus): void => {
    setError(null)
    queryClient.setQueryData(['ai', 'businessPlan'], status)
  }

  const fail = (cause: unknown): void =>
    setError(cause instanceof Error ? cause.message : 'That did not work')

  const write = useMutation({
    mutationFn: (next: string) => window.solo.invoke('ai:writeBusinessPlan', { text: next }),
    onSuccess: settle,
    onError: fail
  })

  const start = useMutation({
    mutationFn: () => window.solo.invoke('ai:startBusinessPlan'),
    onSuccess: settle,
    onError: fail
  })

  const attach = useMutation({
    mutationFn: async () => {
      const [file] = await window.solo.invoke('files:pick', { multiple: false })
      if (!file) return null
      return window.solo.invoke('ai:attachBusinessPlan', { sourcePath: file })
    },
    onSuccess: (status) => status && settle(status),
    onError: fail
  })

  const jumpTo = (heading: string): void => {
    anchors.current.get(heading)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Save one section back into the document, leaving the rest untouched. */
  const saveSection = (section: PlanSection, body: string): void => {
    const next = replaceSection(text, section.heading, body)
    if (next === null) {
      setError(`Could not find “${section.heading}” in the file any more. Reopen the page.`)
      return
    }
    write.mutate(next)
    setEditing(null)
  }

  /** Add a standard section that is not there yet, and open it for writing. */
  const addSection = (spec: PlanSectionSpec): void => {
    write.mutate(appendSection(text, spec.title, ''), {
      onSuccess: (status) => {
        settle(status)
        setEditing(spec.title)
        // After the query data lands, so the card exists to scroll to.
        window.setTimeout(() => jumpTo(spec.title), 60)
      }
    })
  }

  const attached = plan !== undefined && plan.file !== ''

  return (
    <Page
      title="Business plan"
      description="The standing brief for your business — yours to follow, and what the assistant reads before every answer."
      actions={
        attached && (
          <>
            <Button variant="ghost" onClick={() => navigate('/assistant')}>
              <Sparkles size={14} strokeWidth={1.75} />
              Ask the assistant
            </Button>
            <Button variant="ghost" onClick={() => void window.solo.invoke('ai:openBusinessPlan')}>
              <SquareArrowOutUpRight size={14} strokeWidth={1.75} />
              Open file
            </Button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5">
          <TriangleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0 text-danger" />
          <p className="text-[12px] leading-relaxed text-ink">{error}</p>
        </div>
      )}

      {isPending ? null : !attached ? (
        <Empty
          icon={BookOpen}
          title="No business plan yet"
          body="Start one from a standard outline and fill it in as you go, or attach the plan you already have. Either way it becomes the brief the assistant works from."
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
                <Plus size={14} strokeWidth={1.75} />
                {start.isPending ? 'Starting…' : 'Start a plan'}
              </Button>
              <Button variant="ghost" onClick={() => attach.mutate()} disabled={attach.isPending}>
                <Upload size={14} strokeWidth={1.75} />
                {attach.isPending ? 'Reading…' : 'Attach a document'}
              </Button>
            </div>
          }
        />
      ) : (
        <div className="flex gap-5">
          <Contents
            sections={sections}
            missing={missing}
            onJump={jumpTo}
            onAdd={plan.editable ? addSection : undefined}
          />

          <div className="min-w-0 flex-1">
            <Summary plan={plan} sections={sections} missing={missing.length} />

            {!plan.editable && (
              <ReadOnlyNotice
                name={plan.name}
                onConvert={() => start.mutate()}
                busy={start.isPending}
              />
            )}

            <div className="flex flex-col gap-3">
              {sections.map((section) => (
                <SectionCard
                  key={`${section.heading}-${section.level}`}
                  section={section}
                  editable={plan.editable}
                  editing={editing === section.heading}
                  onEdit={() => setEditing(section.heading)}
                  onCancel={() => setEditing(null)}
                  onSave={(body) => saveSection(section, body)}
                  saving={write.isPending}
                  anchor={(node) => {
                    if (node) anchors.current.set(section.heading, node)
                    else anchors.current.delete(section.heading)
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

/** The outline down the side: what the plan has, then what it is missing. */
function Contents({
  sections,
  missing,
  onJump,
  onAdd
}: {
  sections: PlanSection[]
  missing: { spec: PlanSectionSpec }[]
  onJump: (heading: string) => void
  onAdd?: (spec: PlanSectionSpec) => void
}): React.JSX.Element {
  return (
    <aside className="sticky top-0 hidden w-[196px] shrink-0 self-start lg:block">
      <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.1em] text-faint uppercase">
        Contents
      </p>
      <div className="flex flex-col gap-0.5">
        {sections.map((section) => (
          <button
            key={`${section.heading}-${section.level}`}
            type="button"
            onClick={() => onJump(section.heading)}
            className={cn(
              'truncate rounded-control px-2 py-1.5 text-left text-[12px] text-muted',
              'transition-colors hover:bg-raised hover:text-ink',
              // Subheadings step in, so the shape of the plan is visible here.
              section.level >= 3 && 'pl-5 text-[11.5px]'
            )}
          >
            {section.heading}
          </button>
        ))}
      </div>

      {missing.length > 0 && (
        <>
          <p className="mt-4 px-2 pb-1.5 text-[10px] font-medium tracking-[0.1em] text-faint uppercase">
            Not covered yet
          </p>
          <div className="flex flex-col gap-0.5">
            {missing.map(({ spec }) => (
              <button
                key={spec.key}
                type="button"
                onClick={() => onAdd?.(spec)}
                disabled={!onAdd}
                title={onAdd ? `Add a ${spec.title} section` : spec.hint}
                className={cn(
                  'group flex items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-[12px] text-faint',
                  onAdd && 'transition-colors hover:bg-raised hover:text-ink'
                )}
              >
                {onAdd && (
                  <Plus
                    size={11}
                    strokeWidth={2}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                )}
                <span className="truncate">{spec.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}

/** The one-line state of the document, above the plan itself. */
function Summary({
  plan,
  sections,
  missing
}: {
  plan: BusinessPlanStatus
  sections: PlanSection[]
  missing: number
}): React.JSX.Element {
  const words = wordCount(plan.preview)
  const covered = coverage(sections).length - missing

  return (
    <div className="mb-4 flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3">
      <FileText size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-ink">{plan.name}</p>
        <p className="mt-0.5 text-[11px] text-faint">
          {words.toLocaleString('en-GB')} words · {sections.length} section
          {sections.length === 1 ? '' : 's'} · {covered} of {covered + missing} standard sections
          covered
          {plan.readAt && ` · saved ${formatDate(plan.readAt)}`}
        </p>
      </div>
      {plan.truncated && (
        <span className="shrink-0 rounded-control bg-warning/12 px-2 py-1 text-[10.5px] text-warning">
          Too long to send in full
        </span>
      )}
    </div>
  )
}

/**
 * Shown for a PDF or Word plan.
 *
 * Offering an editable copy rather than converting quietly: the original stays
 * exactly where it is, and swapping which document is the real one is the
 * user's decision to make.
 */
function ReadOnlyNotice({
  name,
  onConvert,
  busy
}: {
  name: string
  onConvert: () => void
  busy: boolean
}): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-card border border-line bg-raised px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-ink">Read-only</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
          SoloWrk can read {name} but not write to it, so nothing here can be edited — by you
          or the assistant. An editable copy carries all of this text into a markdown file and
          uses that instead. {name} stays where it is.
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onConvert} disabled={busy}>
        {busy ? 'Copying…' : 'Make an editable copy'}
      </Button>
    </div>
  )
}

const HEADING_SIZES: Record<number, string> = {
  0: 'text-[14px]',
  1: 'text-[15px]',
  2: 'text-[14px]',
  3: 'text-[12.5px]',
  4: 'text-[12.5px]'
}

function SectionCard({
  section,
  editable,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  anchor
}: {
  section: PlanSection
  editable: boolean
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (body: string) => void
  saving: boolean
  anchor: (node: HTMLDivElement | null) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(section.body)
  const empty = section.body.trim() === ''

  return (
    <div
      ref={anchor}
      className={cn(
        'scroll-mt-3 rounded-card border bg-surface px-4 py-3.5 transition-colors',
        editing ? 'border-accent/50' : 'border-line'
      )}
    >
      <div className="mb-2 flex items-center gap-3">
        <h2
          className={cn(
            'min-w-0 flex-1 truncate font-medium text-ink',
            HEADING_SIZES[section.level] ?? 'text-[13px]'
          )}
        >
          {section.heading}
        </h2>

        {!editing && !empty && (
          <span className="shrink-0 text-[10.5px] text-faint">
            {wordCount(section.body).toLocaleString('en-GB')} words
          </span>
        )}

        {editable &&
          (editing ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                <X size={13} strokeWidth={1.75} />
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSave(draft)}
                disabled={saving}
              >
                <Check size={13} strokeWidth={2} />
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              aria-label={`Edit ${section.heading}`}
              onClick={() => {
                setDraft(section.body)
                onEdit()
              }}
              className="shrink-0 rounded-control p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
            >
              <Pencil size={13} strokeWidth={1.75} />
            </button>
          ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.textarea
            key="edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck
            rows={Math.max(6, draft.split('\n').length + 2)}
            placeholder="Write this section…"
            className="w-full resize-y rounded-control border border-line bg-ground/40 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink focus:border-accent/60 focus:outline-none"
          />
        ) : (
          <motion.div key="read" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {empty ? (
              <p className="text-[12px] text-faint italic">
                Nothing written here yet.
                {editable && ' Use the pencil, or ask the assistant to draft it.'}
              </p>
            ) : (
              <Markdown text={section.body} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Just enough markdown for a business plan: paragraphs, bullets, numbered
 * lists and bold.
 *
 * A full markdown library would be a dependency, a bundle and an HTML-injection
 * question, for a document that is mostly prose. Anything not handled falls
 * through as its own text rather than disappearing, which is the property that
 * matters — nothing the user wrote is ever invisible on this page.
 */
function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks: React.JSX.Element[] = []
  const lines = text.split('\n')

  let index = 0
  while (index < lines.length) {
    const line = lines[index]!

    if (line.trim() === '') {
      index++
      continue
    }

    const bullet = /^\s*([-*+]|\d+[.)])\s+/
    if (bullet.test(line)) {
      const items: string[] = []
      const numbered = /^\s*\d/.test(line)

      while (index < lines.length && bullet.test(lines[index]!)) {
        items.push(lines[index]!.replace(bullet, ''))
        index++
      }

      const List = numbered ? 'ol' : 'ul'
      blocks.push(
        <List
          key={blocks.length}
          className={cn(
            'mb-2 flex list-outside flex-col gap-1 pl-4 text-[12.5px] leading-relaxed text-muted',
            numbered ? 'list-decimal' : 'list-disc'
          )}
        >
          {items.map((item, position) => (
            <li key={position}>
              <Inline text={item} />
            </li>
          ))}
        </List>
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index]!.trim() !== '' && !bullet.test(lines[index]!)) {
      paragraph.push(lines[index]!)
      index++
    }

    blocks.push(
      <p key={blocks.length} className="mb-2 text-[12.5px] leading-relaxed text-muted">
        <Inline text={paragraph.join(' ')} />
      </p>
    )
  }

  return <div className="[&>*:last-child]:mb-0">{blocks}</div>
}

/** `**bold**` only, split rather than injected as HTML. */
function Inline({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={index} className="font-medium text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </>
  )
}
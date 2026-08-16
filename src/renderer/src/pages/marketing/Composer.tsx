import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, ImagePlus, Send, Trash2, X } from 'lucide-react'
import type { PostInput, PostWithContext } from '@shared/types'
import type { Platform } from '@shared/social'
import { PLATFORMS, PLATFORM_LIST, countHashtags, validateTarget } from '@shared/social'
import { dayOf, timeOf } from '@shared/calendar'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { keys, useInvalidate } from '@/lib/api'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface Draft {
  title: string
  body: string
  linkUrl: string
  notes: string
  campaignId: number | null
  pillarId: number | null
  day: string
  time: string
  scheduled: boolean
  evergreenDays: number | null
  platforms: Platform[]
  /** Per-platform overrides, empty when the shared body is used unchanged. */
  overrides: Partial<Record<Platform, string>>
  boards: Partial<Record<Platform, string>>
  media: { file: string; altText: string; name: string }[]
}

const EVERGREEN_CHOICES = [
  { value: 30, label: 'Every month' },
  { value: 90, label: 'Every quarter' },
  { value: 180, label: 'Every 6 months' },
  { value: 365, label: 'Every year' }
]

function toDraft(post: PostWithContext | null, defaults: Partial<Draft>): Draft {
  if (!post) {
    return {
      title: '',
      body: '',
      linkUrl: '',
      notes: '',
      campaignId: null,
      pillarId: null,
      day: defaults.day ?? '',
      time: defaults.time ?? '09:00',
      scheduled: defaults.scheduled ?? true,
      evergreenDays: null,
      platforms: defaults.platforms ?? ['linkedin'],
      overrides: {},
      boards: {},
      media: []
    }
  }

  const overrides: Partial<Record<Platform, string>> = {}
  const boards: Partial<Record<Platform, string>> = {}
  for (const target of post.targets) {
    if (target.body !== '') overrides[target.platform] = target.body
    if (target.boardId) boards[target.platform] = target.boardId
  }

  return {
    title: post.title,
    body: post.body,
    linkUrl: post.linkUrl,
    notes: post.notes,
    campaignId: post.campaignId,
    pillarId: post.pillarId,
    day: post.scheduledAt ? dayOf(post.scheduledAt) : '',
    time: post.scheduledAt ? timeOf(post.scheduledAt) : '09:00',
    scheduled: post.scheduledAt !== null,
    evergreenDays: post.evergreenDays,
    platforms: post.targets.map((target) => target.platform),
    overrides,
    boards,
    media: post.media.map((item) => ({
      file: item.file,
      altText: item.altText,
      name: item.file.split('\\').pop() ?? item.file
    }))
  }
}

/**
 * One idea, many destinations.
 *
 * The shared body is what you write; a per-platform override is what you write
 * *instead* when a platform needs something different. Keeping the override
 * empty rather than copying the body means editing the main text still reaches
 * every platform you have not deliberately diverged.
 */
export function Composer({
  open,
  post,
  defaults,
  onClose
}: {
  open: boolean
  post: PostWithContext | null
  defaults?: Partial<Draft>
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<Draft>(() => toDraft(post, defaults ?? {}))
  const [active, setActive] = useState<Platform>('linkedin')

  useEffect(() => {
    if (!open) return
    const next = toDraft(post, defaults ?? {})
    setDraft(next)
    setActive(next.platforms[0] ?? 'linkedin')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.id])

  const { data: campaigns = [] } = useQuery({
    queryKey: keys.campaigns,
    queryFn: () => window.solo.invoke('marketing:campaigns'),
    enabled: open
  })

  const { data: pillars = [] } = useQuery({
    queryKey: keys.pillars,
    queryFn: () => window.solo.invoke('marketing:pillars'),
    enabled: open
  })

  const { data: accounts = [] } = useQuery({
    queryKey: keys.accounts,
    queryFn: () => window.solo.invoke('social:accounts'),
    enabled: open
  })

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  const bodyFor = (platform: Platform): string => draft.overrides[platform] ?? draft.body

  const problems = useMemo(
    () =>
      Object.fromEntries(
        draft.platforms.map((platform) => [
          platform,
          validateTarget(platform, {
            body: bodyFor(platform),
            title: draft.title,
            media: draft.media.map((item) => item.name),
            boardId: draft.boards[platform] ?? null,
            connected: accounts.some(
              (account) => account.platform === platform && account.status === 'connected'
            )
          })
        ])
      ) as Record<Platform, ReturnType<typeof validateTarget>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, accounts]
  )

  const blocked = Object.values(problems).some((list) =>
    list.some((problem) => problem.level === 'error')
  )

  const toInput = (): PostInput => ({
    title: draft.title.trim(),
    body: draft.body,
    linkUrl: draft.linkUrl,
    notes: draft.notes,
    campaignId: draft.campaignId,
    pillarId: draft.pillarId,
    scheduledAt: draft.scheduled && draft.day ? `${draft.day}T${draft.time}` : null,
    evergreenDays: draft.evergreenDays,
    targets: draft.platforms.map((platform) => ({
      platform,
      accountId:
        accounts.find(
          (account) => account.platform === platform && account.status === 'connected'
        )?.id ?? null,
      body: draft.overrides[platform] ?? '',
      title: platform === 'pinterest' ? draft.title : '',
      boardId: draft.boards[platform] ?? null
    })),
    media: draft.media.map((item) => ({ file: item.file, altText: item.altText }))
  })

  const save = useMutation({
    mutationFn: () =>
      post
        ? window.solo.invoke('marketing:updatePost', { id: post.id, patch: toInput() })
        : window.solo.invoke('marketing:createPost', toInput()),
    onSuccess: () => {
      invalidate(['marketing'])
      onClose()
    }
  })

  const remove = useMutation({
    mutationFn: () => window.solo.invoke('marketing:deletePost', { id: post?.id ?? 0 }),
    onSuccess: () => {
      invalidate(['marketing'])
      onClose()
    }
  })

  async function addMedia(): Promise<void> {
    const files = await window.solo.invoke('files:pick', { multiple: true })
    setDraft((current) => ({
      ...current,
      media: [
        ...current.media,
        ...files.map((file) => ({
          file,
          altText: '',
          name: file.split('\\').pop() ?? file
        }))
      ]
    }))
  }

  const activeProblems = problems[active] ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={post ? 'Edit post' : 'New post'}
      description={
        draft.scheduled && draft.day
          ? undefined
          : 'With no date this stays in the backlog until you schedule it.'
      }
      width={720}
      footer={
        <>
          {post && (
            <Button variant="danger" onClick={() => remove.mutate()} className="mr-auto">
              <Trash2 size={13} strokeWidth={1.75} />
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={blocked}>
            <Send size={13} strokeWidth={1.75} />
            {draft.scheduled && draft.day ? 'Schedule' : 'Save to backlog'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Internal name" hint="Just for you — never posted.">
          <TextInput
            autoFocus
            value={draft.title}
            onChange={(event) => update('title', event.target.value)}
            placeholder="Case study — Acme rebrand"
          />
        </Field>

        {/* Destinations */}
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted">Post to</p>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORM_LIST.map((spec) => {
              const on = draft.platforms.includes(spec.id)
              const connected = accounts.some(
                (account) => account.platform === spec.id && account.status === 'connected'
              )

              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? draft.platforms.filter((platform) => platform !== spec.id)
                      : [...draft.platforms, spec.id]
                    update('platforms', next)
                    if (!on) setActive(spec.id)
                    else if (active === spec.id) setActive(next[0] ?? 'linkedin')
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                    on
                      ? 'border-line-strong bg-raised text-ink'
                      : 'border-line text-faint hover:text-muted'
                  )}
                >
                  <span
                    style={{ backgroundColor: on ? spec.colour : '#3a3a40' }}
                    className="h-2 w-2 rounded-full"
                  />
                  {spec.label}
                  {on && !connected && (
                    <span className="text-[10px] text-faint" title="Not connected — you will post this one by hand">
                      manual
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <Field label="Post">
          <textarea
            rows={6}
            value={draft.body}
            onChange={(event) => update('body', event.target.value)}
            className="w-full resize-none rounded-control border border-line bg-raised px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
            placeholder="What are you saying?"
          />
        </Field>

        {/* Per-platform tabs, counts and problems */}
        {draft.platforms.length > 0 && (
          <div className="rounded-card border border-line">
            <div className="flex items-center gap-0.5 border-b border-line p-1">
              {draft.platforms.map((platform) => {
                const spec = PLATFORMS[platform]
                const hasError = (problems[platform] ?? []).some(
                  (problem) => problem.level === 'error'
                )

                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => setActive(platform)}
                    className={cn(
                      'relative flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12px] transition-colors',
                      active === platform ? 'text-ink' : 'text-muted hover:text-ink'
                    )}
                  >
                    {active === platform && (
                      <motion.span
                        layoutId="composer-platform"
                        transition={transition.layout}
                        className="absolute inset-0 rounded-[6px] bg-raised"
                      />
                    )}
                    <span className="relative">{spec.label}</span>
                    {hasError && (
                      <span className="relative h-1.5 w-1.5 rounded-full bg-danger" />
                    )}
                  </button>
                )
              })}
            </div>

            <div className="p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] text-faint">{PLATFORMS[active].note}</p>
                <span
                  className={cn(
                    'numeric shrink-0 text-[11px]',
                    bodyFor(active).length > PLATFORMS[active].bodyLimit
                      ? 'text-danger'
                      : 'text-muted'
                  )}
                >
                  {bodyFor(active).length}/{PLATFORMS[active].bodyLimit}
                  {PLATFORMS[active].hashtagLimit !== undefined &&
                    ` · ${countHashtags(bodyFor(active))}/${PLATFORMS[active].hashtagLimit} tags`}
                </span>
              </div>

              {draft.overrides[active] === undefined ? (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      overrides: { ...current.overrides, [active]: current.body }
                    }))
                  }
                  className="w-full rounded-control border border-dashed border-line px-3 py-2 text-left text-[12px] text-faint transition-colors hover:border-line-strong hover:text-muted"
                >
                  Using the shared text. Click to write something different for{' '}
                  {PLATFORMS[active].label}.
                </button>
              ) : (
                <div>
                  <textarea
                    rows={5}
                    value={draft.overrides[active] ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        overrides: { ...current.overrides, [active]: event.target.value }
                      }))
                    }
                    className="w-full resize-none rounded-control border border-line bg-raised px-3 py-2 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => {
                        const next = { ...current.overrides }
                        delete next[active]
                        return { ...current, overrides: next }
                      })
                    }
                    className="mt-1 text-[11px] text-faint transition-colors hover:text-ink"
                  >
                    Use the shared text instead
                  </button>
                </div>
              )}

              {active === 'pinterest' && (
                <Field label="Board" className="mt-3">
                  <TextInput
                    value={draft.boards.pinterest ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        boards: { ...current.boards, pinterest: event.target.value }
                      }))
                    }
                    placeholder="Board name or id"
                  />
                </Field>
              )}

              <AnimatePresence initial={false}>
                {activeProblems.length > 0 && (
                  <motion.ul
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={transition.press}
                    className="mt-2.5 flex flex-col gap-1 overflow-hidden"
                  >
                    {activeProblems.map((problem) => (
                      <li
                        key={problem.message}
                        className={cn(
                          'flex items-start gap-1.5 text-[11.5px]',
                          problem.level === 'error' ? 'text-danger' : 'text-warning'
                        )}
                      >
                        <AlertTriangle size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
                        {problem.message}
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Media */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[12px] font-medium text-muted">Images and video</p>
            <button
              type="button"
              onClick={() => void addMedia()}
              className="flex items-center gap-1 text-[11.5px] text-muted transition-colors hover:text-ink"
            >
              <ImagePlus size={12} strokeWidth={1.75} />
              Add
            </button>
          </div>

          {draft.media.length === 0 ? (
            <p className="rounded-control border border-dashed border-line px-3 py-2 text-[11.5px] text-faint">
              Nothing attached. Instagram, TikTok and Pinterest all need at least one file.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {draft.media.map((item, index) => (
                <span
                  key={`${item.file}-${index}`}
                  className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted"
                >
                  {item.name}
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      update(
                        'media',
                        draft.media.filter((_, position) => position !== index)
                      )
                    }
                    className="text-faint hover:text-danger"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* When */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
          <Field label="Date" hint="Leave empty to keep it in the backlog.">
            <TextInput
              type="date"
              value={draft.day}
              onChange={(event) => {
                update('day', event.target.value)
                update('scheduled', event.target.value !== '')
              }}
            />
          </Field>
          <Field label="Time">
            <TextInput
              type="time"
              step={900}
              value={draft.time}
              onChange={(event) => update('time', event.target.value)}
            />
          </Field>
          <Field label="Repeat" hint="Evergreen posts come back as a fresh copy.">
            <Select
              value={draft.evergreenDays}
              onChange={(value) => update('evergreenDays', value)}
              placeholder="One-off"
              options={EVERGREEN_CHOICES}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Campaign">
            <Select
              value={draft.campaignId}
              onChange={(value) => update('campaignId', value)}
              placeholder="No campaign"
              options={campaigns.map((campaign) => ({
                value: campaign.id,
                label: campaign.name
              }))}
            />
          </Field>
          <Field label="Pillar" hint="Keeps your mix honest.">
            <Select
              value={draft.pillarId}
              onChange={(value) => update('pillarId', value)}
              placeholder="No pillar"
              options={pillars.map((pillar) => ({ value: pillar.id, label: pillar.name }))}
            />
          </Field>
        </div>

        <Field label="Link">
          <TextInput
            value={draft.linkUrl}
            onChange={(event) => update('linkUrl', event.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
    </Modal>
  )
}
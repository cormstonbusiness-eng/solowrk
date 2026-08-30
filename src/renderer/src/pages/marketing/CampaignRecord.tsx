import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  Archive,
  File,
  FolderOpen,
  Plus,
  Trash2,
  Upload
} from 'lucide-react'
import type {
  CampaignInput,
  CampaignStatus,
  ContentItemWithContext,
  FileEntry,
  TaskWithContext
} from '@shared/types'
import { CAMPAIGN_STATUSES, CAMPAIGN_TYPES } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { formatMoney, formatSize } from '@/lib/format'
import { keys, useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { listItemVariants, listVariants } from '@/lib/motion'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { TaskRow } from '../tasks/TaskRow'
import { ContentDrawer } from './ContentDrawer'
import { STATUS_LABELS } from './CampaignsTab'

/**
 * One campaign, and everything it has gathered.
 *
 * The three sections are the point of the record. A campaign that only held a
 * brief and a budget would be a note; what makes it worth having is that the
 * posts, the jobs and the files for one push sit in one place, and you can see
 * what is left before the date arrives.
 *
 * Each is reached the way that kind of thing is normally reached in this app.
 * Content and tasks by a column, so they also appear on the calendar and the
 * Tasks page rather than being trapped here. Files by a real folder, so
 * anything dropped in through Explorer is simply there.
 */

const TYPE_LABELS: Record<(typeof CAMPAIGN_TYPES)[number], string> = {
  content: 'Content',
  paid_ads: 'Paid ads',
  outreach: 'Outreach',
  launch: 'Launch',
  event: 'Event',
  always_on: 'Always on'
}

export function CampaignRecord({
  id,
  onBack
}: {
  id: number
  onBack: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [openContent, setOpenContent] = useState<ContentItemWithContext | null>(null)

  const { data: campaign } = useQuery({
    queryKey: keys.campaignRecords({ id }),
    queryFn: () => window.solo.invoke('campaigns:get', { id })
  })

  const { data: work } = useQuery({
    queryKey: keys.campaignWork(id),
    queryFn: () => window.solo.invoke('campaigns:work', { id })
  })

  const { data: channels = [] } = useQuery({
    queryKey: keys.channels,
    queryFn: () => window.solo.invoke('channels:list')
  })

  const save = useMutation({
    mutationFn: (patch: CampaignInput) => window.solo.invoke('campaigns:update', { id, patch }),
    onSuccess: () => invalidate(['marketing'])
  })

  const archive = useMutation({
    mutationFn: () => window.solo.invoke('campaigns:archive', { id, archived: true }),
    onSuccess: () => {
      invalidate(['marketing'])
      onBack()
    }
  })

  if (!campaign) return <div className="flex-1" />

  const finished = campaign.status === 'complete' || campaign.status === 'abandoned'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Campaigns
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <div className="w-[128px]">
            <Select
              value={campaign.status}
              onChange={(status) => status && save.mutate({ status })}
              options={CAMPAIGN_STATUSES.map((value) => ({
                value,
                label: STATUS_LABELS[value as CampaignStatus]
              }))}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => archive.mutate()}>
            <Archive size={13} strokeWidth={1.75} />
            Archive
          </Button>
        </div>
      </div>

      <div className="flex max-w-[880px] flex-col gap-3">
        <Card className="flex flex-col gap-3 p-4">
          <AutoField
            value={campaign.name}
            onSave={(name) => save.mutate({ name })}
            placeholder="What this push is called"
            className="text-[16px] font-medium"
          />

          <AutoField
            value={campaign.objective}
            onSave={(objective) => save.mutate({ objective })}
            placeholder="What it is for. One line: two more architecture clients before Christmas."
            className="text-[13px] text-muted"
          />

          <div className="grid grid-cols-4 gap-3">
            <Field label="Type">
              <Select
                value={campaign.campaignType}
                onChange={(campaignType) => campaignType && save.mutate({ campaignType })}
                options={CAMPAIGN_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }))}
              />
            </Field>
            <Field label="Starts">
              <DateInput
                value={campaign.startsOn}
                onChange={(startsOn) => save.mutate({ startsOn })}
              />
            </Field>
            <Field label="Ends">
              <DateInput value={campaign.endsOn} onChange={(endsOn) => save.mutate({ endsOn })} />
            </Field>
            <Field label="Budget">
              <MoneyInput
                pence={campaign.budget}
                onChangePence={(budget) => save.mutate({ budget })}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-4">
          <CardHeader title="Brief" />
          <AutoText
            value={campaign.brief}
            onSave={(brief) => save.mutate({ brief })}
            placeholder="What you are doing, who for, and what it has to achieve. Written before it starts, so there is something to judge it against afterwards."
            rows={4}
          />
        </Card>

        <Posts
          campaignId={id}
          items={work?.content ?? []}
          onOpen={setOpenContent}
          onChanged={() => invalidate(['marketing'])}
        />

        <Tasks campaignId={id} tasks={work?.tasks ?? []} />

        <Readings campaignId={id} />

        <Files
          folder={campaign.folder}
          files={work?.files ?? []}
          onChanged={() => invalidate(['marketing'])}
        />

        {/*
          The retrospective appears when the campaign is over and not before.
          §5.2 puts it at completion because that is the only time it will ever
          be written — an empty box on a campaign that has not started yet is
          just a field somebody scrolls past for six weeks.
        */}
        <AnimatePresence initial={false}>
          {finished && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={transition.press}
              className="overflow-hidden"
            >
              <Card className="p-4">
                <CardHeader title="What actually happened" />
                <p className="mb-2 text-[11.5px] leading-relaxed text-faint">
                  Written once, now, while you still remember. It is the thing that stops the
                  same expensive mistake happening next year.
                </p>
                <AutoText
                  value={campaign.retrospective}
                  onSave={(retrospective) => save.mutate({ retrospective })}
                  placeholder="The ads did nothing. The newsletter did everything. Next time, spend it on the list."
                  rows={4}
                />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ContentDrawer
        item={openContent}
        channels={channels}
        onClose={() => setOpenContent(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The three things that hang off a campaign
 * ------------------------------------------------------------------ */

function Posts({
  campaignId,
  items,
  onOpen,
  onChanged
}: {
  campaignId: number
  items: ContentItemWithContext[]
  onOpen: (item: ContentItemWithContext) => void
  onChanged: () => void
}): React.JSX.Element {
  const create = useMutation({
    mutationFn: () => window.solo.invoke('content:create', { campaignId, title: '' }),
    onSuccess: (item) => {
      onChanged()
      onOpen(item)
    }
  })

  return (
    <Card className="p-4">
      <CardHeader
        title="Posts"
        action={
          <button
            type="button"
            onClick={() => create.mutate()}
            className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-ink"
          >
            <Plus size={12} strokeWidth={2} />
            Add
          </button>
        }
      />

      {items.length === 0 ? (
        <p className="text-[11.5px] text-faint">
          Nothing written for this yet. Anything you add here also appears on the calendar.
        </p>
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-1"
        >
          {items.map((item) => (
            <motion.button
              key={item.id}
              variants={listItemVariants}
              type="button"
              onClick={() => onOpen(item)}
              style={{ borderLeftColor: item.channelColour, borderLeftWidth: 3 }}
              className="flex items-center gap-2.5 rounded-control bg-raised px-2.5 py-2 text-left transition-colors hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {item.title || 'Untitled'}
              </span>
              {item.channelName !== '' && (
                <span className="shrink-0 text-[11px] text-faint">{item.channelName}</span>
              )}
              {item.scheduledFor && (
                <span className="numeric shrink-0 text-[11px] text-faint">
                  {item.scheduledFor.slice(0, 10)}
                </span>
              )}
              <span
                className={cn(
                  'w-[62px] shrink-0 text-right text-[11px]',
                  item.status === 'published' ? 'text-success' : 'text-disabled'
                )}
              >
                {item.status}
              </span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </Card>
  )
}

function Tasks({
  campaignId,
  tasks
}: {
  campaignId: number
  tasks: TaskWithContext[]
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')

  const create = useMutation({
    mutationFn: (input: { title: string }) =>
      window.solo.invoke('tasks:create', { title: input.title, campaignId }),
    onSuccess: () => {
      invalidate(['marketing', 'tasks'])
      setTitle('')
    }
  })

  const toggle = useMutation({
    mutationFn: (task: TaskWithContext) =>
      window.solo.invoke('tasks:update', {
        id: task.id,
        patch: { status: task.status === 'done' ? 'todo' : 'done' }
      }),
    onSuccess: () => invalidate(['marketing', 'tasks'])
  })

  const rename = useMutation({
    mutationFn: (input: { id: number; title: string }) =>
      window.solo.invoke('tasks:update', { id: input.id, patch: { title: input.title } }),
    onSuccess: () => invalidate(['marketing', 'tasks'])
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('tasks:update', { id, patch: { archived: true } }),
    onSuccess: () => invalidate(['marketing', 'tasks'])
  })

  return (
    <Card className="p-4">
      <CardHeader
        title="To do"
        action={
          <span className="numeric text-[11px] text-faint">
            {tasks.filter((task) => task.status === 'done').length}/{tasks.length}
          </span>
        }
      />

      {/*
        The same row the Tasks page draws, because these are the same tasks.
        A campaign task is not a checklist item that lives here — it is work,
        and it shows up wherever work shows up.
      */}
      <div className="mb-2 flex flex-col gap-1">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={() => toggle.mutate(task)}
            onOpen={() => undefined}
            onRename={(next) => rename.mutate({ id: task.id, title: next })}
            onArchive={() => remove.mutate(task.id)}
          />
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim() === '') return
          create.mutate({ title: title.trim() })
        }}
      >
        <TextInput
          value={title}
          placeholder="Book the photographer, write the landing page…"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </form>
    </Card>
  )
}

function Files({
  folder,
  files,
  onChanged
}: {
  folder: string
  files: FileEntry[]
  onChanged: () => void
}): React.JSX.Element {
  const add = useMutation({
    mutationFn: async () => {
      const sources = await window.solo.invoke('files:pick', { multiple: true })
      if (sources.length === 0) return []
      return window.solo.invoke('files:import', { destination: folder, sources })
    },
    onSuccess: () => onChanged()
  })

  return (
    <Card className="p-4">
      <CardHeader
        title="Files"
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => add.mutate()}
              className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-ink"
            >
              <Upload size={12} strokeWidth={2} />
              Add
            </button>
            <button
              type="button"
              onClick={() => void window.solo.invoke('files:reveal', { path: folder })}
              className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-ink"
            >
              <FolderOpen size={12} strokeWidth={2} />
              Open folder
            </button>
          </div>
        }
      />

      {files.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-faint">
          This campaign has a real folder in your workspace. Anything you put there — through
          SoloWrk or through Explorer — shows up here.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onDoubleClick={() => void window.solo.invoke('files:open', { path: file.path })}
              className="flex items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-raised"
            >
              <File size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{file.name}</span>
              {!file.isDirectory && (
                <span className="numeric shrink-0 text-[11px] text-faint">
                  {formatSize(file.size)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * What this campaign cost and what came back (§5.2, §8.1).
 *
 * Typed in, because nothing here can fetch it — there is no ad-platform
 * integration and there will not be. One row per reading rather than one
 * running total, so a campaign checked weekly keeps its shape rather than
 * collapsing into a single number nobody can question.
 *
 * Pro, like the rest of measurement. A Basic+ user still runs the campaign;
 * what they do not get is the reckoning.
 */
function Readings({ campaignId }: { campaignId: number }): React.JSX.Element | null {
  const invalidate = useInvalidate()
  const entitled = useFeature('marketingresults')

  const [spend, setSpend] = useState(0)
  const [enquiries, setEnquiries] = useState('')

  const { data: readings = [] } = useQuery({
    queryKey: keys.campaignMetrics(campaignId),
    queryFn: () => window.solo.invoke('metrics:campaign', { campaignId }),
    enabled: entitled
  })

  const record = useMutation({
    mutationFn: () =>
      window.solo.invoke('metrics:recordCampaign', {
        campaignId,
        reading: {
          spend: spend > 0 ? spend : null,
          // Empty stays empty. `Number('')` is 0, which would record "nobody
          // enquired" every time somebody only noted the spend.
          enquiries: enquiries.trim() === '' ? null : Number(enquiries)
        }
      }),
    onSuccess: () => {
      invalidate(['marketing'])
      setSpend(0)
      setEnquiries('')
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('metrics:deleteCampaign', { id, campaignId }),
    onSuccess: () => invalidate(['marketing'])
  })

  if (!entitled) return null

  const total = readings.reduce((sum, one) => sum + (one.spend ?? 0), 0)

  return (
    <Card className="p-4">
      <CardHeader
        title="Spend and enquiries"
        action={
          total > 0 ? (
            <span className="numeric text-[11px] text-muted">{formatMoney(total)} so far</span>
          ) : undefined
        }
      />

      {readings.length > 0 && (
        <div className="mb-2 flex flex-col gap-0.5">
          {readings.map((reading) => (
            <div
              key={reading.id}
              className="group flex items-center gap-3 rounded-control px-2 py-1.5 text-[12px] hover:bg-raised"
            >
              <span className="numeric w-[86px] shrink-0 text-faint">{reading.recordedOn}</span>
              <span className="numeric w-[80px] shrink-0 text-ink">
                {reading.spend === null ? '—' : formatMoney(reading.spend)}
              </span>
              <span className="numeric flex-1 text-muted">
                {/* An em dash, not a zero. Not having looked is not a result. */}
                {reading.enquiries === null
                  ? '—'
                  : `${reading.enquiries} ${reading.enquiries === 1 ? 'enquiry' : 'enquiries'}`}
              </span>
              <button
                type="button"
                aria-label="Delete reading"
                onClick={() => remove.mutate(reading.id)}
                className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (spend <= 0 && enquiries.trim() === '') return
          record.mutate()
        }}
      >
        <Field label="Spend" className="w-[130px]">
          <MoneyInput pence={spend} onChangePence={setSpend} />
        </Field>
        <Field label="Enquiries" className="w-[110px]">
          <TextInput
            type="number"
            min={0}
            value={enquiries}
            onChange={(event) => setEnquiries(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Field>
        <Button type="submit" variant="outline" size="sm" className="mb-0.5">
          <Plus size={13} strokeWidth={1.75} />
          Record
        </Button>
      </form>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Fields that save when you leave them
 * ------------------------------------------------------------------ */

function DateInput({
  value,
  onChange
}: {
  value: string | null
  onChange: (value: string | null) => void
}): React.JSX.Element {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      className="h-9 w-full rounded-control border border-line bg-raised px-3 text-[13px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
    />
  )
}

function AutoField({
  value,
  onSave,
  placeholder,
  className
}: {
  value: string
  onSave: (next: string) => void
  placeholder: string
  className?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() !== value.trim() && onSave(draft.trim())}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        'w-full rounded-control bg-transparent px-1 py-0.5 text-ink placeholder:text-faint',
        'transition-colors hover:bg-hover focus:bg-raised focus:outline-none',
        className
      )}
    />
  )
}

function AutoText({
  value,
  onSave,
  placeholder,
  rows
}: {
  value: string
  onSave: (next: string) => void
  placeholder: string
  rows: number
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  return (
    <textarea
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() !== value.trim() && onSave(draft.trim())}
      onKeyDown={(event) => event.stopPropagation()}
      className="w-full resize-y rounded-control border border-line bg-raised px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
    />
  )
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Trash2 } from 'lucide-react'
import type {
  ContentItemInput,
  ContentItemWithContext,
  ContentStatus,
  MarketingChannel
} from '@shared/types'
import { CONTENT_STATUSES } from '@shared/types'
import { composePost, overLimit } from '@shared/content'
import { Drawer, DrawerClose } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { keys, useInvalidate } from '@/lib/api'
import { toast } from '@/lib/celebrate'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * One piece of content, open.
 *
 * §6.2 describes four tabs. Write is here; Assets, Source and Results arrive
 * with the stages that give them something to show — an Assets tab with no
 * file picker behind it would be a promise, and a Results tab with no metrics
 * table would be an empty grid explaining that it is empty.
 *
 * Everything saves as you leave a field. The one thing that does not is the
 * status, which saves on the click, because marking something published is a
 * statement about the world rather than an edit to a draft.
 */

const STATUS_LABELS: Record<ContentStatus, string> = {
  idea: 'Idea',
  drafting: 'Drafting',
  ready: 'Ready',
  scheduled: 'Scheduled',
  published: 'Published',
  parked: 'Parked'
}

export function ContentDrawer({
  item,
  channels,
  onClose
}: {
  item: ContentItemWithContext | null
  channels: MarketingChannel[]
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()

  // Re-read while open, so a change made on the calendar behind shows here.
  const { data: fresh } = useQuery({
    queryKey: keys.content({ id: item?.id }),
    queryFn: () => window.solo.invoke('content:get', { id: item!.id }),
    enabled: item !== null,
    initialData: item ?? undefined
  })

  const current = fresh ?? item

  const save = useMutation({
    mutationFn: (patch: ContentItemInput) =>
      window.solo.invoke('content:update', { id: current!.id, patch }),
    onSuccess: () => invalidate(['marketing'])
  })

  const remove = useMutation({
    mutationFn: () => window.solo.invoke('content:delete', { id: current!.id }),
    onSuccess: () => {
      invalidate(['marketing'])
      onClose()
    }
  })

  return (
    <Drawer open={item !== null} onClose={onClose} width={520}>
      {current && (
        <Body
          item={current}
          channels={channels}
          onSave={(patch) => save.mutate(patch)}
          onDelete={() => remove.mutate()}
          onClose={onClose}
        />
      )}
    </Drawer>
  )
}

function Body({
  item,
  channels,
  onSave,
  onDelete,
  onClose
}: {
  item: ContentItemWithContext
  channels: MarketingChannel[]
  onSave: (patch: ContentItemInput) => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(item.title)
  const [hook, setHook] = useState(item.hook)
  const [body, setBody] = useState(item.body)
  const [linkPrompt, setLinkPrompt] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setTitle(item.title)
    setHook(item.hook)
    setBody(item.body)
  }, [item.id, item.title, item.hook, item.body])

  const { data: campaigns = [] } = useQuery({
    queryKey: keys.campaignRecords(),
    queryFn: () => window.solo.invoke('campaigns:list')
  })

  const channel = channels.find((one) => one.id === item.channelId)
  const composed = composePost({ hook, body })
  const limit = channel?.characterLimit ?? null
  const over = overLimit(composed, limit)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(composed)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: item.channelColour }}
        />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {title.trim() === '' ? 'Untitled' : title}
        </h2>
        <button
          type="button"
          aria-label="Delete"
          onClick={onDelete}
          className="text-faint transition-colors hover:text-danger"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
        <DrawerClose onClose={onClose} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
        <Field label="Title">
          <TextInput
            value={title}
            placeholder="What this is, for you"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => title !== item.title && onSave({ title })}
          />
        </Field>

        {/*
          The hook gets its own box because the first line decides whether
          anything else is read, and a field of its own is what makes somebody
          write it deliberately rather than type past it.
        */}
        <Field label="Hook" hint="The first line. It decides whether the rest gets read.">
          <TextInput
            value={hook}
            placeholder="Most quotes lose the job before anyone reads the price."
            onChange={(event) => setHook(event.target.value)}
            onBlur={() => hook !== item.hook && onSave({ hook })}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-medium text-muted">Body</span>
            {limit !== null && (
              <span className={cn('numeric text-[11px]', over ? 'text-danger' : 'text-faint')}>
                {composed.length} / {limit}
              </span>
            )}
          </div>
          <textarea
            rows={10}
            value={body}
            placeholder="Write it here. Nothing is posted for you — this is where it lives until you paste it."
            onChange={(event) => setBody(event.target.value)}
            onBlur={() => body !== item.body && onSave({ body })}
            onKeyDown={(event) => event.stopPropagation()}
            className={cn(
              'w-full resize-y rounded-control border border-line bg-raised px-3 py-2',
              'text-[13px] leading-relaxed text-ink placeholder:text-faint',
              'transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none',
              over && 'border-danger/50'
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Campaign" hint="Optional. A post can stand on its own.">
            <Select
              value={item.campaignId}
              placeholder="No campaign"
              onChange={(campaignId) => onSave({ campaignId })}
              options={campaigns.map((one) => ({ value: one.id, label: one.name }))}
            />
          </Field>

          <Field label="Channel">
            <Select
              value={item.channelId}
              placeholder="No channel"
              onChange={(channelId) => onSave({ channelId })}
              options={channels.map((one) => ({ value: one.id, label: one.name }))}
            />
          </Field>

          <Field label="Status">
            <Select
              value={item.status}
              onChange={(status) => {
                if (!status) return
                onSave({ status })
                // §6.3: asked once, on the way past. A URL back to the live
                // post is the only thing SoloWrk cannot work out for itself.
                if (status === 'published' && item.linkUrl === '') setLinkPrompt(true)
              }}
              options={CONTENT_STATUSES.map((value) => ({
                value,
                label: STATUS_LABELS[value]
              }))}
            />
          </Field>
        </div>

        <Field label="Scheduled for" hint="Leave it empty and this stays an idea.">
          <input
            type="datetime-local"
            value={item.scheduledFor ?? ''}
            onChange={(event) =>
              onSave({
                scheduledFor: event.target.value === '' ? null : event.target.value,
                // A date makes it scheduled; removing one sends it back to
                // being an idea. Two fields that must not disagree.
                ...(item.status === 'idea' && event.target.value !== ''
                  ? { status: 'scheduled' }
                  : {}),
                ...(event.target.value === '' && item.status === 'scheduled'
                  ? { status: 'idea' }
                  : {})
              })
            }
            className="h-9 w-full rounded-control border border-line bg-raised px-3 text-[13px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
          />
        </Field>

        <AnimatePresence initial={false}>
          {(linkPrompt || item.linkUrl !== '') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={transition.press}
              className="overflow-hidden"
            >
              <Field label="Link to the live post" hint="So you can find it again in a year.">
                <TextInput
                  autoFocus={linkPrompt && item.linkUrl === ''}
                  defaultValue={item.linkUrl}
                  placeholder="https://…"
                  onBlur={(event) => {
                    if (event.target.value !== item.linkUrl) {
                      onSave({ linkUrl: event.target.value })
                    }
                    setLinkPrompt(false)
                  }}
                />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/*
        §6.3, stated plainly rather than implied: copying to the clipboard is
        the entire publishing workflow. There is no integration, and pretending
        otherwise with a "Publish" button would be a lie with a spinner on it.
      */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="outline" size="sm" onClick={() => void copy()} disabled={composed === ''}>
          {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
          {copied ? 'Copied' : 'Copy post'}
        </Button>

        {item.status !== 'published' && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onSave({ status: 'published' })
              if (item.linkUrl === '') setLinkPrompt(true)
              toast('Marked as published', {
                body: 'SoloWrk records what you posted. It does not post for you.'
              })
            }}
          >
            Mark published
          </Button>
        )}

        <span className="ml-auto text-[11px] text-faint">
          {item.publishedAt ? `Published ${item.publishedAt.slice(0, 10)}` : 'Not posted yet'}
        </span>
      </footer>
    </>
  )
}

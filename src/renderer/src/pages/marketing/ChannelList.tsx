import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Sparkles, X } from 'lucide-react'
import type { CadencePeriod } from '@shared/cadence'
import type { ChannelType, MarketingChannel } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { NumberInput, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { keys, useInvalidate } from '@/lib/api'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Where work comes from, and how often you have said you will show up there.
 *
 * §4.2 calls the commitment the single highest-value thing in this module, so
 * it is not tucked into a settings dialog — the number sits on the row, two
 * controls wide, and changing it takes one click. Everything the calendar
 * draws as a gap comes from these two fields.
 *
 * The row deliberately does not say whether a commitment is being met. That
 * belongs on the calendar, where the gap is a hole you can fill, and in the
 * consistency strip, where it is a pattern. Here it would be a scoreboard, and
 * §4.2 is explicit that scoring this produces abandonment rather than posting.
 */

const TYPE_LABELS: Record<ChannelType, string> = {
  social: 'Social',
  content: 'Content',
  paid: 'Paid',
  direct: 'Direct',
  directory: 'Directory',
  referral: 'Referral',
  event: 'Event'
}

const PERIODS: { value: CadencePeriod; label: string }[] = [
  { value: 'week', label: 'a week' },
  { value: 'month', label: 'a month' }
]

export function ChannelList(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const { data: channels = [] } = useQuery({
    queryKey: keys.channels,
    queryFn: () => window.solo.invoke('channels:list')
  })

  const create = useMutation({
    mutationFn: (input: { name: string }) => window.solo.invoke('channels:create', input),
    onSuccess: () => {
      invalidate(['marketing'])
      setName('')
      setAdding(false)
    }
  })

  const seed = useMutation({
    mutationFn: () => window.solo.invoke('channels:seed'),
    onSuccess: () => invalidate(['marketing'])
  })

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {channels.length === 0 && !adding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 rounded-control border border-dashed border-line-strong px-3 py-3"
          >
            <p className="flex-1 text-[12px] text-muted">
              Nothing here yet. Start from a suggested set and delete what you don&rsquo;t use.
            </p>
            <Button variant="outline" size="sm" onClick={() => seed.mutate()}>
              <Sparkles size={13} strokeWidth={1.75} />
              Suggest some
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={listVariants} initial="hidden" animate="visible" className="flex flex-col gap-1">
        {channels.map((channel) => (
          <ChannelRow key={channel.id} channel={channel} />
        ))}
      </motion.div>

      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim() === '') return
            create.mutate({ name: name.trim() })
          }}
          className="flex items-center gap-2"
        >
          <TextInput
            autoFocus
            value={name}
            placeholder="LinkedIn, a local directory, word of mouth…"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(false)
            }}
          />
          <Button type="submit" variant="primary" size="sm" disabled={name.trim() === ''}>
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-fit items-center gap-1.5 rounded-control px-1 py-1 text-[12px] text-faint transition-colors hover:text-ink"
        >
          <Plus size={13} strokeWidth={1.75} />
          Add a channel
        </button>
      )}
    </div>
  )
}

function ChannelRow({ channel }: { channel: MarketingChannel }): React.JSX.Element {
  const invalidate = useInvalidate()

  const update = useMutation({
    mutationFn: (patch: Partial<MarketingChannel>) =>
      window.solo.invoke('channels:update', { id: channel.id, patch }),
    onSuccess: () => invalidate(['marketing'])
  })

  const retire = useMutation({
    mutationFn: () => window.solo.invoke('channels:deactivate', { id: channel.id }),
    onSuccess: () => invalidate(['marketing'])
  })

  const committed = channel.cadenceCount > 0

  return (
    <motion.div
      variants={listItemVariants}
      layout
      className="group flex items-center gap-2.5 rounded-control border border-transparent bg-raised px-2.5 py-2 transition-colors hover:border-line-strong"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: channel.colour }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-ink">{channel.name}</span>
        <span className="text-[11px] text-faint">{TYPE_LABELS[channel.type]}</span>
      </div>

      {/*
        The commitment, always visible and always editable — never behind an
        edit mode. Zero is a real answer and reads as one: a directory listing
        does not need posting to, and pretending otherwise would put a
        permanent gap on the calendar for a channel nobody ever posts on.
      */}
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="w-[62px]">
          <NumberInput
            min={0}
            max={31}
            value={channel.cadenceCount}
            onChangeValue={(count) => update.mutate({ cadenceCount: Math.max(0, count) })}
            aria-label={`How many ${channel.name} posts per period`}
          />
        </div>
        <Select
          value={channel.cadencePeriod}
          onChange={(period) => period && update.mutate({ cadencePeriod: period })}
          options={PERIODS}
          className="w-[104px] [&>select]:h-8"
        />
      </div>

      <span
        className={cn(
          'w-[92px] shrink-0 text-right text-[11px]',
          committed ? 'text-muted' : 'text-disabled'
        )}
      >
        {committed ? 'on the calendar' : 'no commitment'}
      </span>

      <button
        type="button"
        aria-label={`Retire ${channel.name}`}
        title="Retire — keeps everything published to it, takes it off the calendar"
        onClick={() => retire.mutate()}
        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </motion.div>
  )
}


import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, Megaphone, Plus } from 'lucide-react'
import type { ContentItemWithContext, ContentStatus } from '@shared/types'
import { addMonths, dayFromDate, monthGrid } from '@shared/calendar'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { cn } from '@/lib/utils'
import { ContentBoard } from './ContentBoard'
import { ContentCalendar } from './ContentCalendar'
import { ContentDrawer } from './ContentDrawer'
import { monthLabel } from '../calendar/grid'

/**
 * The day-to-day surface, and the tab that opens by default.
 *
 * Calendar and board are two readings of the same rows, not two data sets: the
 * calendar answers "what is going out and when", the board answers "what state
 * is everything in". The channel rail filters both, because hiding a channel
 * in one view and finding it still there in the other would be a bug somebody
 * would report as one.
 */

type View = 'calendar' | 'board'

export function ContentTab(): React.JSX.Element {
  const invalidate = useInvalidate()
  const today = dayFromDate(new Date())

  const [view, setView] = useState<View>('calendar')
  const [anchor, setAnchor] = useState(today)
  const [open, setOpen] = useState<ContentItemWithContext | null>(null)
  const [hidden, setHidden] = useState<Set<number>>(new Set())

  const days = monthGrid(anchor)
  const from = days[0]!
  const to = days.at(-1)!

  const { data: channels = [] } = useQuery({
    queryKey: keys.channels,
    queryFn: () => window.solo.invoke('channels:list')
  })

  const { data: month } = useQuery({
    queryKey: keys.contentMonth(from, to),
    queryFn: () => window.solo.invoke('content:month', { from, to })
  })

  // The board is a pipeline, not a month — an idea with no date has to appear
  // on it, and a scheduled item does not stop existing when you page forward.
  const { data: all = [] } = useQuery({
    queryKey: keys.content(),
    queryFn: () => window.solo.invoke('content:list'),
    enabled: view === 'board'
  })

  const create = useMutation({
    mutationFn: (input: { day: string; channelId: number | null }) =>
      window.solo.invoke('content:create', {
        channelId: input.channelId,
        scheduledFor: input.day === '' ? null : `${input.day}T09:00`
      }),
    onSuccess: (item) => {
      invalidate(['marketing'])
      // Straight into the drawer. Creating an empty row and leaving somebody
      // to find it is how a "new" button becomes a thing people stop pressing.
      setOpen(item)
    }
  })

  const reschedule = useMutation({
    mutationFn: (input: { id: number; scheduledFor: string }) =>
      window.solo.invoke('content:update', {
        id: input.id,
        patch: { scheduledFor: input.scheduledFor }
      }),
    onSuccess: () => invalidate(['marketing'])
  })

  // The command palette's "New post" navigates here with `?new=1`. Without
  // this the entry would carry somebody to the page and then do nothing.
  useOpenParam('new', () => create.mutate({ day: today, channelId: null }))

  const move = useMutation({
    mutationFn: (input: { id: number; status: ContentStatus }) =>
      window.solo.invoke('content:update', { id: input.id, patch: { status: input.status } }),
    onSuccess: () => invalidate(['marketing'])
  })

  const items = month?.items ?? []
  const ghosts = month?.ghosts ?? []
  const nothingAtAll = channels.length === 0 && items.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-1">
        {view === 'calendar' && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous month"
              onClick={() => setAnchor(addMonths(anchor, -1))}
            >
              <ChevronLeft size={15} strokeWidth={1.75} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next month"
              onClick={() => setAnchor(addMonths(anchor, 1))}
            >
              <ChevronRight size={15} strokeWidth={1.75} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(today)} className="ml-1.5">
              Today
            </Button>
            <span className="ml-2 text-[12px] text-muted">{monthLabel(anchor)}</span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <ViewButton
            active={view === 'calendar'}
            label="Calendar"
            icon={CalendarDays}
            onClick={() => setView('calendar')}
          />
          <ViewButton
            active={view === 'board'}
            label="Board"
            icon={Columns3}
            onClick={() => setView('board')}
          />
          <Button
            variant="primary"
            size="sm"
            className="ml-1.5"
            onClick={() => create.mutate({ day: today, channelId: null })}
          >
            <Plus size={14} strokeWidth={1.75} />
            New
          </Button>
        </div>
      </div>

      {nothingAtAll ? (
        <Empty
          icon={Megaphone}
          title="Nothing planned yet"
          body="Add a channel in Plan and say how often you mean to post. The gaps appear here, and you fill them."
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          {channels.length > 0 && (
            <ChannelRail
              channels={channels}
              hidden={hidden}
              onToggle={(id) =>
                setHidden((current) => {
                  const next = new Set(current)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
            />
          )}

          {view === 'calendar' ? (
            <ContentCalendar
              days={days}
              anchor={anchor}
              today={today}
              items={items}
              ghosts={ghosts}
              channels={channels}
              hidden={hidden}
              onOpen={setOpen}
              onCreate={(input) => create.mutate(input)}
              onReschedule={(input) => reschedule.mutate(input)}
            />
          ) : (
            <ContentBoard
              items={all}
              hidden={hidden}
              onOpen={setOpen}
              onMove={(input) => move.mutate(input)}
            />
          )}
        </div>
      )}

      <ContentDrawer item={open} channels={channels} onClose={() => setOpen(null)} />
    </div>
  )
}

function ViewButton({
  active,
  label,
  icon: Icon,
  onClick
}: {
  active: boolean
  label: string
  icon: typeof CalendarDays
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-control px-2.5 text-[12px] transition-colors',
        active ? 'bg-raised text-ink' : 'text-faint hover:text-ink'
      )}
    >
      <Icon size={13} strokeWidth={1.75} />
      {label}
    </button>
  )
}

/**
 * §6.1's filter rail.
 *
 * Hiding is local and unsaved on purpose — it is a way of looking at this
 * month, not a setting. Somebody who hid LinkedIn to see the newsletter
 * clearly should not find it still hidden a week later and assume the posts
 * are gone.
 */
function ChannelRail({
  channels,
  hidden,
  onToggle
}: {
  channels: { id: number; name: string; colour: string; cadenceCount: number }[]
  hidden: Set<number>
  onToggle: (id: number) => void
}): React.JSX.Element {
  return (
    <div className="flex w-[152px] shrink-0 flex-col gap-0.5 overflow-y-auto">
      {channels.map((channel) => {
        const off = hidden.has(channel.id)

        return (
          <button
            key={channel.id}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(channel.id)}
            className={cn(
              'flex items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-raised',
              off && 'opacity-40'
            )}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: channel.colour }}
            />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{channel.name}</span>
            {channel.cadenceCount > 0 && (
              <span className="numeric shrink-0 text-[10.5px] text-disabled">
                {channel.cadenceCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

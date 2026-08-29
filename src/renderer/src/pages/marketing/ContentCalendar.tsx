import { useState } from 'react'
import { motion } from 'motion/react'
import type { ContentItemWithContext, MarketingChannel } from '@shared/types'
import type { Ghost } from '@shared/cadence'
import { isSameMonth, timeOf } from '@shared/calendar'
import { WEEKDAY_LABELS } from '../calendar/grid'
import { cn } from '@/lib/utils'

/**
 * The month, and the holes in it.
 *
 * Two things are drawn here and they are not the same kind of thing. Content
 * is something you wrote. A ghost is the absence of something you said you
 * would write — computed on read from the channel's commitment, stored
 * nowhere, and never a task.
 *
 * §11 sets the treatment and the reason is worth keeping: a ghost is 1px
 * dashed with no fill, so it reads as absence rather than as content. A filled
 * chip that happened to be grey would just look like a post nobody had written
 * the title for.
 */

/** Below this, a drag is a click. Trackpads make anything smaller unusable. */
const DRAG_THRESHOLD = 4

export function ContentCalendar({
  days,
  anchor,
  today,
  items,
  ghosts,
  channels,
  hidden,
  onOpen,
  onCreate,
  onReschedule
}: {
  days: string[]
  anchor: string
  today: string
  items: ContentItemWithContext[]
  ghosts: Ghost[]
  channels: MarketingChannel[]
  hidden: Set<number>
  onOpen: (item: ContentItemWithContext) => void
  onCreate: (input: { day: string; channelId: number | null }) => void
  onReschedule: (input: { id: number; scheduledFor: string }) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState<{ id: number; overDay: string } | null>(null)

  const visible = items.filter(
    (item) => item.channelId === null || !hidden.has(item.channelId)
  )
  const visibleGhosts = ghosts.filter((ghost) => !hidden.has(ghost.channelId))

  /** Dragging a chip to another day. The same gesture the old calendar used. */
  function startDrag(pointerEvent: React.PointerEvent, item: ContentItemWithContext): void {
    if (pointerEvent.button !== 0) return

    const originX = pointerEvent.clientX
    const originY = pointerEvent.clientY
    let moved = false
    let overDay: string | null = null

    const onMove = (move: PointerEvent): void => {
      if (!moved && Math.hypot(move.clientX - originX, move.clientY - originY) < DRAG_THRESHOLD) {
        return
      }
      moved = true

      const cell = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>('[data-day]')
      overDay = cell?.dataset.day ?? null
      setDragging({ id: item.id, overDay: overDay ?? '' })
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(null)

      if (!moved) return onOpen(item)
      if (!overDay) return
      if (item.scheduledFor?.slice(0, 10) === overDay) return

      // Keeps whatever time was chosen for it; an undated one takes 09:00.
      const time = item.scheduledFor ? timeOf(item.scheduledFor) : '09:00'
      onReschedule({ id: item.id, scheduledFor: `${overDay}T${time}` })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
      <div className="grid shrink-0 grid-cols-7 border-b border-line bg-surface">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5 text-[10.5px] tracking-[0.08em] text-faint uppercase">
            {label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const dayItems = visible.filter((item) => item.scheduledFor?.slice(0, 10) === day)
          const dayGhosts = visibleGhosts.filter((ghost) => ghost.day === day)
          const outside = !isSameMonth(day, anchor)

          return (
            <div
              key={day}
              data-day={day}
              onDoubleClick={() => onCreate({ day, channelId: null })}
              className={cn(
                'flex min-h-0 flex-col border-r border-b border-line p-1 last:border-r-0',
                outside && 'bg-ground/60',
                dragging?.overDay === day && 'bg-accent/10'
              )}
            >
              <span
                className={cn(
                  'numeric mb-1 block px-1 text-[11px]',
                  outside ? 'text-faint/60' : 'text-muted',
                  day === today &&
                    'grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[10.5px] font-medium text-accent-ink'
                )}
              >
                {Number(day.slice(8))}
              </span>

              <div className="flex min-h-0 flex-col gap-[3px] overflow-hidden">
                {dayItems.map((item) => (
                  <Chip
                    key={item.id}
                    item={item}
                    dimmed={dragging?.id === item.id}
                    onPointerDown={(event) => startDrag(event, item)}
                  />
                ))}

                {/* Gaps last, always. What you have written comes before what
                    you have not — a column that led with its absences would
                    read as a list of failures. */}
                {dayGhosts.map((ghost) => (
                  <GhostChip
                    key={`${ghost.channelId}-${ghost.day}`}
                    label={channels.find((one) => one.id === ghost.channelId)?.name ?? ''}
                    onClick={() => onCreate({ day, channelId: ghost.channelId })}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Chip({
  item,
  dimmed,
  onPointerDown
}: {
  item: ContentItemWithContext
  dimmed: boolean
  onPointerDown: (event: React.PointerEvent) => void
}): React.JSX.Element {
  const draft = item.status === 'drafting' || item.status === 'idea'

  return (
    <motion.div
      layoutId={`content-${item.id}`}
      onPointerDown={onPointerDown}
      // The cell behind creates a new item on double-click. Without this,
      // double-clicking a chip would make one on top of the chip you meant.
      onDoubleClick={(event) => event.stopPropagation()}
      /*
        The left edge is set inline rather than by a class so it survives the
        dashed border a draft adds: `border` would otherwise reset all four
        sides to 1px, and the channel colour is the one thing on this chip that
        has to stay legible at 11px.
      */
      style={{
        borderLeftColor: item.channelColour,
        borderLeftWidth: 3,
        borderLeftStyle: 'solid'
      }}
      className={cn(
        'flex cursor-grab items-center gap-1 rounded-[4px] bg-raised px-1.5 py-[3px] select-none active:cursor-grabbing',
        // §6.1: a draft shows a dashed edge, so its state is legible at chip
        // size without needing a word for it.
        draft && 'border border-dashed border-line-strong',
        dimmed && 'opacity-50'
      )}
    >
      {/* Filled once it has gone out, hollow while it is only promised. */}
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full border',
          item.status === 'published' ? 'border-transparent' : 'bg-transparent'
        )}
        style={
          item.status === 'published'
            ? { backgroundColor: item.channelColour }
            : { borderColor: item.channelColour }
        }
      />
      <span className="truncate text-[11px] text-ink">{item.title || 'Untitled'}</span>
    </motion.div>
  )
}

/**
 * A slot the commitment says should be filled and is not.
 *
 * Clicking it makes the real thing, dated and on the right channel — which is
 * the whole reason to draw it. A gap you cannot act on is a reproach.
 */
function GhostChip({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={(event) => event.stopPropagation()}
      title={`Nothing planned for ${label} here`}
      className={cn(
        'flex items-center rounded-[4px] border border-dashed border-line-strong px-1.5 py-[3px]',
        'text-left text-[11px] text-disabled transition-colors',
        'hover:border-accent/50 hover:text-muted'
      )}
    >
      <span className="truncate">{label}</span>
    </button>
  )
}

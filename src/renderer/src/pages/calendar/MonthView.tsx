import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { CalendarEventWithContext, TaskWithContext } from '@shared/types'
import { dayOf, daysBetween, isSameMonth, monthGrid, occursOn, timeOf } from '@shared/calendar'
import { cn } from '@/lib/utils'
import { transition } from '@/lib/motion'
import { WEEKDAY_LABELS } from './grid'

/** How far the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD = 4

export function MonthView({
  month,
  today,
  events,
  tasks,
  onOpenEvent,
  onCreateAt,
  onMoveEvent
}: {
  /** Any day in the month being shown. */
  month: string
  today: string
  events: CalendarEventWithContext[]
  tasks: TaskWithContext[]
  onOpenEvent: (event: CalendarEventWithContext) => void
  onCreateAt: (day: string) => void
  onMoveEvent: (event: CalendarEventWithContext, days: number) => void
}): React.JSX.Element {
  const days = monthGrid(month)
  const [dragging, setDragging] = useState<{ id: number; overDay: string } | null>(null)
  const origin = useRef<{ x: number; y: number; day: string; moved: boolean } | null>(null)
  // The drop target is read again on pointerup, by which time the state
  // captured in this closure is stale — so the live value lives in a ref.
  const overDay = useRef<string | null>(null)

  /**
   * Dragging is done with raw pointer events rather than a drag-and-drop
   * library: the drop target is just "the day cell under the cursor", which
   * `elementFromPoint` answers directly, and it leaves the chip's own click
   * behaviour intact when the pointer never actually moves.
   */
  function startDrag(pointerEvent: React.PointerEvent, event: CalendarEventWithContext): void {
    if (pointerEvent.button !== 0) return
    origin.current = {
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
      day: dayOf(event.startsAt),
      moved: false
    }

    const onMove = (move: PointerEvent): void => {
      const from = origin.current
      if (!from) return
      if (
        !from.moved &&
        Math.hypot(move.clientX - from.x, move.clientY - from.y) < DRAG_THRESHOLD
      ) {
        return
      }
      from.moved = true

      const cell = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>('[data-day]')
      overDay.current = cell?.dataset.day ?? from.day
      setDragging({ id: event.id, overDay: overDay.current })
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      const from = origin.current
      const target = overDay.current
      origin.current = null
      overDay.current = null
      setDragging(null)

      if (!from) return
      if (!from.moved) {
        onOpenEvent(event)
        return
      }

      if (target && target !== from.day) onMoveEvent(event, daysBetween(from.day, target))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
      <div className="grid shrink-0 grid-cols-7 border-b border-line bg-surface">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-[10.5px] tracking-[0.08em] text-faint uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const dayEvents = events.filter((event) => occursOn(event, day))
          const dayTasks = tasks.filter((task) => task.dueAt?.slice(0, 10) === day)
          const outside = !isSameMonth(day, month)
          const isToday = day === today

          return (
            <div
              key={day}
              data-day={day}
              onDoubleClick={() => onCreateAt(day)}
              className={cn(
                'min-h-0 border-r border-b border-line p-1 last:border-r-0',
                outside && 'bg-ground/60',
                dragging?.overDay === day && 'bg-accent/10'
              )}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span
                  className={cn(
                    'numeric text-[11px]',
                    outside ? 'text-faint/60' : 'text-muted',
                    isToday &&
                      'grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[10.5px] font-medium text-accent-ink'
                  )}
                >
                  {Number(day.slice(8))}
                </span>
              </div>

              <div className="flex flex-col gap-[3px] overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <motion.button
                    key={event.id}
                    layoutId={`event-${event.id}`}
                    transition={transition.layout}
                    type="button"
                    onPointerDown={(pointerEvent) => startDrag(pointerEvent, event)}
                    style={{
                      backgroundColor: `${event.displayColour}1f`,
                      borderColor: event.displayColour
                    }}
                    className={cn(
                      'flex items-center gap-1.5 truncate rounded-[4px] border-l-2 px-1.5 py-[3px]',
                      'text-left text-[11px] text-ink transition-opacity hover:opacity-80',
                      dragging?.id === event.id && 'opacity-50'
                    )}
                  >
                    {!event.allDay && (
                      <span className="numeric shrink-0 text-[10px] text-muted">
                        {timeOf(event.startsAt)}
                      </span>
                    )}
                    <span className="truncate">{event.title}</span>
                  </motion.button>
                ))}

                {dayTasks.slice(0, 2).map((task) => (
                  <div
                    key={`task-${task.id}`}
                    title={`Task due: ${task.title}`}
                    className="flex items-center gap-1.5 truncate rounded-[4px] border border-dashed border-line-strong px-1.5 py-[2px] text-[11px] text-muted"
                  >
                    <span
                      style={{ backgroundColor: task.projectColour ?? '#5a5a63' }}
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                    />
                    <span
                      className={cn('truncate', task.status === 'done' && 'line-through opacity-60')}
                    >
                      {task.title}
                    </span>
                  </div>
                ))}

                {dayEvents.length + dayTasks.length > 5 && (
                  <span className="px-1 text-[10.5px] text-faint">
                    +{dayEvents.length + dayTasks.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

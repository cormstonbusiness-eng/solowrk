import { useEffect, useRef, useState } from 'react'
import type { CalendarEventWithContext } from '@shared/types'
import {
  MINUTES_PER_DAY,
  clamp,
  dayOf,
  minutesBetween,
  minutesOf,
  occursOn,
  placeOverlapping,
  segmentOn,
  snapMinutes,
  stampAt,
  timeOf
} from '@shared/calendar'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SCROLL_HOUR,
  HOURS,
  HOUR_HEIGHT,
  PX_PER_MINUTE,
  columnLabel,
  hourLabel
} from './grid'

const DRAG_THRESHOLD = 3
const MIN_EVENT_MINUTES = 15
/** Slot granularity when clicking empty space to create something. */
const NEW_EVENT_MINUTES = 60

interface DragState {
  id: number
  mode: 'move' | 'resize'
  startsAt: string
  endsAt: string
}

export function TimeGrid({
  days,
  today,
  events,
  onOpenEvent,
  onCreateSlot,
  onReschedule
}: {
  days: string[]
  today: string
  events: CalendarEventWithContext[]
  onOpenEvent: (event: CalendarEventWithContext) => void
  onCreateSlot: (startsAt: string, endsAt: string) => void
  onReschedule: (event: CalendarEventWithContext, span: { startsAt: string; endsAt: string }) => void
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const live = useRef<DragState | null>(null)
  const [now, setNow] = useState(() => new Date())

  // Open on the working day rather than at midnight.
  useEffect(() => {
    scroller.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HOUR_HEIGHT })
  }, [])

  // The current-time line only needs to be minute-accurate.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const timed = events.filter((event) => !event.allDay)
  const allDay = events.filter((event) => event.allDay)

  /**
   * One pointer handler drives both moving and resizing: they differ only in
   * which end of the span the delta is applied to, and sharing the code means
   * snapping, clamping and the click-versus-drag threshold cannot drift apart.
   */
  function startDrag(
    pointerEvent: React.PointerEvent,
    event: CalendarEventWithContext,
    mode: 'move' | 'resize'
  ): void {
    if (pointerEvent.button !== 0) return
    pointerEvent.stopPropagation()

    const originX = pointerEvent.clientX
    const originY = pointerEvent.clientY
    const originDay = dayOf(event.startsAt)
    const duration = minutesBetween(event.startsAt, event.endsAt)
    let moved = false

    const onMove = (move: PointerEvent): void => {
      // Below the threshold this is still a click, not a drag — without it,
      // every attempt to open an event would nudge it by a pixel.
      if (!moved && Math.hypot(move.clientX - originX, move.clientY - originY) < DRAG_THRESHOLD) {
        return
      }
      moved = true

      const deltaMinutes = snapMinutes((move.clientY - originY) / PX_PER_MINUTE)

      if (mode === 'resize') {
        const nextDuration = Math.max(MIN_EVENT_MINUTES, duration + deltaMinutes)
        live.current = {
          id: event.id,
          mode,
          startsAt: event.startsAt,
          endsAt: stampAt(originDay, minutesOf(event.startsAt) + nextDuration)
        }
      } else {
        // Which day column the pointer is over decides the horizontal move, so
        // a week view drags sideways as naturally as it drags up and down.
        const overColumn = document
          .elementFromPoint(move.clientX, move.clientY)
          ?.closest<HTMLElement>('[data-column-day]')
        const targetDay = overColumn?.dataset.columnDay ?? originDay
        const startMinutes = clamp(
          minutesOf(event.startsAt) + deltaMinutes,
          0,
          MINUTES_PER_DAY - MIN_EVENT_MINUTES
        )
        live.current = {
          id: event.id,
          mode,
          startsAt: stampAt(targetDay, startMinutes),
          endsAt: stampAt(targetDay, startMinutes + duration)
        }
      }

      setDrag(live.current)
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      const result = live.current
      live.current = null
      setDrag(null)

      if (!moved || !result) {
        onOpenEvent(event)
        return
      }
      if (result.startsAt !== event.startsAt || result.endsAt !== event.endsAt) {
        onReschedule(event, { startsAt: result.startsAt, endsAt: result.endsAt })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Clicking empty grid opens a new event at that time, rounded to the half hour. */
  function createAt(clickEvent: React.MouseEvent<HTMLDivElement>, day: string): void {
    const bounds = clickEvent.currentTarget.getBoundingClientRect()
    const minutes = clamp(
      snapMinutes((clickEvent.clientY - bounds.top) / PX_PER_MINUTE, 30),
      0,
      MINUTES_PER_DAY - NEW_EVENT_MINUTES
    )
    onCreateSlot(stampAt(day, minutes), stampAt(day, minutes + NEW_EVENT_MINUTES))
  }

  /** The dragged event's provisional span, so the drag reads as direct. */
  function spanOf(event: CalendarEventWithContext): { startsAt: string; endsAt: string } {
    return drag?.id === event.id ? { startsAt: drag.startsAt, endsAt: drag.endsAt } : event
  }

  const nowDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
      {/* Column headers */}
      <div className="flex shrink-0 border-b border-line bg-surface">
        <div className="w-[52px] shrink-0 border-r border-line" />
        {days.map((day) => {
          const { weekday, date } = columnLabel(day)
          return (
            <div
              key={day}
              className="flex flex-1 items-baseline justify-center gap-1.5 border-r border-line py-2 last:border-r-0"
            >
              <span className="text-[10.5px] tracking-[0.06em] text-faint uppercase">
                {weekday}
              </span>
              <span
                className={cn(
                  'numeric text-[13px] text-ink',
                  day === today &&
                    'grid h-[20px] w-[20px] place-items-center rounded-full bg-accent text-[11.5px] font-medium text-accent-ink'
                )}
              >
                {date}
              </span>
            </div>
          )
        })}
      </div>

      {/* All-day strip: whole-day events */}
      <div className="flex shrink-0 border-b border-line bg-ground/40">
        <div className="flex w-[52px] shrink-0 items-center justify-end border-r border-line pr-2 text-[10px] text-faint">
          All day
        </div>
        {days.map((day) => (
          <div
            key={day}
            className="flex min-h-[30px] flex-1 flex-col gap-[3px] border-r border-line p-1 last:border-r-0"
          >
            {allDay
              .filter((event) => occursOn(event, day))
              .map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onOpenEvent(event)}
                  style={{
                    backgroundColor: `${event.displayColour}1f`,
                    borderColor: event.displayColour
                  }}
                  className="truncate rounded-[4px] border-l-2 px-1.5 py-[2px] text-left text-[11px] text-ink"
                >
                  {event.title}
                </button>
              ))}


          </div>
        ))}
      </div>

      {/* Scrollable time grid */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
          <div className="w-[52px] shrink-0 border-r border-line">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="relative border-b border-line/50"
              >
                <span className="numeric absolute -top-1.5 right-2 text-[10px] text-faint">
                  {hour > 0 && hourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayEvents = timed.filter((event) => occursOn(spanOf(event), day))
            const placed = placeOverlapping(dayEvents, (event) => segmentOn(spanOf(event), day))

            return (
              <div
                key={day}
                data-column-day={day}
                onClick={(clickEvent) => createAt(clickEvent, day)}
                className="relative flex-1 border-r border-line last:border-r-0"
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: HOUR_HEIGHT }}
                    className="border-b border-line/50"
                  />
                ))}

                {day === nowDay && (
                  <div
                    aria-hidden
                    style={{ top: nowMinutes * PX_PER_MINUTE }}
                    className="pointer-events-none absolute right-0 left-0 z-20 h-px bg-danger"
                  >
                    <span className="absolute -top-[3px] -left-[3px] h-[7px] w-[7px] rounded-full bg-danger" />
                  </div>
                )}

                {placed.map(({ item: event, column, columns }) => {
                  const span = spanOf(event)
                  const segment = segmentOn(span, day)
                  const height = (segment.end - segment.start) * PX_PER_MINUTE
                  const compact = height < 34

                  return (
                    <div
                      key={event.id}
                      onPointerDown={(pointerEvent) => startDrag(pointerEvent, event, 'move')}
                      // The column beneath creates a new event on click; without
                      // this, opening one would also open a "new event" modal.
                      onClick={(clickEvent) => clickEvent.stopPropagation()}
                      style={{
                        top: segment.start * PX_PER_MINUTE,
                        height: height - 2,
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${(1 / columns) * 100}% - 4px)`,
                        backgroundColor: `${event.displayColour}24`,
                        borderColor: event.displayColour
                      }}
                      className={cn(
                        'group absolute z-10 overflow-hidden rounded-[5px] border-l-2 px-1.5 py-0.5',
                        'cursor-grab text-left select-none active:cursor-grabbing',
                        'transition-shadow hover:shadow-lg',
                        drag?.id === event.id && 'z-30 shadow-xl'
                      )}
                    >
                      <p
                        className={cn(
                          'truncate text-[11.5px] font-medium text-ink',
                          compact && 'text-[10.5px]'
                        )}
                      >
                        {event.title}
                      </p>
                      {!compact && (
                        <p className="numeric truncate text-[10px] text-muted">
                          {timeOf(span.startsAt)}
                          {event.projectName && ` · ${event.projectName}`}
                        </p>
                      )}

                      {/* Resize grip: only the bottom few pixels, so the rest of
                          the block stays a move target. */}
                      <div
                        onPointerDown={(pointerEvent) =>
                          startDrag(pointerEvent, event, 'resize')
                        }
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <div className="mx-auto h-[3px] w-6 rounded-full bg-ink/40" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

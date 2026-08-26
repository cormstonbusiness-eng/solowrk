import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import {
  MINUTES_PER_DAY,
  clamp,
  dayOf,
  isWorkingDay,
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
  columnLabel,
  detailFor,
  durationLabel,
  hourLabel,
  pxPerMinute
} from './grid'

/** §6.2: four pixels of travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4
const MIN_BLOCK_MINUTES = 15
/** Slot granularity when clicking empty space to create something. */
const NEW_BLOCK_MINUTES = 60

interface DragState {
  id: number
  mode: 'move' | 'resize'
  startsAt: string
  endsAt: string
}

export function TimeGrid({
  days,
  today,
  blocks,
  settings,
  onOpenBlock,
  onCreateSlot,
  onReschedule
}: {
  days: string[]
  today: string
  blocks: CalendarBlockWithContext[]
  settings: CalendarSettings
  onOpenBlock: (block: CalendarBlockWithContext) => void
  onCreateSlot: (startsAt: string, endsAt: string) => void
  onReschedule: (
    block: CalendarBlockWithContext,
    span: { startsAt: string; endsAt: string }
  ) => void
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const live = useRef<DragState | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [allDayOpen, setAllDayOpen] = useState(true)

  const hourHeight = settings.hourHeight
  const perMinute = pxPerMinute(hourHeight)

  // Open on the working day rather than at midnight. Re-runs on zoom, because
  // the pixel that was 9am is a different pixel once the rows change height.
  useEffect(() => {
    scroller.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * hourHeight })
  }, [hourHeight])

  // The current-time line only needs to be minute-accurate.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const timed = blocks.filter((block) => !block.allDay)
  const allDay = blocks.filter((block) => block.allDay)

  /**
   * How much of each day is already spoken for, for the column headers.
   *
   * Personal and holiday blocks are deliberately excluded: they make you
   * unavailable, but they are not work, and counting a week off as sixty
   * committed hours would make the number say the opposite of the truth.
   */
  const committed = useMemo(() => {
    const totals = new Map<string, number>()
    for (const day of days) {
      let minutes = 0
      for (const block of timed) {
        if (!blockTypeMeta(block.blockType).counts) continue
        if (!occursOn(block, day)) continue
        const segment = segmentOn(block, day)
        minutes += segment.end - segment.start
      }
      totals.set(day, minutes)
    }
    return totals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, timed])

  /**
   * One pointer handler drives both moving and resizing: they differ only in
   * which end of the span the delta is applied to, and sharing the code means
   * snapping, clamping and the click-versus-drag threshold cannot drift apart.
   */
  function startDrag(
    pointerEvent: React.PointerEvent,
    block: CalendarBlockWithContext,
    mode: 'move' | 'resize'
  ): void {
    if (pointerEvent.button !== 0) return
    if (block.locked || !blockTypeMeta(block.blockType).draggable) return
    pointerEvent.stopPropagation()

    const originX = pointerEvent.clientX
    const originY = pointerEvent.clientY
    const originDay = dayOf(block.startsAt)
    const duration = minutesBetween(block.startsAt, block.endsAt)
    let moved = false

    const onMove = (move: PointerEvent): void => {
      // Below the threshold this is still a click, not a drag — without it,
      // every attempt to open a block would nudge it by a pixel.
      if (!moved && Math.hypot(move.clientX - originX, move.clientY - originY) < DRAG_THRESHOLD) {
        return
      }
      moved = true

      // Alt bypasses snapping, for the odd 09:05 that a 15-minute grid cannot
      // express. Held rather than a mode, so it is never left switched on.
      const step = move.altKey ? 1 : settings.snapMinutes
      const deltaMinutes = snapMinutes((move.clientY - originY) / perMinute, step)

      if (mode === 'resize') {
        const nextDuration = Math.max(MIN_BLOCK_MINUTES, duration + deltaMinutes)
        live.current = {
          id: block.id,
          mode,
          startsAt: block.startsAt,
          endsAt: stampAt(originDay, minutesOf(block.startsAt) + nextDuration)
        }
      } else {
        // Which day column the pointer is over decides the horizontal move, so
        // a week view drags sideways as naturally as it drags up and down.
        const overColumn = document
          .elementFromPoint(move.clientX, move.clientY)
          ?.closest<HTMLElement>('[data-column-day]')
        const targetDay = overColumn?.dataset.columnDay ?? originDay
        const startMinutes = clamp(
          minutesOf(block.startsAt) + deltaMinutes,
          0,
          MINUTES_PER_DAY - MIN_BLOCK_MINUTES
        )
        live.current = {
          id: block.id,
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
        onOpenBlock(block)
        return
      }
      if (result.startsAt !== block.startsAt || result.endsAt !== block.endsAt) {
        onReschedule(block, { startsAt: result.startsAt, endsAt: result.endsAt })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Clicking empty grid opens a new block at that time, rounded to the half hour. */
  function createAt(clickEvent: React.MouseEvent<HTMLDivElement>, day: string): void {
    const bounds = clickEvent.currentTarget.getBoundingClientRect()
    const minutes = clamp(
      snapMinutes((clickEvent.clientY - bounds.top) / perMinute, 30),
      0,
      MINUTES_PER_DAY - settings.defaultBlockMinutes
    )
    onCreateSlot(
      stampAt(day, minutes),
      stampAt(day, minutes + (settings.defaultBlockMinutes || NEW_BLOCK_MINUTES))
    )
  }

  /** The dragged block's provisional span, so the drag reads as direct. */
  function spanOf(block: CalendarBlockWithContext): { startsAt: string; endsAt: string } {
    return drag?.id === block.id ? { startsAt: drag.startsAt, endsAt: drag.endsAt } : block
  }

  const nowDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  const dayCapacity = settings.dailyCapacityMinutes

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
      {/* Column headers */}
      <div className="flex shrink-0 border-b border-line bg-surface">
        <div className="w-[52px] shrink-0 border-r border-line" />
        {days.map((day) => {
          const { weekday, date } = columnLabel(day)
          const minutes = committed.get(day) ?? 0
          const over = dayCapacity > 0 && minutes > dayCapacity
          return (
            <div
              key={day}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 border-r border-line py-1.5 last:border-r-0',
                !isWorkingDay(settings.workingDays, day) && 'bg-ground/40'
              )}
            >
              <div className="flex items-baseline gap-1.5">
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
              {/* What the day already costs, said before you add to it. Blank
                  rather than "0h" on an empty day — a zero is a thing to read,
                  and an empty day has nothing to say. */}
              <span
                className={cn(
                  'numeric text-[10px] tabular-nums',
                  minutes === 0 ? 'text-transparent' : over ? 'text-danger' : 'text-faint'
                )}
              >
                {minutes === 0 ? '·' : durationLabel(minutes)}
              </span>
            </div>
          )
        })}
      </div>

      {/* All-day strip. Collapsible, because a fortnight in Greece should not
          take a third of the grid for a fortnight. */}
      <div className="flex shrink-0 border-b border-line bg-ground/40">
        <button
          type="button"
          onClick={() => setAllDayOpen((open) => !open)}
          aria-expanded={allDayOpen}
          className="flex w-[52px] shrink-0 items-center justify-end gap-0.5 border-r border-line pr-1.5 text-[10px] text-faint transition-colors hover:text-ink"
        >
          {allDayOpen ? (
            <ChevronDown size={11} strokeWidth={2} />
          ) : (
            <ChevronRight size={11} strokeWidth={2} />
          )}
          All day
        </button>
        {days.map((day) => {
          const onThisDay = allDay.filter((block) => occursOn(block, day))
          return (
            <div
              key={day}
              className="flex min-h-[26px] flex-1 flex-col gap-[3px] border-r border-line p-1 last:border-r-0"
            >
              {allDayOpen ? (
                onThisDay.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onOpenBlock(block)}
                    style={{
                      backgroundColor: `${block.displayColour}2e`,
                      borderColor: block.displayColour
                    }}
                    className="truncate rounded-[4px] border-l-[3px] px-1.5 py-[2px] text-left text-[11px] text-ink"
                  >
                    {block.title}
                  </button>
                ))
              ) : onThisDay.length > 0 ? (
                <span className="self-start rounded-[4px] bg-raised px-1.5 py-[1px] text-[10px] text-muted">
                  {onThisDay.length}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * hourHeight }}>
          <div className="w-[52px] shrink-0 border-r border-line">
            {HOURS.map((hour) => (
              <div key={hour} style={{ height: hourHeight }} className="relative border-b border-line/50">
                <span className="numeric absolute -top-1.5 right-2 text-[10px] text-faint">
                  {hour > 0 && hourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayBlocks = timed.filter((block) => occursOn(spanOf(block), day))
            const placed = placeOverlapping(dayBlocks, (block) => segmentOn(spanOf(block), day))
            const working = isWorkingDay(settings.workingDays, day)

            return (
              <div
                key={day}
                data-column-day={day}
                onClick={(clickEvent) => createAt(clickEvent, day)}
                className={cn(
                  'relative flex-1 border-r border-line last:border-r-0',
                  !working && 'bg-ground/40'
                )}
              >
                {/* Working hours, drawn as the *absence* of shade: the hours
                    you do not work are dimmed rather than the ones you do
                    being tinted, so a block's own colour is never sitting on
                    top of a second wash. */}
                {working && (
                  <>
                    <div
                      aria-hidden
                      style={{ height: settings.workingHoursStart * perMinute }}
                      className="pointer-events-none absolute inset-x-0 top-0 bg-ground/45"
                    />
                    <div
                      aria-hidden
                      style={{ top: settings.workingHoursEnd * perMinute, bottom: 0 }}
                      className="pointer-events-none absolute inset-x-0 bg-ground/45"
                    />
                  </>
                )}

                {HOURS.map((hour) => (
                  <div key={hour} style={{ height: hourHeight }} className="border-b border-line/50">
                    {/* The half-hour line, and only at a zoom where a
                        half-hour is a target worth aiming at. */}
                    {hourHeight >= 56 && (
                      <div
                        aria-hidden
                        style={{ height: hourHeight / 2 }}
                        className="border-b border-line/20"
                      />
                    )}
                  </div>
                ))}

                {day === nowDay && (
                  <div
                    aria-hidden
                    style={{ top: nowMinutes * perMinute }}
                    className="pointer-events-none absolute right-0 left-0 z-20 h-px bg-danger"
                  >
                    <span className="absolute -top-[3px] -left-[3px] h-[7px] w-[7px] rounded-full bg-danger" />
                  </div>
                )}

                {placed.map(({ item: block, column, columns, span: width }) => {
                  const span = spanOf(block)
                  const segment = segmentOn(span, day)
                  const height = (segment.end - segment.start) * perMinute
                  const detail = detailFor(height)
                  const meta = blockTypeMeta(block.blockType)
                  const dragging = drag?.id === block.id

                  return (
                    <div
                      key={block.id}
                      onPointerDown={(pointerEvent) => startDrag(pointerEvent, block, 'move')}
                      // The column beneath creates a new block on click; without
                      // this, opening one would also open a "new block" modal.
                      onClick={(clickEvent) => clickEvent.stopPropagation()}
                      style={{
                        top: segment.start * perMinute,
                        height: Math.max(height - 2, 6),
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${(width / columns) * 100}% - 4px)`,
                        // 18% fill, so the colour reads as identity rather than
                        // as a filled shape competing with the text on it.
                        backgroundColor: `${block.displayColour}2e`,
                        borderColor: block.displayColour
                      }}
                      className={cn(
                        'group absolute z-10 overflow-hidden rounded-[5px] border-l-[3px] px-1.5',
                        detail === 'inline' ? 'py-0' : 'py-0.5',
                        'text-left select-none',
                        block.locked || !meta.draggable
                          ? 'cursor-pointer'
                          : 'cursor-grab active:cursor-grabbing',
                        // Only transform and opacity move during a drag; the
                        // top and height are set directly and never animated,
                        // or the block would lag the pointer.
                        !dragging && 'transition-shadow hover:shadow-lg',
                        dragging && 'z-30 opacity-90 shadow-xl'
                      )}
                    >
                      {/* Somebody else's calendar. Hatched rather than greyed:
                          grey reads as "past" or "done", and this is neither. */}
                      {block.locked && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0"
                          style={{
                            backgroundImage:
                              'repeating-linear-gradient(45deg, transparent 0 5px, rgba(127,127,127,0.16) 5px 10px)'
                          }}
                        />
                      )}

                      {detail === 'inline' ? (
                        <p className="relative truncate text-[10px] leading-[13px] text-ink">
                          {block.title}
                        </p>
                      ) : (
                        <>
                          <p className="relative flex items-center gap-1 truncate text-[11.5px] font-medium text-ink">
                            {block.locked && (
                              <Lock size={9} strokeWidth={2.25} className="shrink-0 text-muted" />
                            )}
                            <span className="truncate">{block.title}</span>
                            {block.billable && (
                              <span
                                className="numeric shrink-0 text-[10px] text-muted"
                                title="Billable"
                              >
                                £
                              </span>
                            )}
                          </p>
                          {detail !== 'title' && (
                            <p className="numeric relative truncate text-[10px] text-muted">
                              {timeOf(span.startsAt)}–{timeOf(span.endsAt)}
                            </p>
                          )}
                          {detail === 'full' && (block.projectName || block.location) && (
                            <p className="relative truncate text-[10px] text-faint">
                              {[block.projectName, block.location].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </>
                      )}

                      {/* Resize grip: only the bottom few pixels, so the rest of
                          the block stays a move target. */}
                      {!block.locked && meta.draggable && (
                        <div
                          onPointerDown={(pointerEvent) => startDrag(pointerEvent, block, 'resize')}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <div className="mx-auto h-[3px] w-6 rounded-full bg-ink/40" />
                        </div>
                      )}
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
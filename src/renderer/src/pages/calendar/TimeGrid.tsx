import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Lock, Play } from 'lucide-react'
import type {
  CalendarBlockWithContext,
  CalendarSettings,
  DerivedMarker,
  RunningTimer,
  TaskWithContext
} from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import {
  dayOf,
  isWorkingDay,
  minutesBetween,
  minutesOf,
  occursOn,
  placeOverlapping,
  segmentOn,
  stampAt,
  stampFromDate,
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
import {
  MIN_BLOCK_MINUTES,
  cancel,
  drag as advance,
  edgesOn,
  idle,
  press,
  release,
  type DragMode,
  type DragState,
  type GridPoint,
  type Span
} from './drag'

/** How close to the top or bottom before the grid starts scrolling itself. */
const AUTOSCROLL_EDGE = 40
const AUTOSCROLL_SPEED = 10

/** How long a drag must sit against the left or right edge to turn the page. */
const EDGE_HOLD_MS = 600
const EDGE_ZONE = 24

/**
 * A glyph per kind of deadline.
 *
 * Text rather than icons, because these sit at ten pixels in a crowded strip
 * where an icon becomes a smudge, and because the shape has to survive being
 * the only thing distinguishing four dashed chips of the same size.
 */
const MARKER_GLYPH: Record<DerivedMarker['kind'], string> = {
  project: '◆',
  milestone: '◇',
  task: '•',
  invoice: '£'
}

export function TimeGrid({
  days,
  today,
  blocks,
  markers,
  settings,
  pendingTask,
  running,
  onOpenBlock,
  onCreate,
  onReschedule,
  onDuplicate,
  onAdvance,
  onScheduleTask,
  onCancelTaskDrag,
  onStartTimer
}: {
  days: string[]
  today: string
  blocks: CalendarBlockWithContext[]
  /** Dates the calendar shows but does not own. Drawn as marks, never moved. */
  markers: DerivedMarker[]
  settings: CalendarSettings
  /** A task picked up from the rail, waiting for somewhere to land. */
  pendingTask: TaskWithContext | null
  /** The timer, if one is going. Drawn as a block that grows. */
  running: RunningTimer | null
  onOpenBlock: (block: CalendarBlockWithContext) => void
  onCreate: (span: Span, title: string) => void
  onReschedule: (block: CalendarBlockWithContext, span: Span) => void
  onDuplicate: (block: CalendarBlockWithContext, span: Span) => void
  /** Turning the page mid-drag, when the pointer holds against an edge. */
  onAdvance: (direction: 1 | -1) => void
  onScheduleTask: (task: TaskWithContext, startsAt: string) => void
  onCancelTaskDrag: () => void
  onStartTimer: (block: CalendarBlockWithContext) => void
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<DragState>(idle)
  const [naming, setNaming] = useState<Span | null>(null)
  const [title, setTitle] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [allDayOpen, setAllDayOpen] = useState(true)

  const hourHeight = settings.hourHeight
  const perMinute = pxPerMinute(hourHeight)

  // Open on the working day rather than at midnight. Re-runs on zoom, because
  // the pixel that was 9am is a different pixel once the rows change height.
  useEffect(() => {
    scroller.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * hourHeight })
  }, [hourHeight])

  // The current-time line only needs to be minute-accurate. So does the
  // running timer's block: it is minutes tall, and a block that redrew every
  // second would be a repaint a second for a change nobody can see.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  /**
   * The timer, as a block that grows.
   *
   * Drawn from the live `time_entries` row rather than written into the
   * calendar, for the same reason the deadlines are not blocks: it is already
   * a record, and a copy would be a second one to keep true. It disappears
   * when the timer stops, and what is left behind is the time entry.
   */
  const runningSpan = useMemo(() => {
    if (!running) return null
    const startedAt = stampFromDate(new Date(running.entry.startedAt))
    const nowAt = stampFromDate(now)
    // A timer left going overnight would otherwise draw a block of negative
    // height on today and nothing at all on yesterday.
    return dayOf(startedAt) === dayOf(nowAt) ? { startsAt: startedAt, endsAt: nowAt } : null
  }, [running, now])

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

  /* ---------------- pointer → calendar ---------------- */

  /**
   * Turn a screen position into a day and a minute.
   *
   * The day comes from whichever column is under the pointer, so a week view
   * drags sideways as naturally as it drags up and down. The minute comes from
   * the grid body's own top rather than the column's, so it is unaffected by
   * which column that turns out to be.
   */
  const pointAt = useCallback(
    (x: number, y: number, fallbackDay: string): GridPoint => {
      const column = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-column-day]')
      const bounds = body.current?.getBoundingClientRect()
      return {
        day: column?.dataset.columnDay ?? fallbackDay,
        minutes: bounds ? (y - bounds.top) / perMinute : 0
      }
    },
    [perMinute]
  )

  /* ---------------- the drag itself ---------------- */

  // The live state, because the window listeners below are registered once and
  // would otherwise close over whatever the state was when the drag began.
  const live = useRef<DragState>(idle)
  const pointer = useRef({ x: 0, y: 0, ctrl: false, alt: false })
  const edgeHold = useRef<{ direction: 1 | -1; timer: number } | null>(null)
  const autoScroll = useRef<number | null>(null)

  const set = useCallback((next: DragState): void => {
    live.current = next
    setState(next)
  }, [])

  const stopEdgeHold = (): void => {
    if (edgeHold.current) window.clearTimeout(edgeHold.current.timer)
    edgeHold.current = null
  }

  const stopAutoScroll = (): void => {
    if (autoScroll.current !== null) cancelAnimationFrame(autoScroll.current)
    autoScroll.current = null
  }

  /**
   * Scroll the grid while the pointer sits near its top or bottom.
   *
   * A loop rather than a nudge per pointermove: dragging to 7am from 6pm means
   * holding still at the top edge, and a pointer that is not moving fires no
   * moves at all.
   */
  const runAutoScroll = useCallback(() => {
    const tick = (): void => {
      const el = scroller.current
      if (!el || live.current.phase === 'idle') {
        autoScroll.current = null
        return
      }

      const bounds = el.getBoundingClientRect()
      const y = pointer.current.y
      let delta = 0
      if (y < bounds.top + AUTOSCROLL_EDGE) delta = -AUTOSCROLL_SPEED
      else if (y > bounds.bottom - AUTOSCROLL_EDGE) delta = AUTOSCROLL_SPEED

      if (delta !== 0) {
        el.scrollTop += delta
        // The pointer has not moved but the grid beneath it has, so the drag
        // has to be recomputed or the block would stick where it was.
        recompute()
      }

      autoScroll.current = requestAnimationFrame(tick)
    }

    if (autoScroll.current === null) autoScroll.current = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recompute = useCallback((): void => {
    const current = live.current
    if (current.phase === 'idle') return

    const { x, y, ctrl, alt } = pointer.current
    const point = pointAt(x, y, current.origin.day)
    const options = alt
      ? { step: 1, edges: [] }
      : {
          step: settings.snapMinutes,
          edges: edgesOn(timed, point.day, current.subject?.id ?? null)
        }

    set(advance(current, { x, y }, point, options, { duplicate: ctrl }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointAt, settings.snapMinutes, timed, set])

  function begin(
    pointerEvent: React.PointerEvent,
    mode: DragMode,
    block: CalendarBlockWithContext | null
  ): void {
    if (pointerEvent.button !== 0) return
    // Stopped before anything else, or a press on a block that cannot move
    // would fall through to the column beneath and start drawing a new one.
    pointerEvent.stopPropagation()
    setNaming(null)

    if (block && (block.locked || !blockTypeMeta(block.blockType).draggable)) {
      // Still openable, just not movable.
      if (mode === 'move') onOpenBlock(block)
      return
    }

    const fallback = block ? dayOf(block.startsAt) : (days[0] ?? today)
    const origin = pointAt(pointerEvent.clientX, pointerEvent.clientY, fallback)
    pointer.current = {
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
      ctrl: pointerEvent.ctrlKey,
      alt: pointerEvent.altKey
    }

    set(
      press(
        mode,
        origin,
        { x: pointerEvent.clientX, y: pointerEvent.clientY },
        block ? { id: block.id, startsAt: block.startsAt, endsAt: block.endsAt } : null
      )
    )
  }

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (live.current.phase === 'idle') return
      pointer.current = {
        x: event.clientX,
        y: event.clientY,
        ctrl: event.ctrlKey,
        alt: event.altKey
      }
      recompute()
      runAutoScroll()

      // Holding against a side turns the page, once, after a beat. A drag that
      // sweeps across the edge on its way somewhere else must not trigger it,
      // which is what the delay buys.
      const bounds = body.current?.getBoundingClientRect()
      if (!bounds || live.current.phase !== 'dragging' || live.current.mode === 'create') {
        stopEdgeHold()
        return
      }

      const direction: 1 | -1 | 0 =
        event.clientX < bounds.left + EDGE_ZONE
          ? -1
          : event.clientX > bounds.right - EDGE_ZONE
            ? 1
            : 0

      if (direction === 0) {
        stopEdgeHold()
      } else if (edgeHold.current?.direction !== direction) {
        stopEdgeHold()
        edgeHold.current = {
          direction,
          timer: window.setTimeout(() => {
            edgeHold.current = null
            onAdvance(direction)
          }, EDGE_HOLD_MS)
        }
      }
    }

    const onUp = (): void => {
      stopEdgeHold()
      stopAutoScroll()

      const current = live.current
      const result = release(current)
      set(idle)

      // A click on empty grid is a create too — it just says nothing about how
      // long, so it takes the default length. Dragging is how you say more.
      if (result.kind === 'none' && current.phase === 'pending' && current.mode === 'create') {
        const start = Math.round(current.origin.minutes / 30) * 30
        setTitle('')
        setNaming({
          startsAt: stampAt(current.origin.day, start),
          endsAt: stampAt(current.origin.day, start + settings.defaultBlockMinutes)
        })
        return
      }

      if (result.kind === 'click') {
        const block = blocks.find((one) => one.id === result.subject.id)
        if (block) onOpenBlock(block)
        return
      }
      if (result.kind === 'create') {
        // §6.3: an inline title, never a modal. The block is drawn where it
        // was dragged and asks for a name in place; the modal is for editing
        // something that already exists.
        setTitle('')
        setNaming(result.span)
        return
      }
      if (result.kind === 'commit') {
        const block = blocks.find((one) => one.id === result.subject.id)
        if (!block) return
        if (result.duplicate) onDuplicate(block, result.span)
        else onReschedule(block, result.span)
      }
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (live.current.phase === 'idle') return
      // Reverting is simply forgetting: nothing has been written, so there is
      // nothing to put back and nothing to undo afterwards.
      event.preventDefault()
      stopEdgeHold()
      stopAutoScroll()
      set(cancel())
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      stopEdgeHold()
      stopAutoScroll()
    }
  }, [
    blocks,
    onAdvance,
    onCreate,
    onDuplicate,
    onOpenBlock,
    onReschedule,
    recompute,
    runAutoScroll,
    set,
    settings.defaultBlockMinutes
  ])

  /* ---------------- dropping a task from the rail ---------------- */

  const [dropAt, setDropAt] = useState<GridPoint | null>(null)

  useEffect(() => {
    if (!pendingTask) {
      setDropAt(null)
      return
    }

    const onMove = (event: PointerEvent): void => {
      const over = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-column-day]')
      // Off the grid entirely means no target, which is what makes dropping a
      // task back on the rail a cancel rather than a schedule at midnight.
      if (!over) {
        setDropAt(null)
        return
      }
      const point = pointAt(event.clientX, event.clientY, over.dataset.columnDay ?? today)
      setDropAt({
        day: point.day,
        minutes: Math.round(point.minutes / settings.snapMinutes) * settings.snapMinutes
      })
    }

    const onUp = (): void => {
      const target = dropTarget.current
      setDropAt(null)
      if (target) onScheduleTask(pendingTask, stampAt(target.day, target.minutes))
      else onCancelTaskDrag()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancelTaskDrag()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [pendingTask, pointAt, settings.snapMinutes, today, onScheduleTask, onCancelTaskDrag])

  // Read on pointerup, by which time the state above is a frame stale.
  const dropTarget = useRef<GridPoint | null>(null)
  dropTarget.current = dropAt

  /**
   * Planned against actual, where there is anything to compare.
   *
   * Null for a block scheduling nothing, and null before any time is tracked:
   * a block for next Thursday reading "0m of 90m" would report a shortfall on
   * work nobody has started.
   */
  function varianceFor(
    block: CalendarBlockWithContext,
    segment: { start: number; end: number }
  ): { planned: number; over: boolean } | null {
    if (block.taskId === null || block.trackedMinutes === 0) return null
    const planned = segment.end - segment.start
    return { planned, over: block.trackedMinutes > planned }
  }

  /**
   * Whether a block is something you would time.
   *
   * Work you could bill or account for, and nothing already being timed. A
   * play button on a holiday would be an offer to record a holiday as work.
   */
  function timerFor(block: CalendarBlockWithContext): boolean {
    if (running) return false
    if (block.locked) return false
    return block.blockType === 'focus' || block.blockType === 'task'
  }

  /** The dragged block's provisional span, so the drag reads as direct. */
  function spanOf(block: CalendarBlockWithContext): Span {
    return state.phase === 'dragging' && state.subject?.id === block.id && !state.duplicate
      ? state.span
      : block
  }

  const nowDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const dayCapacity = settings.dailyCapacityMinutes

  const weekTotal = days.reduce((total, day) => total + (committed.get(day) ?? 0), 0)
  // Capacity is per working day, so a week with a bank holiday in it has less
  // of it. Counting all seven would quietly say there was a day spare.
  const weekCapacity = days.filter((day) => isWorkingDay(settings.workingDays, day)).length *
    dayCapacity

  /** The block being drawn, or the copy a Ctrl-drag is trailing. */
  const ghost =
    state.phase === 'dragging' && (state.mode === 'create' || state.duplicate)
      ? state.span
      : naming

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
              {/* What the day already costs, said before you add to it. */}
              <span
                className={cn(
                  'numeric text-[10px] tabular-nums',
                  minutes === 0 ? 'text-faint/40' : over ? 'text-danger' : 'text-faint'
                )}
              >
                {minutes === 0 ? '·' : durationLabel(minutes)}
              </span>
            </div>
          )
        })}
      </div>

      {/* The week, in one line.
          Under the headers rather than above them, because it summarises what
          is below it — and because a figure at the very top of a calendar
          reads as a title. */}
      {days.length > 1 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-1">
          <span className="text-[10.5px] tracking-[0.06em] text-faint uppercase">This week</span>
          <span className="numeric text-[11px] text-ink">
            {durationLabel(weekTotal)} committed
          </span>
          <span className="text-[11px] text-faint">
            of {durationLabel(weekCapacity)} available
          </span>

          <span className="h-[4px] min-w-[80px] flex-1 overflow-hidden rounded-full bg-line">
            <span
              className={cn(
                'block h-full rounded-full transition-[width] duration-300',
                weekTotal > weekCapacity ? 'bg-danger' : 'bg-accent'
              )}
              style={{
                width: `${Math.min(100, weekCapacity > 0 ? (weekTotal / weekCapacity) * 100 : 0)}%`
              }}
            />
          </span>

          {/* Said out loud, and only when it is true. A calendar that warns
              about a normal week teaches people to ignore it. */}
          {weekTotal > weekCapacity && weekCapacity > 0 && (
            <span className="shrink-0 text-[11px] text-danger">
              {durationLabel(weekTotal - weekCapacity)} over
            </span>
          )}
        </div>
      )}

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

              {/* Deadlines, drawn dashed and unfilled so they never read as
                  something you can pick up. None of these is a block; each is
                  a date living somewhere else, shown here. */}
              {markers
                .filter((marker) => marker.day === day)
                .map((marker) => (
                  <span
                    key={`${marker.kind}-${marker.id}`}
                    title={`${marker.label} · ${marker.detail}`}
                    style={{ borderColor: marker.colour || undefined }}
                    className={cn(
                      'flex items-center gap-1 truncate rounded-[4px] border border-dashed px-1.5 py-[1px] text-[10px]',
                      marker.colour ? 'text-ink' : 'border-line-strong text-muted'
                    )}
                  >
                    <span aria-hidden className="shrink-0 text-faint">
                      {MARKER_GLYPH[marker.kind]}
                    </span>
                    <span className="truncate">{marker.label}</span>
                  </span>
                ))}
            </div>
          )
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={body} className="flex" style={{ height: 24 * hourHeight }}>
          <div className="w-[52px] shrink-0 border-r border-line">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: hourHeight }}
                className="relative border-b border-line/50"
              >
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
            const ghostHere = ghost && dayOf(ghost.startsAt) === day ? ghost : null

            return (
              <div
                key={day}
                data-column-day={day}
                onPointerDown={(pointerEvent) => begin(pointerEvent, 'create', null)}
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
                  <div
                    key={hour}
                    style={{ height: hourHeight }}
                    className="border-b border-line/50"
                  >
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

                {/* Where the task from the rail would land. Its own shape
                    rather than a full ghost block: nothing has been decided
                    yet, and drawing a finished block would say otherwise. */}
                {pendingTask && dropAt?.day === day && (
                  <div
                    aria-hidden
                    style={{
                      top: dropAt.minutes * perMinute,
                      height:
                        (pendingTask.estimateMinutes ?? settings.defaultBlockMinutes) * perMinute
                    }}
                    className="pointer-events-none absolute inset-x-[2px] z-40 rounded-[5px] border border-dashed border-accent bg-accent-subtle px-1.5 py-0.5"
                  >
                    <p className="truncate text-[11.5px] font-medium text-ink">
                      {pendingTask.title}
                    </p>
                    <p className="numeric truncate text-[10px] text-muted">
                      {timeOf(stampAt(day, dropAt.minutes))}
                      {pendingTask.estimateMinutes === null && ' · no estimate'}
                    </p>
                  </div>
                )}

                {ghostHere && (
                  <Ghost
                    span={ghostHere}
                    perMinute={perMinute}
                    naming={naming !== null}
                    title={title}
                    onTitle={setTitle}
                    onCommit={() => {
                      const trimmed = title.trim()
                      setNaming(null)
                      setTitle('')
                      if (trimmed) onCreate(ghostHere, trimmed)
                    }}
                    onCancel={() => {
                      setNaming(null)
                      setTitle('')
                    }}
                  />
                )}

                {placed.map(({ item: block, column, columns, span: width }) => {
                  const span = spanOf(block)
                  const segment = segmentOn(span, day)
                  const height = (segment.end - segment.start) * perMinute
                  const detail = detailFor(height)
                  const meta = blockTypeMeta(block.blockType)
                  const dragging = state.phase === 'dragging' && state.subject?.id === block.id
                  const variance = varianceFor(block, segment)

                  return (
                    <div
                      key={block.id}
                      onPointerDown={(pointerEvent) => begin(pointerEvent, 'move', block)}
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
                        // Only shadow and opacity change during a drag. `top`
                        // and `height` are set directly and never transitioned,
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

                          {/* What was planned against what actually happened.
                              Only where there is a task to compare with, and
                              only once something has been tracked — "0m of
                              90m" on a block for next Thursday is not news. */}
                          {detail !== 'title' && variance !== null && (
                            <p
                              className={cn(
                                'numeric relative truncate text-[10px]',
                                variance.over ? 'text-danger' : 'text-muted'
                              )}
                            >
                              {durationLabel(block.trackedMinutes)} of{' '}
                              {durationLabel(variance.planned)}
                            </p>
                          )}
                        </>
                      )}

                      {/* Start the timer on this block. Hover-only, and only
                          where there is something to bill against — a play
                          button on a dentist appointment is noise. */}
                      {timerFor(block) && (
                        <button
                          type="button"
                          aria-label={`Start timing ${block.title}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            onStartTimer(block)
                          }}
                          className="absolute top-0.5 right-0.5 z-10 grid size-4 place-items-center rounded-[3px] bg-surface/90 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                        >
                          <Play size={9} strokeWidth={2.25} />
                        </button>
                      )}

                      {/* Resize grip: the bottom six pixels, so the rest of the
                          block stays a move target. */}
                      {!block.locked && meta.draggable && (
                        <div
                          onPointerDown={(pointerEvent) => begin(pointerEvent, 'resize', block)}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <div className="mx-auto h-[3px] w-6 rounded-full bg-ink/40" />
                        </div>
                      )}
                    </div>
                  )
                })}

                {runningSpan && dayOf(runningSpan.startsAt) === day && (
                  <RunningBlock
                    span={runningSpan}
                    perMinute={perMinute}
                    label={running?.entry.taskTitle || running?.entry.projectName || 'Timing'}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The timer, drawn where it is happening.
 *
 * Deliberately not a block: no fill, a moving edge, and nothing to grab. What
 * is being recorded is a time entry, and making it look like something you
 * could drag would invite somebody to try.
 */
function RunningBlock({
  span,
  perMinute,
  label
}: {
  span: Span
  perMinute: number
  label: string
}): React.JSX.Element {
  const start = minutesOf(span.startsAt)
  const minutes = Math.max(1, minutesBetween(span.startsAt, span.endsAt))

  return (
    <div
      aria-live="off"
      style={{ top: start * perMinute, height: Math.max(minutes * perMinute, 8) }}
      className="pointer-events-none absolute inset-x-[2px] z-20 overflow-hidden rounded-[5px] border border-accent bg-accent-subtle px-1.5"
    >
      <p className="flex items-center gap-1 truncate text-[10.5px] font-medium text-accent">
        <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="truncate">{label}</span>
        <span className="numeric shrink-0">{durationLabel(minutes)}</span>
      </p>
    </div>
  )
}

/**
 * The block being drawn, and then the box that asks what to call it.
 *
 * One component for both so the input appears exactly where the drag ended,
 * at exactly the size drawn — a name box that opens somewhere else has lost
 * the connection to the gesture that asked for it.
 */
function Ghost({
  span,
  perMinute,
  naming,
  title,
  onTitle,
  onCommit,
  onCancel
}: {
  span: Span
  perMinute: number
  naming: boolean
  title: string
  onTitle: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}): React.JSX.Element {
  const start = minutesOf(span.startsAt)
  const minutes = Math.max(MIN_BLOCK_MINUTES, minutesBetween(span.startsAt, span.endsAt))
  const height = minutes * perMinute

  return (
    <div
      onPointerDown={(event) => event.stopPropagation()}
      style={{ top: start * perMinute, height: Math.max(height - 2, 20) }}
      className="absolute inset-x-[2px] z-40 flex flex-col justify-between rounded-[5px] border-l-[3px] border-accent bg-accent-subtle px-1.5 py-0.5"
    >
      {naming ? (
        <input
          autoFocus
          value={title}
          onChange={(event) => onTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit()
            if (event.key === 'Escape') onCancel()
            event.stopPropagation()
          }}
          // Clicking away is a commit if there is something to commit, and a
          // cancel if there is not. Neither loses what was typed.
          onBlur={onCommit}
          placeholder="What is this?"
          className="w-full bg-transparent text-[11.5px] font-medium text-ink placeholder:text-faint focus:outline-none"
        />
      ) : (
        <p className="truncate text-[11.5px] font-medium text-ink">New block</p>
      )}

      {/* The length, while it is being decided. The one number that matters
          during the drag, and it is not otherwise visible anywhere. */}
      <p className="numeric truncate text-[10px] text-muted">
        {timeOf(span.startsAt)}–{timeOf(span.endsAt)} · {durationLabel(minutes)}
      </p>
    </div>
  )
}
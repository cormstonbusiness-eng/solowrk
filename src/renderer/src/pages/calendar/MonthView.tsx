import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import {
  dayOf,
  daysBetween,
  isSameMonth,
  isWorkingDay,
  monthGrid,
  occursOn,
  segmentOn,
  timeOf
} from '@shared/calendar'
import { cn } from '@/lib/utils'
import { transition } from '@/lib/motion'
import { WEEKDAY_LABELS, durationLabel } from './grid'

/** How far the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD = 4

/**
 * How many blocks a cell shows before it starts counting instead.
 *
 * Three, because a month cell is about sixty pixels of usable height at a
 * normal window size, and a fourth chip would push the count itself out of
 * view — which is the one thing that must never happen: a hidden block that
 * does not say it is hidden is a missed appointment.
 */
const VISIBLE_PER_CELL = 3

export function MonthView({
  month,
  today,
  blocks,
  settings,
  onOpenBlock,
  onCreateAt,
  onMoveBlock
}: {
  /** Any day in the month being shown. */
  month: string
  today: string
  blocks: CalendarBlockWithContext[]
  settings: CalendarSettings
  onOpenBlock: (block: CalendarBlockWithContext) => void
  onCreateAt: (day: string) => void
  onMoveBlock: (block: CalendarBlockWithContext, days: number) => void
}): React.JSX.Element {
  const days = monthGrid(month)
  const [dragging, setDragging] = useState<{ id: number; overDay: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
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
  function startDrag(pointerEvent: React.PointerEvent, block: CalendarBlockWithContext): void {
    if (pointerEvent.button !== 0) return
    if (block.locked || !blockTypeMeta(block.blockType).draggable) return
    origin.current = {
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
      day: dayOf(block.startsAt),
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
      setDragging({ id: block.id, overDay: overDay.current })
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
        onOpenBlock(block)
        return
      }

      if (target && target !== from.day) onMoveBlock(block, daysBetween(from.day, target))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const chip = (block: CalendarBlockWithContext, key?: string): React.JSX.Element => (
    <motion.button
      key={key ?? block.id}
      layoutId={`block-${block.id}`}
      transition={transition.layout}
      type="button"
      onPointerDown={(pointerEvent) => startDrag(pointerEvent, block)}
      style={{
        backgroundColor: `${block.displayColour}2e`,
        borderColor: block.displayColour
      }}
      className={cn(
        'flex items-center gap-1.5 truncate rounded-[4px] border-l-[3px] px-1.5 py-[3px]',
        'text-left text-[11px] text-ink transition-opacity hover:opacity-80',
        dragging?.id === block.id && 'opacity-50'
      )}
    >
      {!block.allDay && (
        <span className="numeric shrink-0 text-[10px] text-muted">{timeOf(block.startsAt)}</span>
      )}
      <span className="truncate">{block.title}</span>
    </motion.button>
  )

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

      {/* Always six rows, whatever the month. A grid that is five rows in
          February and six in March makes every cell change height when you
          page, and the day you were looking at moves under the cursor. */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const dayBlocks = blocks.filter((block) => occursOn(block, day))
          const outside = !isSameMonth(day, month)
          const isToday = day === today
          const working = isWorkingDay(settings.workingDays, day)

          const committed = dayBlocks.reduce((total, block) => {
            if (block.allDay || !blockTypeMeta(block.blockType).counts) return total
            const segment = segmentOn(block, day)
            return total + (segment.end - segment.start)
          }, 0)
          const capacity = settings.dailyCapacityMinutes
          const load = capacity > 0 ? committed / capacity : 0
          const hidden = dayBlocks.length - VISIBLE_PER_CELL

          return (
            <div
              key={day}
              data-day={day}
              onDoubleClick={() => onCreateAt(day)}
              className={cn(
                'relative min-h-0 border-r border-b border-line p-1 last:border-r-0',
                outside && 'bg-ground/60',
                !outside && !working && 'bg-ground/30',
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

                {/* How full the day is, as a bar rather than a number. A month
                    is read by scanning, and four figures per row is a table. */}
                {committed > 0 && !outside && (
                  <span
                    className="h-[3px] w-8 overflow-hidden rounded-full bg-line"
                    title={`${durationLabel(committed)} committed`}
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        load > 1 ? 'bg-danger' : 'bg-accent'
                      )}
                      style={{ width: `${Math.min(100, load * 100)}%` }}
                    />
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-[3px] overflow-hidden">
                {dayBlocks.slice(0, VISIBLE_PER_CELL).map((block) => chip(block))}

                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(day)}
                    className="px-1 text-left text-[10.5px] text-faint transition-colors hover:text-ink"
                  >
                    +{hidden} more
                  </button>
                )}
              </div>

              {/* The rest of the day, in place. A popover rather than switching
                  to the day view, because the question is "what else is on
                  the 14th" and the answer should not cost you your month. */}
              <AnimatePresence>
                {expanded === day && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setExpanded(null)}
                      aria-hidden
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={transition.modal}
                      className="absolute top-0 left-0 z-50 w-[calc(100%+40px)] min-w-[170px] rounded-card border border-line-strong bg-surface p-2 shadow-xl"
                    >
                      <p className="mb-1.5 px-1 text-[10.5px] tracking-[0.06em] text-faint uppercase">
                        {Number(day.slice(8))} · {dayBlocks.length} blocks
                      </p>
                      <div className="flex max-h-[220px] flex-col gap-[3px] overflow-y-auto">
                        {dayBlocks.map((block) => chip(block, `popover-${block.id}`))}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
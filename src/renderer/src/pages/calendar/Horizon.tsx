import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CalendarSettings } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import { addDays, isWorkingDay, occursOn, segmentOn } from '@shared/calendar'
import { cn } from '@/lib/utils'
import { durationLabel } from './grid'

/**
 * The next ninety days, in twenty-four pixels.
 *
 * Every other calendar makes you navigate to see the future: to answer "when
 * am I free in October?" you page forward eight times and page back. This is
 * permanently visible, so the answer is a glance, and dragging the window
 * region scrubs the grid below in real time — which turns the same question
 * into a two-second gesture.
 *
 * It costs 24px and adds no chrome: no toolbar, no legend, nothing to switch
 * on. That is the whole argument for it.
 */

/** §17.2: ninety days, which is one quarter and about as far as anybody plans. */
const HORIZON_DAYS = 90

export function Horizon({
  today,
  days,
  settings,
  onJump
}: {
  today: string
  /** The days on screen, drawn as the bright window. */
  days: string[]
  settings: CalendarSettings
  onJump: (day: string) => void
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ day: string; x: number } | null>(null)
  const scrubbing = useRef(false)

  const from = today
  const to = addDays(today, HORIZON_DAYS - 1)

  // Its own query over its own range: the strip looks three months ahead and
  // the grid looks at one week, and making the grid fetch a quarter so the
  // strip could borrow it would be the wrong way round.
  const { data: blocks = [] } = useQuery({
    queryKey: ['calendar', 'horizon', from, to],
    queryFn: () => window.solo.invoke('calendar:blocks', { from, to }),
    staleTime: 30_000
  })

  const { data: markers = [] } = useQuery({
    queryKey: ['calendar', 'markers', from, to],
    queryFn: () => window.solo.invoke('calendar:markers', { from, to }),
    staleTime: 30_000
  })

  const span = useMemo(
    () => Array.from({ length: HORIZON_DAYS }, (_, index) => addDays(from, index)),
    [from]
  )

  /** Committed minutes per day, which is the height of each bar. */
  const load = useMemo(() => {
    const totals = new Map<string, number>()
    for (const block of blocks) {
      if (block.allDay || !blockTypeMeta(block.blockType).counts) continue
      for (const day of span) {
        if (!occursOn(block, day)) continue
        const segment = segmentOn(block, day)
        totals.set(day, (totals.get(day) ?? 0) + (segment.end - segment.start))
      }
    }
    return totals
  }, [blocks, span])

  const deadlines = useMemo(() => {
    const byDay = new Map<string, string[]>()
    for (const marker of markers) {
      byDay.set(marker.day, [...(byDay.get(marker.day) ?? []), marker.label])
    }
    return byDay
  }, [markers])

  const visible = new Set(days)
  const capacity = settings.dailyCapacityMinutes

  /** Which day a pointer position is over. */
  const dayAt = (clientX: number): string | null => {
    const bounds = strip.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0) return null
    const ratio = (clientX - bounds.left) / bounds.width
    const index = Math.floor(ratio * HORIZON_DAYS)
    return span[Math.max(0, Math.min(HORIZON_DAYS - 1, index))] ?? null
  }

  /**
   * Scrubbing: the grid follows the pointer continuously rather than jumping
   * on release. Following is the entire point — it is what makes skimming a
   * quarter feel like turning pages rather than like a series of guesses.
   */
  const startScrub = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    scrubbing.current = true
    const first = dayAt(event.clientX)
    if (first) onJump(first)

    const onMove = (move: PointerEvent): void => {
      if (!scrubbing.current) return
      const day = dayAt(move.clientX)
      if (day) onJump(day)
    }
    const onUp = (): void => {
      scrubbing.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="relative mb-2 shrink-0">
      <div
        ref={strip}
        onPointerDown={startScrub}
        onPointerMove={(event) => {
          const day = dayAt(event.clientX)
          if (day) setHover({ day, x: event.clientX })
        }}
        onPointerLeave={() => setHover(null)}
        className="flex h-[24px] cursor-ew-resize items-end gap-px overflow-hidden rounded-control bg-raised px-px"
      >
        {span.map((day) => {
          const minutes = load.get(day) ?? 0
          const over = capacity > 0 && minutes > capacity
          const height = capacity > 0 ? Math.min(1, minutes / capacity) : 0
          const working = isWorkingDay(settings.workingDays, day)
          const monday = day === startOfWeekish(day)

          return (
            <div
              key={day}
              className={cn(
                'relative flex-1 self-stretch',
                // The current view, as a brighter region. Soft edges rather
                // than a hard box: it is a region of interest, not a control.
                visible.has(day) && 'bg-overlay',
                !working && 'opacity-40'
              )}
            >
              {/* Mondays slightly brighter, which is the only structure the
                  strip needs to be readable as weeks rather than as noise. */}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 w-px',
                  monday ? 'bg-line-strong' : 'bg-line/40'
                )}
              />

              {minutes > 0 && (
                <span
                  aria-hidden
                  style={{ height: `${Math.max(8, height * 100)}%` }}
                  className={cn(
                    'absolute inset-x-0 bottom-0 rounded-t-[1px]',
                    over ? 'bg-danger' : 'bg-accent'
                  )}
                />
              )}

              {/* Deadline pips sit above the bars, so a busy day never hides
                  the fact that something is due on it. */}
              {deadlines.has(day) && (
                <span
                  aria-hidden
                  className="absolute top-0 left-1/2 size-[4px] -translate-x-1/2 rotate-45 bg-danger"
                />
              )}

              {day === today && (
                <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-accent" />
              )}
            </div>
          )
        })}
      </div>

      {hover && (
        <div
          style={{ left: hover.x }}
          className="pointer-events-none fixed z-50 -translate-x-1/2 translate-y-1 rounded-control border border-line-strong bg-surface px-2 py-1 text-[11px] shadow-lg"
        >
          <p className="text-ink">{hover.day}</p>
          <p className="numeric text-faint">
            {(load.get(hover.day) ?? 0) === 0
              ? 'Nothing on'
              : durationLabel(load.get(hover.day) ?? 0)}
          </p>
          {deadlines.get(hover.day)?.map((label) => (
            <p key={label} className="text-danger">
              {label}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** The Monday of a day's week, for the brighter tick. */
function startOfWeekish(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(year, month - 1, date))
  const mondayFirst = (at.getUTCDay() + 6) % 7
  return new Date(at.getTime() - mondayFirst * 86_400_000).toISOString().slice(0, 10)
}

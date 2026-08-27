import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import { isWorkingDay, occursOn, segmentOn } from '@shared/calendar'

/**
 * When you could actually fit something.
 *
 * "When am I free?" is a question every freelancer answers several times a
 * week by squinting at a grid and counting. It is arithmetic, so it is done
 * here, once, and the same answer feeds the radar overlay, the smart drop and
 * the availability message — three features that would otherwise each have
 * their own idea of what "free" means and disagree in front of a client.
 */

/** §17.3: shorter than this is not a gap, it is the space between two things. */
export const MIN_GAP_MINUTES = 30

export interface Gap {
  day: string
  /** Minutes past midnight. */
  start: number
  end: number
  minutes: number
}

/**
 * The bookable holes in one day.
 *
 * Bounded by working hours, because a gap at 3am is not availability. Blocked
 * by anything that occupies you — and personal and holiday blocks *do* block
 * here, even though they never count as committed hours. Being at the dentist
 * makes you unavailable without making the afternoon billable, and those are
 * two different questions that share one grid.
 */
export function gapsOn(
  blocks: CalendarBlockWithContext[],
  day: string,
  settings: CalendarSettings,
  minMinutes = MIN_GAP_MINUTES
): Gap[] {
  if (!isWorkingDay(settings.workingDays, day)) return []

  const busy = blocks
    // On this day first. `segmentOn` answers "where does this sit on that
    // day" and gives an answer for a block that is not on it at all, so
    // without this a Tuesday meeting blanks out Monday.
    .filter((block) => occursOn(block, day))
    .filter((block) => !block.allDay)
    .filter((block) => occupies(block))
    .map((block) => segmentOn(block, day))
    .filter((span) => span.end > settings.workingHoursStart && span.start < settings.workingHoursEnd)
    .sort((a, b) => a.start - b.start)

  const gaps: Gap[] = []
  let cursor = settings.workingHoursStart

  for (const span of busy) {
    if (span.start - cursor >= minMinutes) {
      gaps.push({ day, start: cursor, end: span.start, minutes: span.start - cursor })
    }
    // Overlapping blocks must not wind the cursor backwards, or the gap after
    // a long block would be measured from the short one that sat inside it.
    cursor = Math.max(cursor, span.end)
  }

  if (settings.workingHoursEnd - cursor >= minMinutes) {
    gaps.push({
      day,
      start: cursor,
      end: settings.workingHoursEnd,
      minutes: settings.workingHoursEnd - cursor
    })
  }

  return gaps
}

/**
 * Whether a block makes you unavailable.
 *
 * Everything except a deadline, which is a date rather than an occupation —
 * a marker on the day the thing is due, not three hours you are busy for.
 */
function occupies(block: CalendarBlockWithContext): boolean {
  return blockTypeMeta(block.blockType).value !== 'deadline'
}

/** Every gap across a range of days, in order. */
export function gapsAcross(
  blocks: CalendarBlockWithContext[],
  days: string[],
  settings: CalendarSettings,
  minMinutes = MIN_GAP_MINUTES
): Gap[] {
  return days.flatMap((day) => gapsOn(blocks, day, settings, minMinutes))
}

/**
 * The gap a rough drop should land in.
 *
 * §17.3's smart drop: dragging at Wednesday-ish with Space held should put
 * the thing cleanly in the two-hour hole at 14:00, not at the raw cursor
 * position halfway through an existing block.
 *
 * Only gaps that actually fit are candidates, because snapping something into
 * a hole too small for it would be worse than leaving it where the pointer
 * was — it would look tidy and be wrong.
 */
export function nearestGap(
  gaps: Gap[],
  target: { day: string; minutes: number },
  needsMinutes: number
): Gap | null {
  const fits = gaps.filter((gap) => gap.minutes >= needsMinutes)
  if (fits.length === 0) return null

  let best: Gap | null = null
  let closest = Infinity

  for (const gap of fits) {
    // A day away is worth more than any distance within a day, so the day is
    // weighted past the width of one: dropping on Wednesday must never land
    // on Tuesday because Tuesday's hole happened to be nearer the cursor.
    const dayGap = Math.abs(dayIndex(gap.day) - dayIndex(target.day)) * 10_000
    const within =
      target.minutes < gap.start
        ? gap.start - target.minutes
        : target.minutes > gap.end
          ? target.minutes - gap.end
          : 0

    const distance = dayGap + within
    if (distance < closest) {
      closest = distance
      best = gap
    }
  }

  return best
}

function dayIndex(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000)
}

/**
 * The free time in a range, as the sentence somebody would otherwise type.
 *
 * §17.5. Every freelancer writes this message by hand several times a week,
 * and writing it by hand is how "Thursday" ends up meaning a Thursday that is
 * already booked.
 */
export function describeAvailability(
  gaps: Gap[],
  format: (day: string) => string,
  fullDayMinutes: number
): string {
  const byDay = new Map<string, Gap[]>()
  for (const gap of gaps) {
    byDay.set(gap.day, [...(byDay.get(gap.day) ?? []), gap])
  }

  const lines: string[] = []
  for (const [day, dayGaps] of byDay) {
    const total = dayGaps.reduce((sum, gap) => sum + gap.minutes, 0)
    // A day with nothing in it says "all day" rather than listing its own
    // working hours back at somebody, which is what a machine would write.
    const spans =
      dayGaps.length === 1 && total >= fullDayMinutes
        ? 'all day'
        : dayGaps.map((gap) => `${clock(gap.start)}–${clock(gap.end)}`).join(', ')
    lines.push(`${format(day)} — ${spans}`)
  }

  return lines.join('\n')
}

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

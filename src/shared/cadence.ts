import { addDays, addMonths, startOfMonth, startOfWeek } from './calendar'

/**
 * The commitment, and the holes it leaves.
 *
 * §4.2 calls this the single highest-value feature in Marketing, and the
 * reasoning is worth keeping next to the code: freelance marketing fails on
 * consistency, not on strategy. Everybody knows they should post; almost
 * nobody does it in the weeks when work is busy, which are exactly the weeks
 * that decide whether there is work in three months. A commitment made visible
 * is the only mechanism that reliably fixes that.
 *
 * So a channel carries a number — two a week, one a month — and the calendar
 * draws the difference between that number and what is actually there. Not as
 * tasks, not as reminders. As gaps.
 *
 * **Nothing here enforces anything.** Missing a commitment produces a quiet
 * mark and no more: no streaks, no badges, no guilt. Those produce abandonment
 * rather than behaviour change, which is the opposite of the point.
 */

export type CadencePeriod = 'week' | 'month'

export interface Commitment {
  /** How many per period. Zero means no commitment, which is a real answer. */
  count: number
  period: CadencePeriod
}

/** The first day of the period a given day falls in. */
export function periodStart(day: string, period: CadencePeriod): string {
  return period === 'week' ? startOfWeek(day) : startOfMonth(day)
}

/** The first day of the period after this one. */
export function nextPeriod(day: string, period: CadencePeriod): string {
  return period === 'week' ? addDays(periodStart(day, 'week'), 7) : addMonths(periodStart(day, 'month'), 1)
}

/** Every period start between two days, inclusive of the one `from` sits in. */
export function periodsBetween(from: string, to: string, period: CadencePeriod): string[] {
  const starts: string[] = []

  let cursor = periodStart(from, period)
  while (cursor <= to) {
    starts.push(cursor)
    cursor = nextPeriod(cursor, period)
  }

  return starts
}

/**
 * Where the slots for one period sit.
 *
 * Spread across the period rather than stacked at the start, because a week
 * showing two ghosts on Monday says something different from one showing them
 * on Tuesday and Thursday — the second reads as a rhythm, which is the thing
 * being encouraged.
 *
 * Weekdays only for a weekly commitment. Nobody sets out to post at the
 * weekend, and drawing a gap on a Sunday invites ignoring the whole feature.
 */
export function slotDays(start: string, commitment: Commitment): string[] {
  if (commitment.count <= 0) return []

  const span = commitment.period === 'week' ? 5 : daysInMonth(start)
  const wanted = Math.min(commitment.count, span)
  const days: string[] = []

  for (let i = 0; i < wanted; i += 1) {
    // Evenly spaced, biased to the middle of each division rather than its
    // edge, so a single weekly slot lands mid-week instead of on Monday.
    const offset = Math.floor(((i + 0.5) * span) / wanted)
    days.push(addDays(start, Math.min(offset, span - 1)))
  }

  return days
}

function daysInMonth(start: string): number {
  const [year, month] = start.split('-').map(Number)
  return new Date(Date.UTC(year!, month!, 0)).getUTCDate()
}

export interface Ghost {
  day: string
  channelId: number
}

/**
 * The gaps to draw, for one channel, over a range.
 *
 * A ghost appears only where the commitment is not already met: a channel
 * promising two a week with one written shows one gap, not two, and none at
 * all once both are there. That subtraction is the whole feature — a calendar
 * that drew the full commitment regardless would be a calendar of ghosts
 * somebody learns to ignore in a fortnight.
 *
 * Days that already carry something for this channel are skipped even when the
 * period is short, so a ghost never lands on top of real work.
 */
export function ghostsFor(
  channel: { id: number; cadenceCount: number; cadencePeriod: CadencePeriod },
  from: string,
  to: string,
  scheduled: string[]
): Ghost[] {
  const commitment: Commitment = {
    count: channel.cadenceCount,
    period: channel.cadencePeriod
  }
  if (commitment.count <= 0) return []

  const taken = new Set(scheduled)
  const ghosts: Ghost[] = []

  for (const start of periodsBetween(from, to, commitment.period)) {
    const end = nextPeriod(start, commitment.period)
    const done = scheduled.filter((day) => day >= start && day < end).length
    let missing = commitment.count - done
    if (missing <= 0) continue

    for (const day of slotDays(start, commitment)) {
      if (missing <= 0) break
      // Outside the window being drawn, or already spoken for.
      if (day < from || day > to || taken.has(day)) continue

      ghosts.push({ day, channelId: channel.id })
      taken.add(day)
      missing -= 1
    }
  }

  return ghosts
}

/* ------------------------------------------------------------------ *
 * Consistency
 * ------------------------------------------------------------------ */

export type Fill = 'none' | 'partial' | 'met'

/**
 * How a period went, as one of three answers.
 *
 * Three rather than a percentage on purpose. §8.2 draws these as a strip of
 * cells and the point of it is a *pattern* — posted through March, stopped in
 * April when a big project landed, started again in July when work dried up.
 * That shape is the actual problem, and seeing it drawn is more persuasive
 * than any advice. A gradient would make it prettier and harder to read.
 */
export function fillFor(done: number, commitment: Commitment): Fill {
  if (commitment.count <= 0) return 'none'
  if (done >= commitment.count) return 'met'
  return done > 0 ? 'partial' : 'none'
}

export interface Period {
  start: string
  done: number
  fill: Fill
}

/** Every period in a range, with what was published in it. */
export function consistency(
  commitment: Commitment,
  from: string,
  to: string,
  published: string[]
): Period[] {
  return periodsBetween(from, to, commitment.period).map((start) => {
    const end = nextPeriod(start, commitment.period)
    const done = published.filter((day) => day >= start && day < end).length

    return { start, done, fill: fillFor(done, commitment) }
  })
}

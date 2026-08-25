import type { Database, Row } from '../db'
import type { DashboardTrends, TrendPoint } from '@shared/types'
import { addDays, today } from '@shared/taxYear'

/**
 * Six periods of history behind each dashboard figure.
 *
 * A stat card showing one number says what is true; the same card with a line
 * under it says whether that is good. Nothing else in the app answers "is this
 * a normal month", and it is the first question anybody actually has.
 *
 * Money is reconstructed from dates rather than read from a journal, because
 * there is no journal — nothing snapshots what was outstanding last March. It
 * does not need one: `issue_date`, `due_date` and `paid_at` are enough to say
 * what was owed on any past day, and they are facts rather than a status that
 * has since moved on.
 *
 * The one thing this cannot reconstruct is a draft. An invoice raised in March
 * and sent in April looks, to this, like it was outstanding from March —
 * `status` is current and has no history. That is a known and small
 * inaccuracy in the shape of a line, never in a figure the user is shown.
 */

/** `yyyy-mm-01` for the month `back` months before the month containing `day`. */
function monthStart(day: string, back: number): string {
  const [year, month] = day.split('-').map(Number) as [number, number]
  const shifted = new Date(Date.UTC(year, month - 1 - back, 1))
  return shifted.toISOString().slice(0, 10)
}

/** The last day of the month starting at `start`. */
function monthEnd(start: string): string {
  const [year, month] = start.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function shortMonth(start: string): string {
  return new Date(`${start}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC'
  })
}

/** Monday of the week containing `day`. */
function weekStart(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const utc = new Date(Date.UTC(year, month - 1, date))
  // getUTCDay is 0 on Sunday, so shift it to a Monday-based working week.
  return addDays(utc.toISOString().slice(0, 10), -((utc.getUTCDay() + 6) % 7))
}

const PERIODS = 6

export function trends(db: Database, asOf = today()): DashboardTrends {
  const months = Array.from({ length: PERIODS }, (_, index) =>
    monthStart(asOf, PERIODS - 1 - index)
  )

  const sum = (sql: string, params: (string | number)[]): number =>
    db.get<Row & { total: number | null }>(sql, params)?.total ?? 0

  /** Everything invoiced and not yet settled as at the close of `day`. */
  const owedOn = (day: string, overdueOnly: boolean): number =>
    sum(
      `SELECT SUM(gross) AS total FROM invoices
        WHERE status IN ('sent', 'paid')
          AND issue_date <= ?
          AND (paid_at IS NULL OR paid_at > ?)
          ${overdueOnly ? 'AND due_date < ?' : ''}`,
      overdueOnly ? [day, day, day] : [day, day]
    )

  const paid: TrendPoint[] = months.map((start) => ({
    label: shortMonth(start),
    value: sum(
      `SELECT SUM(gross) AS total FROM invoices
        WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?`,
      [start, monthEnd(start)]
    )
  }))

  /**
   * Point-in-time, so the last bucket is today rather than the end of a month
   * that has not happened. A figure the card reports as "now" and a line
   * ending a fortnight in the future would not agree, and the card is right.
   */
  const closeOf = (start: string): string => {
    const end = monthEnd(start)
    return end > asOf ? asOf : end
  }

  const outstanding: TrendPoint[] = months.map((start) => ({
    label: shortMonth(start),
    value: owedOn(closeOf(start), false)
  }))

  const overdue: TrendPoint[] = months.map((start) => ({
    label: shortMonth(start),
    value: owedOn(closeOf(start), true)
  }))

  const thisWeek = weekStart(asOf)
  const tracked: TrendPoint[] = Array.from({ length: PERIODS }, (_, index) => {
    const start = addDays(thisWeek, -7 * (PERIODS - 1 - index))
    return {
      label: start.slice(8, 10),
      value: sum(
        `SELECT SUM(duration) AS total FROM time_entries
          WHERE ended_at IS NOT NULL AND date(started_at) >= ? AND date(started_at) <= ?`,
        [start, addDays(start, 6)]
      )
    }
  })

  return { paid, outstanding, overdue, tracked }
}

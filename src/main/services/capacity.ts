import type { Database, Row } from '../db'
import type { CapacityInput } from '@shared/capacity'
import { DEFAULT_UTILISATION, DEFAULT_WEEKS } from '@shared/capacity'
import { addDays, today } from '@shared/taxYear'
import { getCalendarSettings } from './calendarSettings'
import { getSettings } from './settings'

/**
 * Where the capacity calculator starts from.
 *
 * Seeded from what the user has actually done, not from what they would like
 * to think. A calculator run on optimism produces an optimistic answer and
 * changes nothing — the value of the exercise is in the moment somebody sees
 * that last year's utilisation was 48% while they had been planning on 80%.
 *
 * Where there is not enough history to say anything honest, it falls back to
 * figures that are realistic for a solo freelancer and says which of the two
 * it used.
 */

/** Below this there is not enough tracked time to draw a conclusion from. */
const ENOUGH_HOURS = 40

export interface CapacityDefaults extends CapacityInput {
  /** True when utilisation came from tracked history rather than a default. */
  fromHistory: boolean
  /** Billable hours actually tracked in the last year. */
  trackedBillableHours: number
  /** Everything tracked, billable or not. */
  trackedHours: number
  /** What an hour has really earned, across billed work. */
  actualRate: number
}

export function capacityDefaults(db: Database, asOf: string = today()): CapacityDefaults {
  const settings = getSettings(db)
  const calendar = getCalendarSettings(db)
  const from = addDays(asOf, -365)

  const tracked = db.get<Row & { total: number | null; billable: number | null }>(
    `SELECT SUM(duration) AS total,
            SUM(CASE WHEN billable = 1 THEN duration ELSE 0 END) AS billable
       FROM time_entries
      WHERE ended_at IS NOT NULL AND date(started_at) >= ? AND date(started_at) <= ?`,
    [from, asOf]
  )

  const trackedHours = round((tracked?.total ?? 0) / 3600)
  const billableHours = round((tracked?.billable ?? 0) / 3600)

  // Hours in a working week, from the calendar the user has actually set up.
  const workingDays = countBits(calendar.workingDays)
  const hoursPerWeek = round((calendar.dailyCapacityMinutes / 60) * workingDays)
  const availableHours = hoursPerWeek * DEFAULT_WEEKS

  /**
   * Utilisation from history, when there is enough of it.
   *
   * Measured against the hours the calendar says are available rather than
   * against hours tracked, because the unbilled half of the problem is mostly
   * time nobody started a timer for at all.
   */
  const fromHistory = billableHours >= ENOUGH_HOURS && availableHours > 0
  const utilisation = fromHistory
    ? Math.min(10_000, Math.round((billableHours / availableHours) * 10_000))
    : DEFAULT_UTILISATION

  // What billed work has really earned per hour, which is very often below
  // the headline rate.
  const earned = db.get<Row & { value: number | null; seconds: number | null }>(
    `SELECT SUM(duration * rate / 3600.0) AS value, SUM(duration) AS seconds
       FROM time_entries
      WHERE ended_at IS NOT NULL AND billable = 1
        AND date(started_at) >= ? AND date(started_at) <= ?`,
    [from, asOf]
  )
  const actualRate =
    (earned?.seconds ?? 0) > 0
      ? Math.round((earned!.value ?? 0) / ((earned!.seconds ?? 1) / 3600))
      : settings.defaultHourlyRate

  const costs =
    db.get<Row & { total: number | null }>(
      'SELECT SUM(total) AS total FROM expenses WHERE date >= ? AND date <= ?',
      [from, asOf]
    )?.total ?? 0

  return {
    weeksPerYear: DEFAULT_WEEKS,
    hoursPerWeek,
    utilisationBasisPoints: utilisation,
    rate: settings.defaultHourlyRate,
    annualCosts: costs,
    // The set-aside percentage they have already chosen, so this page and the
    // tax page do not quietly disagree about what tax costs.
    taxBasisPoints: settings.taxSetAsidePercent * 100,
    fromHistory,
    trackedBillableHours: billableHours,
    trackedHours,
    actualRate
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function countBits(mask: number): number {
  let bits = 0
  for (let day = 0; day < 7; day += 1) if (mask & (1 << day)) bits += 1
  return bits
}

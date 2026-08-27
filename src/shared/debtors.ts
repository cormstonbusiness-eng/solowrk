/**
 * Aged debt.
 *
 * The report an accountant means by "who owes you and how long have they owed
 * it". A single "outstanding" figure hides the only thing worth knowing: £4,000
 * owed for a week is a business running normally, and £4,000 owed for four
 * months is a problem that has been quietly getting worse.
 *
 * **Aged by due date, not by invoice date.** Both conventions exist. Ageing by
 * the due date answers "how late is this", which is the question that leads to
 * an action; ageing by the issue date would put an invoice on 90-day terms in
 * the 61–90 bucket on the day it fell due, which reads as a crisis and is not
 * one. The choice is stated here rather than left to be inferred from the
 * arithmetic.
 */

export const DEBT_BUCKETS = ['current', 'to30', 'to60', 'to90', 'over90'] as const
export type DebtBucket = (typeof DEBT_BUCKETS)[number]

export const BUCKET_LABELS: Record<DebtBucket, string> = {
  current: 'Not yet due',
  to30: '1–30 days',
  to60: '31–60 days',
  to90: '61–90 days',
  over90: 'Over 90 days'
}

/** A short form for column headings, where the full label will not fit. */
export const BUCKET_SHORT: Record<DebtBucket, string> = {
  current: 'Current',
  to30: '1–30',
  to60: '31–60',
  to90: '61–90',
  over90: '90+'
}

/**
 * Which bucket a given lateness falls in.
 *
 * Zero is "not yet due": an invoice due today is not late today. Getting that
 * off by one would put every invoice into the overdue column on the morning it
 * became payable, and the report would cry wolf on the day it was most likely
 * to be read.
 */
export function bucketFor(daysOverdue: number): DebtBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'to30'
  if (daysOverdue <= 60) return 'to60'
  if (daysOverdue <= 90) return 'to90'
  return 'over90'
}

/** An empty set of bucket totals, for summing into. */
export function emptyBuckets(): Record<DebtBucket, number> {
  return { current: 0, to30: 0, to60: 0, to90: 0, over90: 0 }
}

/**
 * Whole days between two `yyyy-mm-dd` dates.
 *
 * Parsed as UTC midnight deliberately. Building a local `Date` from a date-only
 * string and subtracting can come out a day wrong across a DST boundary, and a
 * day either way is what moves an invoice between two buckets.
 */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

/**
 * How much attention a debt wants, so a row can look like what it is.
 *
 * Not the same as the bucket: an invoice for ninety pounds a fortnight late is
 * a nudge, and the same invoice for nine thousand is a phone call. Buckets
 * describe age; this describes urgency, and the two only mostly agree.
 */
export type DebtHeat = 'calm' | 'watch' | 'urgent'

export function heatFor(daysOverdue: number): DebtHeat {
  if (daysOverdue <= 0) return 'calm'
  if (daysOverdue <= 30) return 'watch'
  return 'urgent'
}

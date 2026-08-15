import type { Database, Row } from '../db'
import type { ClientTotal, FinancePoint, FinanceSummary, Pence } from '@shared/types'
import { secondsToHours, taxSetAside, timeValue } from '@shared/money'
import { today } from '@shared/taxYear'
import { getSettings } from './settings'

/**
 * Finance reporting.
 *
 * Income is counted when an invoice is **paid**, not when it is raised. For a
 * freelancer that is the number that matters — an invoice sent in March and
 * paid in May is May's income, and pretending otherwise makes both the cashflow
 * view and the tax set-aside wrong.
 */
export function summary(
  db: Database,
  range: { from: string; to: string; label: string }
): FinanceSummary {
  const settings = getSettings(db)

  const income =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(gross) AS total FROM invoices
        WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?`,
      [range.from, range.to]
    )?.total ?? 0

  const vatCollected =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(vat) AS total FROM invoices
        WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?`,
      [range.from, range.to]
    )?.total ?? 0

  // Outstanding and overdue ignore the range: what you are owed is a fact about
  // now, not about the period being viewed.
  const outstanding =
    db.get<Row & { total: number | null }>(
      "SELECT SUM(gross) AS total FROM invoices WHERE status = 'sent' AND paid_at IS NULL"
    )?.total ?? 0

  const overdue =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(gross) AS total FROM invoices
        WHERE status = 'sent' AND paid_at IS NULL AND due_date < ?`,
      [today()]
    )?.total ?? 0

  const expenses =
    db.get<Row & { total: number | null }>(
      'SELECT SUM(total) AS total FROM expenses WHERE date >= ? AND date <= ?',
      [range.from, range.to]
    )?.total ?? 0

  const trackedSeconds =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(duration) AS total FROM time_entries
        WHERE ended_at IS NOT NULL AND date(started_at) >= ? AND date(started_at) <= ?`,
      [range.from, range.to]
    )?.total ?? 0

  const unbilled = db.all<Row & { duration: number; rate: number }>(
    `SELECT duration, rate FROM time_entries
      WHERE ended_at IS NOT NULL AND billable = 1 AND invoice_line_id IS NULL`
  )

  const profit = income - expenses

  return {
    range,
    income,
    outstanding,
    overdue,
    expenses,
    profit,
    // Only ever set aside from a profit, never from a loss.
    setAside: profit > 0 ? taxSetAside(profit, settings.taxSetAsidePercent) : 0,
    vatCollected,
    hoursTracked: secondsToHours(trackedSeconds),
    unbilledValue: unbilled.reduce((sum, row) => sum + timeValue(row.duration, row.rate), 0)
  }
}

/**
 * Income and spending bucketed for the chart. Daily for short ranges, monthly
 * for long ones — a tax year of daily points is unreadable and mostly zeros.
 */
export function series(
  db: Database,
  range: { from: string; to: string },
  granularity: 'day' | 'month'
): FinancePoint[] {
  const bucket = granularity === 'day' ? '%Y-%m-%d' : '%Y-%m'

  const income = db.all<Row & { bucket: string; total: number }>(
    `SELECT strftime('${bucket}', paid_at) AS bucket, SUM(gross) AS total
       FROM invoices
      WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?
      GROUP BY bucket`,
    [range.from, range.to]
  )

  const expenses = db.all<Row & { bucket: string; total: number }>(
    `SELECT strftime('${bucket}', date) AS bucket, SUM(total) AS total
       FROM expenses
      WHERE date >= ? AND date <= ?
      GROUP BY bucket`,
    [range.from, range.to]
  )

  // Union the buckets so a month with spending but no income still appears.
  const buckets = new Set<string>([
    ...income.map((row) => row.bucket),
    ...expenses.map((row) => row.bucket)
  ])

  return Array.from(buckets)
    .sort()
    .map((key) => ({
      bucket: key,
      income: income.find((row) => row.bucket === key)?.total ?? 0,
      expenses: expenses.find((row) => row.bucket === key)?.total ?? 0
    }))
}

export function topClients(
  db: Database,
  range: { from: string; to: string },
  limit = 5
): ClientTotal[] {
  return db
    .all<Row & { client_id: number; client_name: string; colour: string; invoiced: number; paid: number }>(
      `SELECT c.id AS client_id, c.name AS client_name, c.colour AS colour,
              SUM(i.gross) AS invoiced,
              SUM(CASE WHEN i.status = 'paid' THEN i.gross ELSE 0 END) AS paid
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
        WHERE i.issue_date >= ? AND i.issue_date <= ? AND i.status != 'cancelled'
        GROUP BY c.id
        ORDER BY paid DESC, invoiced DESC
        LIMIT ?`,
      [range.from, range.to, limit]
    )
    .map((row) => ({
      clientId: row.client_id,
      clientName: row.client_name,
      colour: row.colour,
      invoiced: row.invoiced,
      paid: row.paid
    }))
}

/**
 * Profitability per project: what it earned against what the time was worth.
 *
 * This is the number that tells a freelancer a job was quietly paying below
 * their rate, which is rarely visible anywhere else.
 */
export function projectProfitability(db: Database): {
  projectId: number
  projectName: string
  colour: string
  budget: Pence | null
  invoiced: Pence
  trackedValue: Pence
  hours: number
}[] {
  return db
    .all<
      Row & {
        id: number
        name: string
        colour: string
        budget: number | null
        invoiced: number | null
      }
    >(
      `SELECT p.id, p.name, p.colour, p.budget,
              (SELECT SUM(gross) FROM invoices i
                WHERE i.project_id = p.id AND i.status != 'cancelled') AS invoiced
         FROM projects p
        WHERE p.archived = 0
        ORDER BY p.updated_at DESC`
    )
    .map((row) => {
      const entries = db.all<Row & { duration: number; rate: number }>(
        'SELECT duration, rate FROM time_entries WHERE project_id = ? AND ended_at IS NOT NULL',
        [row.id]
      )

      return {
        projectId: row.id,
        projectName: row.name,
        colour: row.colour,
        budget: row.budget,
        invoiced: row.invoiced ?? 0,
        trackedValue: entries.reduce((sum, entry) => sum + timeValue(entry.duration, entry.rate), 0),
        hours: secondsToHours(entries.reduce((sum, entry) => sum + entry.duration, 0))
      }
    })
}

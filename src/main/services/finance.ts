import type { Database, Row } from '../db'
import type { ClientTotal, FinancePoint, FinanceSummary, Pence } from '@shared/types'
import { secondsToHours, taxSetAside, timeValue } from '@shared/money'
import { UK_BANDS_2025_26, estimateTax, setAsideShortfall } from '@shared/tax'
import { currentTaxYear } from '@shared/taxYear'
import type { ClientProfitability, TaxPosition } from '@shared/types'
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

/**
 * Where the user stands with HMRC, this tax year.
 *
 * Deliberately its own call rather than part of `summary`: the estimate only
 * means anything over a whole tax year, and the summary answers for whatever
 * period is on screen. Folding one into the other would produce a "tax due"
 * figure for a Tuesday.
 *
 * Profit is measured on the cash basis, matching how the app counts income
 * everywhere else — what was received, not what was invoiced.
 */
export function taxPosition(db: Database, rules = UK_BANDS_2025_26): TaxPosition {
  const settings = getSettings(db)
  const year = currentTaxYear()

  const totals = summary(db, { from: year.start, to: year.end, label: year.label })
  const estimate = estimateTax(totals.profit, rules)
  const { held, shortfall, enough } = setAsideShortfall(estimate, settings.taxSetAsidePercent)

  return {
    taxYearLabel: year.label,
    rulesLabel: rules.label,
    profit: totals.profit,
    allowance: estimate.allowance,
    incomeTax: estimate.incomeTax,
    nationalInsurance: estimate.nationalInsurance,
    total: estimate.total,
    recommendedPercent: estimate.recommendedPercent,
    marginalPercent: estimate.marginalPercent,
    currentPercent: settings.taxSetAsidePercent,
    held,
    shortfall,
    enough
  }
}

/**
 * What each client actually pays, per hour.
 *
 * The uncomfortable number. A freelancer quotes £60 an hour, agrees a fixed
 * price, spends longer than they meant to, and never works out that the job
 * came in at £38 — because nothing anywhere joins the invoice to the hours.
 * This does, per client, which is the level at which the decision gets made:
 * you do not drop a project, you drop a client.
 *
 * Hours are every tracked hour against the client's projects whether billable
 * or not, deliberately. Unbillable hours spent on a client are still hours
 * spent on that client, and excluding them would flatter exactly the accounts
 * that most need looking at.
 */
export function clientProfitability(db: Database): ClientProfitability[] {
  return db
    .all<Row & { id: number; name: string; colour: string; invoiced: number | null }>(
      `SELECT c.id, c.name, c.colour,
              (SELECT SUM(gross) FROM invoices i
                WHERE i.client_id = c.id AND i.status != 'cancelled') AS invoiced
         FROM clients c
        WHERE c.archived = 0
        ORDER BY invoiced DESC NULLS LAST`
    )
    .map((row) => {
      const seconds =
        db.get<Row & { total: number | null }>(
          `SELECT SUM(t.duration) AS total
             FROM time_entries t
             JOIN projects p ON p.id = t.project_id
            WHERE p.client_id = ? AND t.ended_at IS NOT NULL`,
          [row.id]
        )?.total ?? 0

      const hours = secondsToHours(seconds)
      const invoiced = row.invoiced ?? 0

      return {
        clientId: row.id,
        clientName: row.name,
        colour: row.colour,
        invoiced,
        hours,
        /**
         * Null rather than zero when there are no hours. An effective rate of
         * £0 an hour is a different claim from "we have not tracked this", and
         * the first one would sit at the bottom of the table looking like the
         * worst client on the books.
         */
        effectiveRate: hours > 0 ? Math.round(invoiced / hours) : null
      }
    })
    .filter((entry) => entry.invoiced > 0 || entry.hours > 0)
}

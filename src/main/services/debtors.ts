import type { Database } from '../db'
import type { AgedDebtor, AgedDebtors, ClientDebt, Pence } from '@shared/types'
import { bucketFor, daysBetween, emptyBuckets, heatFor } from '@shared/debtors'
import { today } from '@shared/taxYear'
import { chaseSchedule } from './chasers'
import { listInvoices } from './invoices'
import { getSettings } from './settings'

/**
 * Who owes what, and for how long.
 *
 * Built from the same `listInvoices` the Invoices page reads, rather than from
 * a query of its own — two places computing "unpaid" two ways is the bug that
 * only surfaces when somebody notices the totals disagree by one invoice.
 *
 * Every sent, unpaid invoice is here, including ones not yet due. A report
 * that showed only the late ones could not be reconciled against the
 * "awaiting payment" figure on the same page, and an unexplained difference
 * between two numbers on one screen costs more trust than it saves space.
 */
export function agedDebtors(db: Database, asOf: string = today()): AgedDebtors {
  const settings = getSettings(db)
  const attempts = chaseSchedule(settings).length

  const unpaid = listInvoices(db, { status: 'sent' }).filter((invoice) => invoice.paidAt === null)

  const rows: AgedDebtor[] = unpaid
    .map((invoice) => {
      const daysOverdue = daysBetween(invoice.dueDate, asOf)
      const chased = invoice.chaseStep ?? 0

      return {
        invoice,
        daysOverdue,
        bucket: bucketFor(daysOverdue),
        heat: heatFor(daysOverdue),
        lastChasedAt: invoice.lastChasedAt,
        /**
         * The attempt a chase pressed *now* would be.
         *
         * One past however far this invoice has been chased, capped at the
         * length of the schedule — the last note is the last note, and
         * pressing again should repeat it rather than fall off the end into
         * an undefined register.
         */
        nextAttempt: Math.min(chased + 1, Math.max(1, attempts)),
        attempts: Math.max(1, attempts)
      }
    })
    // Oldest debt first: the top of this list is the work.
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  const buckets = emptyBuckets()
  for (const row of rows) buckets[row.bucket] += row.invoice.gross

  return {
    asOf,
    rows,
    buckets,
    total: rows.reduce((sum, row) => sum + row.invoice.gross, 0),
    overdue: rows.reduce(
      (sum, row) => (row.bucket === 'current' ? sum : sum + row.invoice.gross),
      0
    ),
    byClient: byClient(rows)
  }
}

/**
 * The same debt, per client.
 *
 * Because the decision is almost never about an invoice. One client three
 * invoices deep at sixty days is a conversation to have; three clients one
 * invoice each is a Tuesday.
 */
function byClient(rows: AgedDebtor[]): ClientDebt[] {
  const found = new Map<string, ClientDebt>()

  for (const row of rows) {
    // Invoices with no client on them are real and must not vanish from a
    // total. They group under one heading rather than being dropped.
    const key = String(row.invoice.clientId ?? 'none')

    const existing = found.get(key)
    const debt: ClientDebt = existing ?? {
      clientId: row.invoice.clientId,
      clientName: row.invoice.clientName ?? 'No client',
      buckets: emptyBuckets(),
      total: 0,
      invoices: 0,
      oldestDays: 0
    }

    debt.buckets[row.bucket] += row.invoice.gross
    debt.total += row.invoice.gross
    debt.invoices += 1
    debt.oldestDays = Math.max(debt.oldestDays, row.daysOverdue)

    found.set(key, debt)
  }

  return [...found.values()].sort((a, b) => b.total - a.total)
}

/** What is owed past its due date, for the dashboard's one-line version. */
export function overdueTotal(db: Database, asOf: string = today()): Pence {
  return agedDebtors(db, asOf).overdue
}

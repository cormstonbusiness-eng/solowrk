import type { Database } from '../db'
import type { AgeingBucket, StatementEntry, StatementForPdf } from '@shared/types'
import { today } from '@shared/taxYear'
import { getClient } from './clients'
import { listInvoices } from './invoices'

/**
 * Statements of account.
 *
 * The document you send a client who owes you for four invoices and has
 * stopped replying to notes about any of them individually. One page, one
 * total, one question — which is harder to leave in an inbox than four
 * separate reminders.
 *
 * Drafts and cancelled invoices are left out entirely. A draft is a document
 * the client has never seen, and putting one on a statement asks them to pay
 * for something they were never sent.
 */

/**
 * How the outstanding money is split by age.
 *
 * The reason a statement works. "You owe £4,200" invites a shrug; "£3,100 of
 * this has been outstanding for over two months" is a different conversation,
 * and it is the same conversation their own accounts department will already
 * be having internally.
 */
export function ageOutstanding(entries: StatementEntry[], asOf: string): AgeingBucket[] {
  const buckets: AgeingBucket[] = [
    // Unbounded below rather than starting at -1, so an invoice issued with
    // ninety-day terms still lands somewhere. With a finite floor it matched
    // no bucket at all and was dropped silently — leaving the ageing columns
    // adding up to less than the outstanding total on the same page.
    { label: 'Not yet due', from: Number.NEGATIVE_INFINITY, amount: 0 },
    { label: '1–30 days', from: 1, amount: 0 },
    { label: '31–60 days', from: 31, amount: 0 },
    { label: 'Over 60 days', from: 61, amount: 0 }
  ]

  for (const entry of entries) {
    if (entry.paidAt !== null) continue

    const late = daysBetween(entry.dueDate, asOf)
    // Walked backwards so the oldest matching bucket wins, which means adding a
    // bucket needs no edit here.
    const bucket = [...buckets].reverse().find((candidate) => late >= candidate.from)
    if (bucket) bucket.amount += entry.gross
  }

  return buckets
}

function daysBetween(from: string, to: string): number {
  // Both are yyyy-mm-dd, parsed as UTC midnight. Building a local Date from a
  // date-only string and subtracting can come out a day wrong across a DST
  // boundary, which would age an invoice into the wrong column.
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  )
}

/**
 * Everything this client owes, and what they have already paid.
 *
 * `from` narrows the history rather than the debt: an invoice still
 * outstanding is always listed however old it is, because a statement that
 * quietly dropped the oldest unpaid invoice would understate the total and be
 * worse than useless. The period only decides how much settled history to show
 * alongside it.
 */
export function buildStatement(
  db: Database,
  clientId: number,
  options: { from?: string; asOf?: string } = {}
): StatementForPdf {
  const asOf = options.asOf ?? today()
  const client = getClient(db, clientId)

  const entries: StatementEntry[] = listInvoices(db, { clientId })
    .filter((invoice) => invoice.status === 'sent' || invoice.status === 'paid')
    .filter((invoice) => invoice.paidAt === null || !options.from || invoice.issueDate >= options.from)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))
    .map((invoice) => ({
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      gross: invoice.gross,
      paidAt: invoice.paidAt,
      daysLate: invoice.paidAt === null ? Math.max(0, daysBetween(invoice.dueDate, asOf)) : 0
    }))

  const invoiced = entries.reduce((sum, entry) => sum + entry.gross, 0)
  const paid = entries
    .filter((entry) => entry.paidAt !== null)
    .reduce((sum, entry) => sum + entry.gross, 0)

  return {
    kind: 'statement',
    /**
     * Dated rather than numbered. A statement is a snapshot of a moving
     * position, not something anybody needs to reference by number later, and
     * a sequence would imply a permanence it does not have.
     *
     * The client's name is in it because this doubles as the file name, and
     * two clients sent a statement on the same morning would otherwise be one
     * file, with the second quietly overwriting the first.
     */
    number: `Statement ${asOf} ${client.name}`,
    issueDate: asOf,
    periodFrom: options.from ?? null,
    clientName: client.name,
    clientAddress: client.address ?? '',
    notes: '',
    entries,
    invoiced,
    paid,
    outstanding: invoiced - paid,
    ageing: ageOutstanding(entries, asOf)
  }
}

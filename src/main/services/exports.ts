import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database } from '../db'
import type {
  Client,
  Dataset,
  ExpenseWithContext,
  InvoiceWithContext,
  QuoteWithContext,
  TimeEntryWithContext
} from '@shared/types'
import { type Column, hours, pounds, toCsv, yesNo } from '@shared/csv'
import { listClients } from './clients'
import { listExpenses } from './expenses'
import { listInvoices } from './invoices'
import { listQuotes } from './quotes'
import { listEntries } from './time'
import { resolveInWorkspace } from './workspace'

/**
 * Getting the work back out, as plain CSV.
 *
 * Free, in both tiers, and it stays that way. "Your work is yours" is the
 * whole argument for a local-first app, and an export behind a paywall makes
 * that a slogan — `/terms` also promises exports keep working on a lapsed
 * licence, and `allowedWhenReadOnly` classifies these as reads so they do.
 *
 * One row per record with the joins already resolved, because a client id is
 * useless in a spreadsheet and a client name is not. Nothing here is a report:
 * the year-end pack is where totals and summaries live, and mixing the two
 * would make the raw export something you had to interpret.
 */

const EXPORTS_ROOT = 'Exports'

const CLIENTS: Column<Client>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Contact', value: (row) => row.contactName },
  { header: 'Email', value: (row) => row.email },
  { header: 'Phone', value: (row) => row.phone },
  { header: 'Address', value: (row) => row.address },
  { header: 'VAT number', value: (row) => row.vatNumber },
  { header: 'Default rate', value: (row) => pounds(row.defaultRate) },
  { header: 'Payment terms (days)', value: (row) => row.paymentTermsDays },
  { header: 'Status', value: (row) => row.status },
  { header: 'Archived', value: (row) => yesNo(row.archived) },
  { header: 'Notes', value: (row) => row.notes }
]

const INVOICES: Column<InvoiceWithContext>[] = [
  { header: 'Number', value: (row) => row.number },
  { header: 'Client', value: (row) => row.clientName },
  { header: 'Project', value: (row) => row.projectName },
  { header: 'Status', value: (row) => row.displayStatus },
  { header: 'Issued', value: (row) => row.issueDate },
  { header: 'Due', value: (row) => row.dueDate },
  { header: 'Paid', value: (row) => row.paidAt },
  { header: 'Net', value: (row) => pounds(row.net) },
  { header: 'VAT', value: (row) => pounds(row.vat) },
  { header: 'Total', value: (row) => pounds(row.gross) },
  { header: 'Notes', value: (row) => row.notes }
]

const QUOTES: Column<QuoteWithContext>[] = [
  { header: 'Number', value: (row) => row.number },
  { header: 'Client', value: (row) => row.clientName },
  { header: 'Status', value: (row) => row.status },
  { header: 'Issued', value: (row) => row.issueDate },
  { header: 'Valid until', value: (row) => row.validUntil },
  { header: 'Net', value: (row) => pounds(row.net) },
  { header: 'VAT', value: (row) => pounds(row.vat) },
  { header: 'Total', value: (row) => pounds(row.gross) }
]

const EXPENSES: Column<ExpenseWithContext>[] = [
  { header: 'Date', value: (row) => row.date },
  { header: 'Vendor', value: (row) => row.vendor },
  { header: 'Description', value: (row) => row.description },
  { header: 'Category', value: (row) => row.category },
  { header: 'Project', value: (row) => row.projectName },
  { header: 'Net', value: (row) => pounds(row.net) },
  { header: 'VAT', value: (row) => pounds(row.vat) },
  { header: 'Total', value: (row) => pounds(row.total) },
  { header: 'Rebillable', value: (row) => yesNo(row.rebillable) },
  // The path rather than the image: a CSV cannot carry a photograph, and the
  // receipt is already filed in the workspace next to this file.
  { header: 'Receipt file', value: (row) => row.receiptFile }
]

const TIME: Column<TimeEntryWithContext>[] = [
  { header: 'Started', value: (row) => row.startedAt },
  { header: 'Ended', value: (row) => row.endedAt },
  { header: 'Hours', value: (row) => hours(row.duration) },
  { header: 'Client', value: (row) => row.clientName },
  { header: 'Project', value: (row) => row.projectName },
  { header: 'Task', value: (row) => row.taskTitle },
  { header: 'Rate', value: (row) => pounds(row.rate) },
  { header: 'Value', value: (row) => pounds(Math.round((row.duration / 3600) * row.rate)) },
  { header: 'Billable', value: (row) => yesNo(row.billable) },
  { header: 'Invoiced', value: (row) => yesNo(row.invoiceLineId !== null) },
  { header: 'Notes', value: (row) => row.notes }
]

export interface Range {
  from?: string
  to?: string
}

/**
 * One dataset as CSV text.
 *
 * Ranges filter by the date that matters for each kind of record — an invoice
 * by when it was issued, an expense by when it was incurred, time by when it
 * was worked. Clients are never filtered: a client is not an event, and a
 * contact list missing everyone quiet this year would be a strange thing to
 * hand anybody.
 */
export function datasetToCsv(db: Database, dataset: Dataset, range: Range = {}): string {
  switch (dataset) {
    case 'clients':
      return toCsv(CLIENTS, listClients(db, true))

    case 'invoices':
      return toCsv(INVOICES, listInvoices(db, range))

    case 'quotes':
      return toCsv(
        QUOTES,
        listQuotes(db, {}).filter((quote) => inRange(quote.issueDate, range))
      )

    case 'expenses':
      return toCsv(EXPENSES, listExpenses(db, range))

    case 'time':
      return toCsv(
        TIME,
        listEntries(db, range).filter((entry) => entry.endedAt !== null)
      )
  }
}

function inRange(date: string, range: Range): boolean {
  if (range.from && date < range.from) return false
  if (range.to && date > range.to) return false
  return true
}

/**
 * Write one dataset into the workspace and return its relative path.
 *
 * Into the workspace rather than a save dialog, because that is where every
 * other file this app makes already lives — and it means an export is one
 * click rather than one click and a folder chooser.
 */
export async function writeDatasetCsv(
  db: Database,
  workspacePath: string,
  dataset: Dataset,
  range: Range = {},
  folder = EXPORTS_ROOT
): Promise<string> {
  await mkdir(resolveInWorkspace(workspacePath, folder), { recursive: true })

  const stamp = range.from && range.to ? ` ${range.from} to ${range.to}` : ''
  const relative = join(folder, `${titleFor(dataset)}${stamp}.csv`)

  await writeFile(resolveInWorkspace(workspacePath, relative), datasetToCsv(db, dataset, range), {
    encoding: 'utf8'
  })

  return relative
}

function titleFor(dataset: Dataset): string {
  return dataset.charAt(0).toUpperCase() + dataset.slice(1)
}

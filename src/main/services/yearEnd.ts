import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from '../db'
import type { SummaryLine, YearEndPack, YearSummaryForPdf } from '@shared/types'
import { currentTaxYear, taxYearStarting, today } from '@shared/taxYear'
import { writeDatasetCsv } from './exports'
import { summary } from './finance'
import { listInvoices } from './invoices'
import { getClient } from './clients'
import { writePdf } from './pdf'
import { getSettings } from './settings'
import { resolveInWorkspace } from './workspace'

/**
 * The year-end pack.
 *
 * One folder holding everything an accountant asks for in January: a summary
 * on one page, the underlying records as CSV, and every invoice raised in the
 * year as a PDF. It exists because the alternative is a fortnight of emails
 * asking for one more thing.
 *
 * Pro, and the line is convenience rather than access — the same CSVs are free
 * one at a time from Settings, and every invoice can always be exported on its
 * own. What Pro buys is not spending an evening assembling them.
 *
 * Scoped by `@shared/taxYear`, which puts the boundary at 6 April. Getting
 * that wrong moves income between two people's tax returns, so nothing here
 * computes a date range of its own.
 */

/** A folder name that reads as a year rather than as a pair of dates. */
function folderNameFor(label: string): string {
  // "2026/27" would be a directory separator. The dash is not decoration.
  return `Tax year ${label.replace('/', '-')}`
}

export async function buildYearEndPack(
  db: Database,
  workspacePath: string,
  startYear?: number
): Promise<YearEndPack> {
  const taxYear = startYear === undefined ? currentTaxYear() : taxYearStarting(startYear)
  const range = { from: taxYear.start, to: taxYear.end, label: `Tax year ${taxYear.label}` }

  const folder = join('Exports', folderNameFor(taxYear.label))
  await mkdir(resolveInWorkspace(workspacePath, folder), { recursive: true })

  const settings = getSettings(db)
  const files: string[] = []

  // The summary first, so the folder opens on the thing worth reading rather
  // than on Clients.csv.
  files.push(await writePdf(workspacePath, buildSummary(db, taxYear.label, range), settings, folder))

  for (const dataset of ['invoices', 'expenses', 'mileage', 'time', 'clients'] as const) {
    // Clients deliberately unfiltered — a contact list is not an event log,
    // and `datasetToCsv` already knows that.
    files.push(await writeDatasetCsv(db, workspacePath, dataset, range, folder))
  }

  /**
   * Every invoice raised in the year, re-rendered rather than copied.
   *
   * Copying whatever `pdf_path` points at would silently miss every invoice
   * never exported by hand, which is most of them — and would hand over a
   * stale PDF for any invoice edited since. Drafts and cancelled invoices are
   * left out: they were never sent to anybody.
   */
  const invoices = listInvoices(db, range).filter(
    (invoice) => invoice.status === 'sent' || invoice.status === 'paid'
  )

  const pdfFolder = join(folder, 'Invoices')
  if (invoices.length > 0) await mkdir(resolveInWorkspace(workspacePath, pdfFolder), { recursive: true })

  for (const invoice of invoices) {
    const client = invoice.clientId ? getClient(db, invoice.clientId) : null

    files.push(
      await writePdf(
        workspacePath,
        {
          kind: 'invoice',
          number: invoice.number,
          issueDate: invoice.issueDate,
          secondaryDate: invoice.dueDate,
          clientName: invoice.clientName,
          clientAddress: client?.address ?? '',
          lines: invoice.lines,
          net: invoice.net,
          vat: invoice.vat,
          vatRate: invoice.vatRate,
          gross: invoice.gross,
          notes: invoice.notes
        },
        settings,
        pdfFolder
      )
    )
  }

  return { folder, taxYearLabel: taxYear.label, files, invoicePdfs: invoices.length }
}

/**
 * The single page.
 *
 * Every figure comes from `finance.summary`, so the pack and the Finance page
 * can never disagree — two places computing income two ways is the bug you
 * only find when somebody queries the return.
 */
export function buildSummary(
  db: Database,
  taxYearLabel: string,
  range: { from: string; to: string; label: string }
): YearSummaryForPdf {
  const settings = getSettings(db)
  const totals = summary(db, range)

  const invoicesRaised = listInvoices(db, range).filter(
    (invoice) => invoice.status === 'sent' || invoice.status === 'paid'
  ).length

  return {
    kind: 'summary',
    number: `Year end ${taxYearLabel.replace('/', '-')}`,
    issueDate: today(),
    notes: '',
    taxYearLabel,
    periodFrom: range.from,
    periodTo: range.to,
    income: totals.income,
    expenses: totals.expenses,
    mileage: totals.mileage,
    profit: totals.profit,
    vatCollected: totals.vatCollected,
    vatRegistered: settings.vatRegistered,
    setAside: totals.setAside,
    setAsidePercent: settings.taxSetAsidePercent,
    // Paid within the year, matching how income is counted directly above it.
    invoicesPaid: db.get<Row & { n: number }>(
      `SELECT COUNT(*) AS n FROM invoices
        WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?`,
      [range.from, range.to]
    )!.n,
    invoicesRaised,
    hoursTracked: totals.hoursTracked,
    byClient: topLines(
      db,
      `SELECT COALESCE(c.name, 'No client') AS label, SUM(i.gross) AS amount
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.status = 'paid' AND i.paid_at >= ? AND i.paid_at <= ?
        GROUP BY label ORDER BY amount DESC`,
      [range.from, range.to]
    ),
    byCategory: topLines(
      db,
      `SELECT COALESCE(NULLIF(category, ''), 'Uncategorised') AS label, SUM(total) AS amount
         FROM expenses WHERE date >= ? AND date <= ?
        GROUP BY label ORDER BY amount DESC`,
      [range.from, range.to]
    )
  }
}

/**
 * The breakdown, with a long tail folded into one row.
 *
 * Twelve rows of client names is a table somebody reads; forty is a table
 * somebody skips, and the ones past the tenth are rarely the point.
 */
const TOP = 10

function topLines(db: Database, sql: string, params: string[]): SummaryLine[] {
  const rows = db.all<Row & { label: string; amount: number }>(sql, params)
  if (rows.length <= TOP) return rows.map((row) => ({ label: row.label, amount: row.amount }))

  const head = rows.slice(0, TOP).map((row) => ({ label: row.label, amount: row.amount }))
  const rest = rows.slice(TOP)

  return [
    ...head,
    {
      label: `${rest.length} others`,
      amount: rest.reduce((sum, row) => sum + row.amount, 0)
    }
  ]
}

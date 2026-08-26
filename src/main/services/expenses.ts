import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Database, Row } from '../db'
import type { Expense, ExpenseInput, ExpenseWithContext, Pence } from '@shared/types'
import { uniqueFileName } from './naming'
import { resolveInWorkspace } from './workspace'

const EXPENSES_ROOT = 'Expenses'

interface ExpenseRow extends Row {
  id: number
  date: string
  vendor: string
  description: string
  category: string
  net: number
  vat: number
  total: number
  receipt_file: string | null
  project_id: number | null
  rebillable: number
  invoice_line_id: number | null
  created_at: string
  updated_at: string
}

function toExpense(row: ExpenseRow & { project_name?: string | null }): ExpenseWithContext {
  return {
    id: row.id,
    date: row.date,
    vendor: row.vendor,
    description: row.description,
    category: row.category,
    net: row.net,
    vat: row.vat,
    total: row.total,
    receiptFile: row.receipt_file,
    projectId: row.project_id,
    rebillable: row.rebillable === 1,
    invoiceLineId: row.invoice_line_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectName: row.project_name ?? null
  }
}

export function listExpenses(
  db: Database,
  filter: { from?: string; to?: string; projectId?: number; unbilledOnly?: boolean } = {}
): ExpenseWithContext[] {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter.from) {
    conditions.push('e.date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    conditions.push('e.date <= ?')
    params.push(filter.to)
  }
  if (filter.projectId !== undefined) {
    conditions.push('e.project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.unbilledOnly) {
    conditions.push('e.rebillable = 1 AND e.invoice_line_id IS NULL')
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db
    .all<ExpenseRow & { project_name: string | null }>(
      `SELECT e.*, p.name AS project_name FROM expenses e
         LEFT JOIN projects p ON p.id = e.project_id
         ${where} ORDER BY e.date DESC, e.id DESC`,
      params
    )
    .map(toExpense)
}

/**
 * Receipts are filed by year and month so the folder stays navigable after a
 * few hundred of them, and so a tax-year export is a matter of copying folders.
 */
async function fileReceipt(workspacePath: string, date: string, source: string): Promise<string> {
  const [year, month] = date.split('-')
  const folderRelative = join(EXPENSES_ROOT, year!, month!)
  const folder = resolveInWorkspace(workspacePath, folderRelative)

  await mkdir(folder, { recursive: true })
  const name = uniqueFileName(basename(source), await readdir(folder))
  await copyFile(source, join(folder, name))

  return join(folderRelative, name)
}

export async function createExpense(
  db: Database,
  workspacePath: string,
  input: ExpenseInput
): Promise<ExpenseWithContext> {
  const date = input.date ?? new Date().toISOString().slice(0, 10)
  const net = input.net ?? 0
  const vat = input.vat ?? 0

  const receiptFile = input.receiptSourcePath
    ? await fileReceipt(workspacePath, date, input.receiptSourcePath)
    : null

  db.run(
    `INSERT INTO expenses (date, vendor, description, category, net, vat, total, receipt_file,
                           project_id, rebillable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      date,
      input.vendor ?? '',
      input.description ?? '',
      input.category ?? 'General',
      net,
      vat,
      // Total is derived, never taken from the caller, so it cannot disagree
      // with its parts.
      net + vat,
      receiptFile,
      input.projectId ?? null,
      input.rebillable ? 1 : 0
    ]
  )

  const id = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id
  return getExpense(db, id)
}

export function getExpense(db: Database, id: number): ExpenseWithContext {
  const row = db.get<ExpenseRow & { project_name: string | null }>(
    `SELECT e.*, p.name AS project_name FROM expenses e
       LEFT JOIN projects p ON p.id = e.project_id WHERE e.id = ?`,
    [id]
  )
  if (!row) throw new Error(`No expense with id ${id}`)
  return toExpense(row)
}

export async function updateExpense(
  db: Database,
  workspacePath: string,
  id: number,
  patch: ExpenseInput
): Promise<ExpenseWithContext> {
  const current = getExpense(db, id)

  const columns: Record<string, string> = {
    date: 'date',
    vendor: 'vendor',
    description: 'description',
    category: 'category',
    net: 'net',
    vat: 'vat',
    projectId: 'project_id'
  }

  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (patch.rebillable !== undefined) {
    assignments.push('rebillable = ?')
    values.push(patch.rebillable ? 1 : 0)
  }

  if (patch.receiptSourcePath) {
    assignments.push('receipt_file = ?')
    values.push(await fileReceipt(workspacePath, patch.date ?? current.date, patch.receiptSourcePath))
  }

  // Keep the derived total in step with whichever of net/vat changed.
  const net = patch.net ?? current.net
  const vat = patch.vat ?? current.vat
  assignments.push('total = ?')
  values.push(net + vat)

  db.run(
    `UPDATE expenses SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...values, id]
  )

  return getExpense(db, id)
}

export function expensesTotal(db: Database, from: string, to: string): Pence {
  const row = db.get<Row & { total: number | null }>(
    'SELECT SUM(total) AS total FROM expenses WHERE date >= ? AND date <= ?',
    [from, to]
  )
  return row?.total ?? 0
}

export type { Expense }

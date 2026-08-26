import type { Database, Row } from '../db'
import type {
  DocumentLine,
  Invoice,
  InvoiceDisplayStatus,
  InvoiceInput,
  InvoiceStatus,
  InvoiceWithContext,
  LineDraft,
  Recurrence
} from '@shared/types'
import { lineAmount, totalsFor } from '@shared/money'
import { addDays, addMonths, today } from '@shared/taxYear'
import { getSettings } from './settings'

interface InvoiceRow extends Row {
  id: number
  number: string
  client_id: number | null
  project_id: number | null
  status: string
  issue_date: string
  due_date: string
  paid_at: string | null
  net: number
  vat_rate: number
  vat: number
  gross: number
  notes: string
  pdf_path: string | null
  recurrence: string
  next_issue_on: string | null
  parent_invoice_id: number | null
  chase_step: number
  last_chased_at: string | null
  created_at: string
  updated_at: string
}

interface LineRow extends Row {
  id: number
  description: string
  quantity: number
  unit_price: number
  amount: number
  kind: string
  sort_order: number
}

/**
 * Overdue is derived, never stored. An invoice that is sent and past its due
 * date is overdue today and paid tomorrow — storing that state would need a
 * nightly job to keep it honest, and would be wrong the moment one was missed.
 */
export function displayStatus(row: {
  status: string
  due_date: string
  paid_at: string | null
}): InvoiceDisplayStatus {
  if (row.status === 'sent' && row.paid_at === null && row.due_date < today()) return 'overdue'
  return row.status as InvoiceStatus
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    number: row.number,
    clientId: row.client_id,
    projectId: row.project_id,
    status: row.status as InvoiceStatus,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    paidAt: row.paid_at,
    net: row.net,
    vatRate: row.vat_rate,
    vat: row.vat,
    gross: row.gross,
    notes: row.notes,
    pdfPath: row.pdf_path,
    recurrence: row.recurrence as Recurrence,
    nextIssueOn: row.next_issue_on,
    chaseStep: row.chase_step,
    lastChasedAt: row.last_chased_at,
    parentInvoiceId: row.parent_invoice_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toLine(row: LineRow): DocumentLine {
  return {
    id: row.id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    amount: row.amount,
    kind: row.kind as DocumentLine['kind'],
    sortOrder: row.sort_order
  }
}

export function listLines(db: Database, invoiceId: number): DocumentLine[] {
  return db
    .all<LineRow>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id', [
      invoiceId
    ])
    .map(toLine)
}

export function getInvoice(db: Database, id: number): InvoiceWithContext {
  const row = db.get<InvoiceRow & { client_name: string | null; project_name: string | null }>(
    `SELECT i.*, c.name AS client_name, p.name AS project_name
       FROM invoices i
       LEFT JOIN clients  c ON c.id = i.client_id
       LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.id = ?`,
    [id]
  )
  if (!row) throw new Error(`No invoice with id ${id}`)

  return {
    ...toInvoice(row),
    clientName: row.client_name,
    projectName: row.project_name,
    lines: listLines(db, id),
    displayStatus: displayStatus(row)
  }
}

export function listInvoices(
  db: Database,
  filter: { clientId?: number; status?: InvoiceStatus; from?: string; to?: string } = {}
): InvoiceWithContext[] {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter.clientId !== undefined) {
    conditions.push('i.client_id = ?')
    params.push(filter.clientId)
  }
  if (filter.status) {
    conditions.push('i.status = ?')
    params.push(filter.status)
  }
  if (filter.from) {
    conditions.push('i.issue_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    conditions.push('i.issue_date <= ?')
    params.push(filter.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db
    .all<InvoiceRow & { client_name: string | null; project_name: string | null }>(
      `SELECT i.*, c.name AS client_name, p.name AS project_name
         FROM invoices i
         LEFT JOIN clients  c ON c.id = i.client_id
         LEFT JOIN projects p ON p.id = i.project_id
         ${where}
         ORDER BY i.issue_date DESC, i.id DESC`,
      params
    )
    .map((row) => ({
      ...toInvoice(row),
      clientName: row.client_name,
      projectName: row.project_name,
      lines: listLines(db, row.id),
      displayStatus: displayStatus(row)
    }))
}

/**
 * Claim the next invoice number and advance the counter in one transaction, so
 * two invoices created in quick succession cannot take the same number — the
 * UNIQUE constraint would reject the second, losing the user's work.
 */
export function claimInvoiceNumber(db: Database): string {
  return db.transaction(() => {
    const settings = getSettings(db)
    const number = `${settings.invoicePrefix}${String(settings.nextInvoiceNumber).padStart(4, '0')}`
    db.run('UPDATE settings SET next_invoice_number = next_invoice_number + 1 WHERE id = 1')
    return number
  })
}

/**
 * Write the line set for an invoice and recompute its totals.
 *
 * Replaces all lines rather than diffing: a line's identity means nothing to
 * the user, and re-linking billed time is handled explicitly below.
 */
function writeLines(db: Database, invoiceId: number, lines: LineDraft[]): void {
  // Release anything previously billed by this invoice, so removing a line
  // returns that time and those expenses to the unbilled pool.
  const existing = db
    .all<Row & { id: number }>('SELECT id FROM invoice_lines WHERE invoice_id = ?', [invoiceId])
    .map((row) => row.id)

  for (const lineId of existing) {
    db.run('UPDATE time_entries SET invoice_line_id = NULL WHERE invoice_line_id = ?', [lineId])
    db.run('UPDATE expenses SET invoice_line_id = NULL WHERE invoice_line_id = ?', [lineId])
  }

  db.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId])

  lines.forEach((line, index) => {
    const amount = lineAmount(line.quantity, line.unitPrice)
    db.run(
      `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, amount, kind, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, line.description, line.quantity, line.unitPrice, amount, line.kind ?? 'fixed', index]
    )

    const lineId = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id

    for (const timeEntryId of line.timeEntryIds ?? []) {
      db.run('UPDATE time_entries SET invoice_line_id = ? WHERE id = ?', [lineId, timeEntryId])
    }
    for (const expenseId of line.expenseIds ?? []) {
      db.run('UPDATE expenses SET invoice_line_id = ? WHERE id = ?', [lineId, expenseId])
    }
  })

  recalculate(db, invoiceId)
}

/** Recompute stored totals from the lines and the current VAT settings. */
export function recalculate(db: Database, invoiceId: number): void {
  const settings = getSettings(db)
  const amounts = db
    .all<Row & { amount: number }>('SELECT amount FROM invoice_lines WHERE invoice_id = ?', [
      invoiceId
    ])
    .map((row) => row.amount)

  const totals = totalsFor(amounts, {
    vatRegistered: settings.vatRegistered,
    vatRate: settings.vatRate
  })

  db.run(
    `UPDATE invoices SET net = ?, vat_rate = ?, vat = ?, gross = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [totals.net, settings.vatRegistered ? settings.vatRate : 0, totals.vat, totals.gross, invoiceId]
  )
}

export function createInvoice(db: Database, input: InvoiceInput): InvoiceWithContext {
  const settings = getSettings(db)
  const issueDate = input.issueDate ?? today()

  // Payment terms cascade the same way rates do: client first, then default.
  const clientTerms = input.clientId
    ? (db.get<Row & { payment_terms_days: number | null }>(
        'SELECT payment_terms_days FROM clients WHERE id = ?',
        [input.clientId]
      )?.payment_terms_days ?? null)
    : null

  const dueDate = input.dueDate ?? addDays(issueDate, clientTerms ?? settings.paymentTermsDays)

  return db.transaction(() => {
    db.run(
      `INSERT INTO invoices (number, client_id, project_id, status, issue_date, due_date,
                             notes, recurrence, next_issue_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        claimInvoiceNumber(db),
        input.clientId,
        input.projectId ?? null,
        input.status ?? 'draft',
        issueDate,
        dueDate,
        input.notes ?? '',
        input.recurrence ?? 'none',
        input.recurrence && input.recurrence !== 'none'
          ? nextIssueDate(issueDate, input.recurrence)
          : null
      ]
    )

    const id = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id
    writeLines(db, id, input.lines)
    return getInvoice(db, id)
  })
}

export function updateInvoice(
  db: Database,
  id: number,
  patch: Partial<InvoiceInput> & { status?: InvoiceStatus }
): InvoiceWithContext {
  return db.transaction(() => {
    const assignments: string[] = []
    const values: (string | number | null)[] = []

    const columns: Record<string, string> = {
      clientId: 'client_id',
      projectId: 'project_id',
      issueDate: 'issue_date',
      dueDate: 'due_date',
      notes: 'notes',
      status: 'status',
      recurrence: 'recurrence'
    }

    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key]
      if (!column || value === undefined) continue
      assignments.push(`${column} = ?`)
      values.push(value as string | number | null)
    }

    // Marking paid records when, so the finance page can report income by the
    // date money arrived rather than the date the invoice was raised.
    if (patch.status) {
      assignments.push('paid_at = ?')
      values.push(patch.status === 'paid' ? today() : null)
    }

    if (assignments.length > 0) {
      db.run(
        `UPDATE invoices SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        [...values, id]
      )
    }

    if (patch.lines) writeLines(db, id, patch.lines)
    else recalculate(db, id)

    return getInvoice(db, id)
  })
}

export function nextIssueDate(from: string, recurrence: Recurrence): string | null {
  switch (recurrence) {
    case 'weekly':
      return addDays(from, 7)
    case 'monthly':
      return addMonths(from, 1)
    case 'quarterly':
      return addMonths(from, 3)
    case 'yearly':
      return addMonths(from, 12)
    default:
      return null
  }
}

/**
 * Issue any retainers that have come due, as drafts.
 *
 * Drafts rather than sent invoices, deliberately: an invoice going to a client
 * without the freelancer seeing it first is not a risk worth automating away.
 * Catches up if the app has not been opened for several cycles.
 */
export function runRecurringInvoices(db: Database, asOf = today()): InvoiceWithContext[] {
  const due = db.all<InvoiceRow>(
    `SELECT * FROM invoices
      WHERE recurrence != 'none' AND next_issue_on IS NOT NULL AND next_issue_on <= ?`,
    [asOf]
  )

  const created: InvoiceWithContext[] = []

  for (const template of due) {
    let issueOn = template.next_issue_on

    while (issueOn !== null && issueOn <= asOf) {
      const lines = listLines(db, template.id).map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        kind: line.kind
      }))

      const invoice = createInvoice(db, {
        clientId: template.client_id,
        projectId: template.project_id,
        issueDate: issueOn,
        notes: template.notes,
        status: 'draft',
        lines
      })

      db.run('UPDATE invoices SET parent_invoice_id = ? WHERE id = ?', [template.id, invoice.id])
      // Re-read: `invoice` was captured before the parent link was written.
      created.push(getInvoice(db, invoice.id))

      issueOn = nextIssueDate(issueOn, template.recurrence as Recurrence)
    }

    db.run('UPDATE invoices SET next_issue_on = ? WHERE id = ?', [issueOn, template.id])
  }

  return created
}

/** Sent invoices past their due date, oldest first. */
export function overdueInvoices(db: Database, asOf = today()): InvoiceWithContext[] {
  return listInvoices(db, { status: 'sent' }).filter(
    (invoice) => invoice.paidAt === null && invoice.dueDate < asOf
  )
}

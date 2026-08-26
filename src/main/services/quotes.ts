import type { Database, Row } from '../db'
import type {
  DocumentLine,
  LineDraft,
  Quote,
  QuoteInput,
  QuoteStatus,
  QuoteWithContext
} from '@shared/types'
import { lineAmount, totalsFor } from '@shared/money'
import { addDays, today } from '@shared/taxYear'
import { getSettings } from './settings'
import { createInvoice } from './invoices'
import { createProject } from './projects'

interface QuoteRow extends Row {
  id: number
  number: string
  client_id: number | null
  project_id: number | null
  status: string
  issue_date: string
  valid_until: string | null
  net: number
  vat_rate: number
  vat: number
  gross: number
  notes: string
  accepted_at: string | null
  converted_project_id: number | null
  converted_invoice_id: number | null
  pdf_path: string | null
  created_at: string
  updated_at: string
}

interface LineRow extends Row {
  id: number
  description: string
  quantity: number
  unit_price: number
  amount: number
  sort_order: number
}

function toQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    number: row.number,
    clientId: row.client_id,
    projectId: row.project_id,
    status: row.status as QuoteStatus,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    net: row.net,
    vatRate: row.vat_rate,
    vat: row.vat,
    gross: row.gross,
    notes: row.notes,
    acceptedAt: row.accepted_at,
    convertedProjectId: row.converted_project_id,
    convertedInvoiceId: row.converted_invoice_id,
    pdfPath: row.pdf_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listQuoteLines(db: Database, quoteId: number): DocumentLine[] {
  return db
    .all<LineRow>('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order, id', [quoteId])
    .map((row) => ({
      id: row.id,
      description: row.description,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      amount: row.amount,
      kind: 'fixed' as const,
      sortOrder: row.sort_order
    }))
}

export function getQuote(db: Database, id: number): QuoteWithContext {
  const row = db.get<QuoteRow & { client_name: string | null }>(
    `SELECT q.*, c.name AS client_name FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id WHERE q.id = ?`,
    [id]
  )
  if (!row) throw new Error(`No quote with id ${id}`)
  return { ...toQuote(row), clientName: row.client_name, lines: listQuoteLines(db, id) }
}

export function listQuotes(db: Database, filter: { status?: QuoteStatus } = {}): QuoteWithContext[] {
  const where = filter.status ? 'WHERE q.status = ?' : ''
  const params = filter.status ? [filter.status] : []

  return db
    .all<QuoteRow & { client_name: string | null }>(
      `SELECT q.*, c.name AS client_name FROM quotes q
         LEFT JOIN clients c ON c.id = q.client_id
         ${where} ORDER BY q.issue_date DESC, q.id DESC`,
      params
    )
    .map((row) => ({
      ...toQuote(row),
      clientName: row.client_name,
      lines: listQuoteLines(db, row.id)
    }))
}

function claimQuoteNumber(db: Database): string {
  return db.transaction(() => {
    const settings = getSettings(db)
    const number = `${settings.quotePrefix}${String(settings.nextQuoteNumber).padStart(4, '0')}`
    db.run('UPDATE settings SET next_quote_number = next_quote_number + 1 WHERE id = 1')
    return number
  })
}

function writeLines(db: Database, quoteId: number, lines: LineDraft[]): void {
  db.run('DELETE FROM quote_lines WHERE quote_id = ?', [quoteId])

  lines.forEach((line, index) => {
    db.run(
      `INSERT INTO quote_lines (quote_id, description, quantity, unit_price, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [quoteId, line.description, line.quantity, line.unitPrice, lineAmount(line.quantity, line.unitPrice), index]
    )
  })

  const settings = getSettings(db)
  const amounts = db
    .all<Row & { amount: number }>('SELECT amount FROM quote_lines WHERE quote_id = ?', [quoteId])
    .map((row) => row.amount)

  const totals = totalsFor(amounts, {
    vatRegistered: settings.vatRegistered,
    vatRate: settings.vatRate
  })

  db.run(
    `UPDATE quotes SET net = ?, vat_rate = ?, vat = ?, gross = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [totals.net, settings.vatRegistered ? settings.vatRate : 0, totals.vat, totals.gross, quoteId]
  )
}

export function createQuote(db: Database, input: QuoteInput): QuoteWithContext {
  const issueDate = input.issueDate ?? today()

  return db.transaction(() => {
    db.run(
      `INSERT INTO quotes (number, client_id, project_id, status, issue_date, valid_until,
                           notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        claimQuoteNumber(db),
        input.clientId,
        input.projectId ?? null,
        input.status ?? 'draft',
        issueDate,
        // 30 days is the common default for a quote to stand.
        input.validUntil ?? addDays(issueDate, 30),
        input.notes ?? ''
      ]
    )

    const id = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id
    writeLines(db, id, input.lines)
    return getQuote(db, id)
  })
}

export function updateQuote(
  db: Database,
  id: number,
  patch: Partial<QuoteInput>
): QuoteWithContext {
  return db.transaction(() => {
    const columns: Record<string, string> = {
      clientId: 'client_id',
      projectId: 'project_id',
      issueDate: 'issue_date',
      validUntil: 'valid_until',
      notes: 'notes',
      status: 'status'
    }

    const assignments: string[] = []
    const values: (string | number | null)[] = []

    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key]
      if (!column || value === undefined) continue
      assignments.push(`${column} = ?`)
      values.push(value as string | number | null)
    }

    if (patch.status === 'accepted') {
      assignments.push('accepted_at = ?')
      values.push(today())
    }

    if (assignments.length > 0) {
      db.run(
        `UPDATE quotes SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        [...values, id]
      )
    }

    if (patch.lines) writeLines(db, id, patch.lines)
    return getQuote(db, id)
  })
}

/**
 * Turn an accepted quote into work: a project to do it in, and optionally a
 * deposit invoice.
 *
 * The deposit is a percentage of the quote, raised as a draft — the freelancer
 * decides when it goes out.
 */
export async function convertQuote(
  db: Database,
  workspacePath: string,
  id: number,
  options: { createProject: boolean; projectName?: string; depositPercent?: number }
): Promise<{ quote: QuoteWithContext; projectId: number | null; invoiceId: number | null }> {
  const quote = getQuote(db, id)

  let projectId: number | null = quote.projectId
  if (options.createProject && projectId === null) {
    const project = await createProject(db, workspacePath, {
      name: options.projectName?.trim() || `${quote.clientName ?? 'Project'} ${quote.number}`,
      clientId: quote.clientId,
      status: 'active',
      budget: quote.net
    })
    projectId = project.id
  }

  let invoiceId: number | null = null
  const percent = options.depositPercent ?? 0
  if (percent > 0) {
    const invoice = createInvoice(db, {
      clientId: quote.clientId,
      projectId,
      status: 'draft',
      notes: `Deposit for ${quote.number}`,
      lines: [
        {
          description: `${percent}% deposit — ${quote.number}`,
          quantity: 1,
          // Percentage of the quote's net; VAT is applied to it as normal.
          unitPrice: Math.round((quote.net * percent) / 100),
          kind: 'fixed'
        }
      ]
    })
    invoiceId = invoice.id
  }

  db.run(
    `UPDATE quotes SET status = 'accepted', accepted_at = ?, converted_project_id = ?,
                       converted_invoice_id = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [quote.acceptedAt ?? today(), projectId, invoiceId, id]
  )

  return { quote: getQuote(db, id), projectId, invoiceId }
}

import { readFile } from 'node:fs/promises'
import type { Database, Row } from '../db'
import type {
  BankImportResult,
  BankTransaction,
  BankTransactionWithMatches,
  ExpenseInput
} from '@shared/types'
import { BankCsvError, parseBankCsv } from '@shared/bankCsv'
import { isClearWinner, matchesFor, type MatchCandidate } from '@shared/bankMatch'
import { listExpenses, createExpense } from './expenses'
import { listInvoices, updateInvoice } from './invoices'

/**
 * The bank import.
 *
 * A CSV the user downloaded from their own bank. No open-banking connection,
 * no credentials, nothing that phones anybody — which is the only shape this
 * feature can take in an app that promises the work stays on the machine.
 *
 * Statement lines are **kept**, not consumed. An import that read a file,
 * created some rows and forgot the file has no answer to "did that £1,500 ever
 * get reconciled?", and no way to take next month's statement — which overlaps
 * this one by a fortnight — without doing everything twice.
 *
 * Nothing is reconciled automatically. A wrong match marks an invoice paid
 * that was not, which stops the chasing on money still owed *and* puts income
 * in the accounts that never arrived; neither is visible afterwards. So the
 * app suggests, with its reasons, and a person presses the button.
 */

interface TransactionRow extends Row {
  id: number
  fingerprint: string
  date: string
  description: string
  reference: string
  amount: number
  source: string
  status: 'new' | 'matched' | 'ignored'
  invoice_id: number | null
  expense_id: number | null
  imported_at: string
  updated_at: string
}

function toTransaction(row: TransactionRow): BankTransaction {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    reference: row.reference,
    amount: row.amount,
    source: row.source,
    status: row.status,
    invoiceId: row.invoice_id,
    expenseId: row.expense_id
  }
}

/* ------------------------------------------------------------------ *
 * Importing
 * ------------------------------------------------------------------ */

/** Anything larger than this is not a bank statement. */
const MAX_BYTES = 20 * 1024 * 1024

export async function importStatement(
  db: Database,
  path: string
): Promise<BankImportResult> {
  let text: string
  try {
    const file = await readFile(path)
    if (file.byteLength > MAX_BYTES) {
      return { added: 0, alreadySeen: 0, skipped: [], columns: null, error: 'That file is too big to be a statement.' }
    }
    // Statements are sometimes saved with a byte-order mark, which would
    // otherwise become part of the first header and stop it being recognised.
    text = file.toString('utf8').replace(/^﻿/, '')
  } catch {
    return { added: 0, alreadySeen: 0, skipped: [], columns: null, error: 'That file could not be read.' }
  }

  let reading
  try {
    reading = parseBankCsv(text)
  } catch (error) {
    return {
      added: 0,
      alreadySeen: 0,
      skipped: [],
      columns: null,
      error: error instanceof BankCsvError ? error.message : 'That file could not be read.'
    }
  }

  const source = path.split(/[\\/]/).at(-1) ?? 'statement.csv'

  return db.transaction(() => {
    let added = 0

    for (const row of reading.rows) {
      // The UNIQUE fingerprint is the whole deduplication mechanism: two
      // overlapping statements insert the same line once. `changes` tells us
      // which happened without a second query.
      const before = db.get<Row & { n: number }>(
        'SELECT COUNT(*) AS n FROM bank_transactions WHERE fingerprint = ?',
        [row.fingerprint]
      )!.n

      if (before > 0) continue

      db.run(
        `INSERT INTO bank_transactions
           (fingerprint, date, description, reference, amount, source, imported_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [row.fingerprint, row.date, row.description, row.reference, row.amount, source]
      )
      added += 1
    }

    return {
      added,
      alreadySeen: reading.rows.length - added,
      skipped: reading.skipped,
      columns: reading.columns,
      error: null
    }
  })
}

/* ------------------------------------------------------------------ *
 * Reading, with suggestions attached
 * ------------------------------------------------------------------ */

/**
 * Every statement line, with what each unreconciled one might be.
 *
 * Matches are computed here rather than stored. An invoice paid, deleted or
 * re-dated between two visits changes what a line should be offered, and a
 * stored suggestion would keep pointing at the answer that was true last
 * Tuesday.
 */
export function listTransactions(
  db: Database,
  filter: { status?: 'new' | 'matched' | 'ignored' } = {}
): BankTransactionWithMatches[] {
  const rows = db.all<TransactionRow>(
    `SELECT * FROM bank_transactions
      ${filter.status ? 'WHERE status = ?' : ''}
      ORDER BY date DESC, id DESC`,
    filter.status ? [filter.status] : []
  )

  // Fetched once for the whole list rather than per row: a year's statement is
  // a few thousand lines, and a query each would be a few thousand queries.
  const owed: MatchCandidate[] = listInvoices(db, { status: 'sent' })
    .filter((invoice) => invoice.paidAt === null)
    .map((invoice) => ({
      id: invoice.id,
      amount: invoice.gross,
      reference: invoice.number,
      name: invoice.clientName,
      date: invoice.dueDate
    }))

  const spent: MatchCandidate[] = listExpenses(db)
    .filter((expense) => expense.total > 0)
    .map((expense) => ({
      id: expense.id,
      amount: expense.total,
      reference: '',
      name: expense.vendor,
      date: expense.date
    }))

  return rows.map((row) => {
    const transaction = toTransaction(row)
    if (row.status !== 'new') return { ...transaction, matches: [], clear: false }

    const line = {
      date: row.date,
      text: `${row.description} ${row.reference}`,
      amount: row.amount
    }

    // Money in is an invoice being paid; money out is a cost. Offering both
    // for every line would bury the one that matters under the one that does
    // not, and no statement line is ever both.
    const matches = matchesFor(line, row.amount > 0 ? owed : spent)

    return { ...transaction, matches, clear: isClearWinner(matches) }
  })
}

export function bankSummary(db: Database): { unreconciled: number; total: number } {
  const row = db.get<Row & { unreconciled: number; total: number }>(
    `SELECT SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS unreconciled,
            COUNT(*) AS total
       FROM bank_transactions`
  )
  return { unreconciled: row?.unreconciled ?? 0, total: row?.total ?? 0 }
}

/* ------------------------------------------------------------------ *
 * Reconciling
 * ------------------------------------------------------------------ */

function get(db: Database, id: number): TransactionRow {
  const row = db.get<TransactionRow>('SELECT * FROM bank_transactions WHERE id = ?', [id])
  if (!row) throw new Error(`No bank transaction with id ${id}`)
  return row
}

/**
 * This line was that invoice being paid.
 *
 * Marks the invoice paid, because that is the entire point of recognising it —
 * and does so on the date the money actually arrived rather than today, so a
 * statement imported in June does not report June's income as having landed in
 * a month it did not.
 */
export function matchToInvoice(db: Database, id: number, invoiceId: number): BankTransaction {
  return db.transaction(() => {
    const row = get(db, id)

    updateInvoice(db, invoiceId, { status: 'paid' })
    // `updateInvoice` stamps today; the statement knows better.
    db.run('UPDATE invoices SET paid_at = ? WHERE id = ?', [row.date, invoiceId])

    db.run(
      `UPDATE bank_transactions
          SET status = 'matched', invoice_id = ?, expense_id = NULL, updated_at = datetime('now')
        WHERE id = ?`,
      [invoiceId, id]
    )

    return toTransaction(get(db, id))
  })
}

/** This line was that expense, already recorded. */
export function matchToExpense(db: Database, id: number, expenseId: number): BankTransaction {
  db.run(
    `UPDATE bank_transactions
        SET status = 'matched', expense_id = ?, invoice_id = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    [expenseId, id]
  )
  return toTransaction(get(db, id))
}

/**
 * This line was a cost nobody had logged yet.
 *
 * The statement fills in what it knows and the caller supplies the rest — a
 * category and, if there is one, a project. VAT is left at zero rather than
 * guessed at twenty per cent: a statement cannot see whether there was any,
 * and inventing it would overstate a VAT reclaim.
 */
export async function transactionToExpense(
  db: Database,
  workspacePath: string,
  id: number,
  patch: ExpenseInput = {}
): Promise<BankTransaction> {
  const row = get(db, id)

  const expense = await createExpense(db, workspacePath, {
    date: row.date,
    vendor: row.description || row.reference,
    description: row.reference,
    category: 'General',
    // Statement debits are negative; an expense is not.
    net: Math.abs(row.amount),
    vat: 0,
    ...patch
  })

  return matchToExpense(db, id, expense.id)
}

/**
 * Not something the business needs to account for.
 *
 * A transfer between the user's own accounts, a personal card payment, a
 * refund that nets off. Kept rather than deleted, so re-importing the same
 * statement does not put it back on the pile.
 */
export function ignoreTransaction(db: Database, id: number): BankTransaction {
  db.run(
    `UPDATE bank_transactions
        SET status = 'ignored', invoice_id = NULL, expense_id = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    [id]
  )
  return toTransaction(get(db, id))
}

/**
 * Undo a reconciliation.
 *
 * Deliberately does **not** un-pay the invoice. Somebody clearing a wrong
 * match is saying "this line was not that"; whether the invoice was paid by
 * some other means is a separate fact, and silently reopening it could put a
 * chaser on the desk of a client who has paid.
 */
export function unmatchTransaction(db: Database, id: number): BankTransaction {
  db.run(
    `UPDATE bank_transactions
        SET status = 'new', invoice_id = NULL, expense_id = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    [id]
  )
  return toTransaction(get(db, id))
}

/** Forget a statement entirely — the escape hatch for importing the wrong file. */
export function forgetSource(db: Database, source: string): number {
  const before = db.get<Row & { n: number }>(
    // Only the untouched ones. A line already reconciled has had a decision
    // made about it, and throwing that away silently would be worse than
    // leaving a few rows behind.
    "SELECT COUNT(*) AS n FROM bank_transactions WHERE source = ? AND status = 'new'",
    [source]
  )!.n

  db.run("DELETE FROM bank_transactions WHERE source = ? AND status = 'new'", [source])
  return before
}

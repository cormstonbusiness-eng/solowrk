import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { createInvoice } from './invoices'
import { datasetToCsv } from './exports'
import { buildSummary } from './yearEnd'
import { taxYearStarting } from '@shared/taxYear'

/**
 * Getting the work back out.
 *
 * The export is the promise the whole product rests on — "your work is yours"
 * is only true if this file is complete and correct. A missing row is silent
 * and is found, if ever, by an accountant.
 */
function addClient(db: Database, name: string): number {
  db.run(
    `INSERT INTO clients (name, folder, relationship_stage, created_at, updated_at)
     VALUES (?, ?, 'active', datetime('now'), datetime('now'))`,
    [name, `Clients\\${name}`]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function rows(csv: string): string[] {
  // Splits on CRLF, drops the BOM and the trailing blank.
  return csv.replace(/^﻿/, '').split('\r\n').filter(Boolean)
}

describe('the CSV datasets', () => {
  let db: Database
  let client: number

  beforeEach(() => {
    db = new Database(':memory:')
    client = addClient(db, 'Acme Ltd')
  })

  afterEach(() => {
    db.close()
  })

  function invoice(issued: string, gross: number, status: 'draft' | 'sent' | 'paid' = 'sent'): void {
    createInvoice(db, {
      clientId: client,
      status,
      issueDate: issued,
      dueDate: issued,
      lines: [{ description: 'Work', quantity: 1, unitPrice: gross }]
    })
  }

  it('writes a header even with nothing to export', () => {
    // An empty file with no header looks like a broken export. A header with
    // no rows is an answer.
    expect(rows(datasetToCsv(db, 'invoices'))).toHaveLength(1)
    expect(datasetToCsv(db, 'invoices')).toContain('Number,Client')
  })

  it('resolves the joins, because an id is useless in a spreadsheet', () => {
    invoice('2026-05-01', 100_00)
    expect(datasetToCsv(db, 'invoices')).toContain('Acme Ltd')
  })

  it('includes drafts, because this is the raw record and not a report', () => {
    invoice('2026-05-01', 100_00, 'draft')
    expect(rows(datasetToCsv(db, 'invoices'))).toHaveLength(2)
  })

  it('filters by date when asked, inclusive at both ends', () => {
    invoice('2026-04-05', 10_00)
    invoice('2026-04-06', 20_00)
    invoice('2026-04-07', 30_00)

    const csv = datasetToCsv(db, 'invoices', { from: '2026-04-06', to: '2026-04-07' })
    expect(rows(csv)).toHaveLength(3)
    expect(csv).not.toContain('2026-04-05')
  })

  it('never filters the client list', () => {
    // A client is not an event. A contact list missing everyone who was quiet
    // this year would be a strange thing to hand anybody.
    const csv = datasetToCsv(db, 'clients', { from: '2099-01-01', to: '2099-12-31' })
    expect(csv).toContain('Acme Ltd')
  })

  it('includes archived clients', () => {
    db.run('UPDATE clients SET archived = 1 WHERE id = ?', [client])
    expect(datasetToCsv(db, 'clients')).toContain('Acme Ltd')
  })

  it('writes money as a number a spreadsheet can total', () => {
    invoice('2026-05-01', 1_234_56)
    // Not "£1,234.56", which is text that sums to zero.
    expect(datasetToCsv(db, 'invoices')).toContain('1234.56')
    expect(datasetToCsv(db, 'invoices')).not.toContain('£')
  })
})

/**
 * The year-end summary.
 *
 * The 6 April boundary is the thing that would be wrong quietly: a payment on
 * the 5th and one on the 6th belong to two different people's tax returns, and
 * nothing in the file itself would say which year it landed in.
 */
describe('the tax year boundary', () => {
  let db: Database
  let client: number

  beforeEach(() => {
    db = new Database(':memory:')
    client = addClient(db, 'Acme Ltd')
  })

  afterEach(() => {
    db.close()
  })

  /** An invoice paid on a given date, which is what income is counted by. */
  function paid(on: string, gross: number): void {
    const created = createInvoice(db, {
      clientId: client,
      status: 'paid',
      issueDate: on,
      dueDate: on,
      lines: [{ description: 'Work', quantity: 1, unitPrice: gross }]
    })
    db.run('UPDATE invoices SET paid_at = ? WHERE id = ?', [on, created.id])
  }

  const YEAR = taxYearStarting(2026)
  const range = { from: YEAR.start, to: YEAR.end, label: 'x' }

  it('runs 6 April to 5 April', () => {
    expect(YEAR.start).toBe('2026-04-06')
    expect(YEAR.end).toBe('2027-04-05')
  })

  it('counts the sixth of April and excludes the fifth', () => {
    paid('2026-04-05', 100_00) // previous year
    paid('2026-04-06', 200_00) // first day of this one
    paid('2027-04-05', 300_00) // last day of this one
    paid('2027-04-06', 400_00) // next year

    const summary = buildSummary(db, YEAR.label, range)
    expect(summary.income).toBe(500_00)
    expect(summary.invoicesPaid).toBe(2)
  })

  it('says the basis it used, because "income" means two things', () => {
    const summary = buildSummary(db, YEAR.label, range)
    expect(summary.periodFrom).toBe('2026-04-06')
    expect(summary.periodTo).toBe('2027-04-05')
  })

  it('counts what was raised separately from what was paid', () => {
    // An invoice raised in March and paid in May belongs to one year for cash
    // and another for accrual. The summary reports both counts rather than
    // implying they are the same number.
    createInvoice(db, {
      clientId: client,
      status: 'sent',
      issueDate: '2026-06-01',
      dueDate: '2026-07-01',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 900_00 }]
    })
    paid('2026-06-01', 100_00)

    const summary = buildSummary(db, YEAR.label, range)
    expect(summary.invoicesRaised).toBe(2)
    expect(summary.invoicesPaid).toBe(1)
    expect(summary.income).toBe(100_00)
  })

  it('breaks income down by client', () => {
    const other = addClient(db, 'Beta Ltd')
    paid('2026-06-01', 100_00)

    const created = createInvoice(db, {
      clientId: other,
      status: 'paid',
      issueDate: '2026-06-02',
      dueDate: '2026-06-02',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 300_00 }]
    })
    db.run('UPDATE invoices SET paid_at = ? WHERE id = ?', ['2026-06-02', created.id])

    const summary = buildSummary(db, YEAR.label, range)
    // Largest first, because the top of that list is the interesting part.
    expect(summary.byClient.map((line) => line.label)).toEqual(['Beta Ltd', 'Acme Ltd'])
    expect(summary.byClient[0]!.amount).toBe(300_00)
  })

  it('never sets aside tax on a loss', () => {
    db.run(
      `INSERT INTO expenses (date, vendor, description, category, net, vat, total, rebillable, created_at, updated_at)
       VALUES ('2026-06-01', 'X', 'Y', 'Software', 50000, 0, 50000, 0, datetime('now'), datetime('now'))`
    )
    paid('2026-06-01', 100_00)

    const summary = buildSummary(db, YEAR.label, range)
    expect(summary.profit).toBeLessThan(0)
    expect(summary.setAside).toBe(0)
  })
})

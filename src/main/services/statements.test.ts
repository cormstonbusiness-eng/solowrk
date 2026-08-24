import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { createInvoice } from './invoices'
import { ageOutstanding, buildStatement } from './statements'

/**
 * Inserted directly rather than through `createClient`, which is async and
 * makes folders on disk. A statement cares about rows, not directories.
 */
function addClient(db: Database, name: string): number {
  db.run(
    `INSERT INTO clients (name, folder, status, created_at, updated_at)
     VALUES (?, ?, 'active', datetime('now'), datetime('now'))`,
    [name, `Clients\\${name}`]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

/**
 * Statements of account.
 *
 * Every number on this document is one a client may use to decide whether to
 * pay, and a wrong one is an argument rather than a bug report. The two that
 * matter most are the outstanding total — which must never be understated —
 * and the ageing, which is the part that makes the conversation different.
 */
describe('a statement', () => {
  let db: Database
  let client: number

  const ASOF = '2026-06-01'

  /** An invoice issued on a date, optionally already paid. */
  function invoice(options: {
    issued: string
    due: string
    gross: number
    paidOn?: string
    status?: 'draft' | 'sent' | 'paid' | 'cancelled'
  }): number {
    const created = createInvoice(db, {
      clientId: client,
      status: options.status ?? (options.paidOn ? 'paid' : 'sent'),
      issueDate: options.issued,
      dueDate: options.due,
      lines: [{ description: 'Work', quantity: 1, unitPrice: options.gross }]
    })
    if (options.paidOn) {
      db.run('UPDATE invoices SET paid_at = ? WHERE id = ?', [options.paidOn, created.id])
    }
    return created.id
  }

  beforeEach(() => {
    db = new Database(':memory:')
    client = addClient(db, 'Acme Ltd')
  })

  afterEach(() => {
    db.close()
  })

  it('adds up what is still owed', () => {
    invoice({ issued: '2026-04-01', due: '2026-04-15', gross: 120_00 })
    invoice({ issued: '2026-05-01', due: '2026-05-15', gross: 80_00 })
    invoice({ issued: '2026-03-01', due: '2026-03-15', gross: 50_00, paidOn: '2026-03-20' })

    const statement = buildStatement(db, client, { asOf: ASOF })

    expect(statement.invoiced).toBe(250_00)
    expect(statement.paid).toBe(50_00)
    expect(statement.outstanding).toBe(200_00)
  })

  it('leaves drafts and cancelled invoices off entirely', () => {
    // A draft is a document the client has never seen. Putting one on a
    // statement asks them to pay for something they were never sent.
    invoice({ issued: '2026-04-01', due: '2026-04-15', gross: 120_00, status: 'draft' })
    invoice({ issued: '2026-04-01', due: '2026-04-15', gross: 90_00, status: 'cancelled' })
    invoice({ issued: '2026-04-01', due: '2026-04-15', gross: 10_00 })

    const statement = buildStatement(db, client, { asOf: ASOF })

    expect(statement.entries).toHaveLength(1)
    expect(statement.outstanding).toBe(10_00)
  })

  it('lists oldest first, which is the order the conversation goes in', () => {
    invoice({ issued: '2026-05-01', due: '2026-05-15', gross: 10_00 })
    invoice({ issued: '2026-01-01', due: '2026-01-15', gross: 20_00 })
    invoice({ issued: '2026-03-01', due: '2026-03-15', gross: 30_00 })

    const statement = buildStatement(db, client, { asOf: ASOF })

    expect(statement.entries.map((entry) => entry.issueDate)).toEqual([
      '2026-01-01',
      '2026-03-01',
      '2026-05-01'
    ])
  })

  it('keeps an old unpaid invoice even when the period would exclude it', () => {
    // The failure that would matter. Narrowing the history must never narrow
    // the debt: a statement that dropped the oldest unpaid invoice would
    // understate the total, and understating it in the client's favour is
    // worse than not sending one.
    invoice({ issued: '2024-02-01', due: '2024-02-15', gross: 500_00 })
    invoice({ issued: '2026-05-01', due: '2026-05-15', gross: 20_00 })
    invoice({ issued: '2024-01-01', due: '2024-01-15', gross: 99_00, paidOn: '2024-01-20' })

    const statement = buildStatement(db, client, { from: '2026-01-01', asOf: ASOF })

    expect(statement.outstanding).toBe(520_00)
    // The settled invoice from two years ago is the only thing the period drops.
    expect(statement.entries.map((entry) => entry.gross)).toEqual([500_00, 20_00])
  })

  it('counts days late from the due date, not the issue date', () => {
    invoice({ issued: '2026-04-01', due: '2026-05-02', gross: 10_00 })

    const [entry] = buildStatement(db, client, { asOf: ASOF }).entries
    expect(entry!.daysLate).toBe(30)
  })

  it('does not call a paid invoice late', () => {
    invoice({ issued: '2026-01-01', due: '2026-01-15', gross: 10_00, paidOn: '2026-04-01' })

    const [entry] = buildStatement(db, client, { asOf: ASOF }).entries
    expect(entry!.daysLate).toBe(0)
  })

  it('names the client in the reference, so two statements are two files', () => {
    const other = addClient(db, 'Beta Ltd')

    const one = buildStatement(db, client, { asOf: ASOF })
    const two = buildStatement(db, other, { asOf: ASOF })

    expect(one.number).not.toBe(two.number)
  })

  it('is a perfectly good document when nothing is owed', () => {
    invoice({ issued: '2026-01-01', due: '2026-01-15', gross: 10_00, paidOn: '2026-01-10' })

    const statement = buildStatement(db, client, { asOf: ASOF })
    expect(statement.outstanding).toBe(0)
    expect(statement.entries).toHaveLength(1)
  })
})

describe('ageing', () => {
  const entry = (dueDate: string, gross: number, paidAt: string | null = null): never =>
    ({ number: 'X', issueDate: dueDate, dueDate, gross, paidAt, daysLate: 0 }) as never

  const ASOF = '2026-06-01'

  it('puts an invoice not yet due in its own column', () => {
    // Not everything on a statement is late, and colouring it as though it
    // were would be the fastest way to have the whole document dismissed.
    const buckets = ageOutstanding([entry('2026-07-01', 100_00)], ASOF)
    expect(buckets.find((bucket) => bucket.label === 'Not yet due')?.amount).toBe(100_00)
  })

  it('counts the due date itself as not yet due', () => {
    // Payment is not late on the day it is due.
    const buckets = ageOutstanding([entry(ASOF, 100_00)], ASOF)
    expect(buckets.find((bucket) => bucket.label === 'Not yet due')?.amount).toBe(100_00)
  })

  it('sorts each invoice into exactly one column', () => {
    const buckets = ageOutstanding(
      [
        entry('2026-05-25', 10_00), // 7 days
        entry('2026-04-20', 20_00), // 42 days
        entry('2026-01-01', 40_00) // 151 days
      ],
      ASOF
    )

    expect(buckets.map((bucket) => bucket.amount)).toEqual([0, 10_00, 20_00, 40_00])
    expect(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(70_00)
  })

  it('ignores what has been paid', () => {
    const buckets = ageOutstanding([entry('2026-01-01', 500_00, '2026-02-01')], ASOF)
    expect(buckets.every((bucket) => bucket.amount === 0)).toBe(true)
  })

  it('always adds up to the outstanding total', () => {
    // The invariant the whole table rests on. Two numbers on one page that
    // disagree is not a rounding complaint — it is the client's reason to
    // ignore the document entirely, and it is the failure mode of any bucket
    // whose bounds leave a gap.
    const entries = [
      entry('2026-09-01', 11_00), // not yet due, long terms
      entry('2026-06-01', 12_00), // due today
      entry('2026-05-31', 13_00), // 1 day
      entry('2026-05-02', 14_00), // 30
      entry('2026-05-01', 15_00), // 31
      entry('2026-04-02', 16_00), // 60
      entry('2026-04-01', 17_00), // 61
      entry('2020-01-01', 18_00) // years
    ]

    const total = ageOutstanding(entries, ASOF).reduce((sum, bucket) => sum + bucket.amount, 0)
    expect(total).toBe(116_00)
  })

  it('lands exactly on the boundaries', () => {
    // 30 and 31 days are different columns, and an invoice that drifted one
    // column too old would be an accusation the numbers do not support.
    expect(ageOutstanding([entry('2026-05-02', 10_00)], ASOF)[1]!.amount).toBe(10_00) // 30
    expect(ageOutstanding([entry('2026-05-01', 10_00)], ASOF)[2]!.amount).toBe(10_00) // 31
    expect(ageOutstanding([entry('2026-04-02', 10_00)], ASOF)[2]!.amount).toBe(10_00) // 60
    expect(ageOutstanding([entry('2026-04-01', 10_00)], ASOF)[3]!.amount).toBe(10_00) // 61
  })
})

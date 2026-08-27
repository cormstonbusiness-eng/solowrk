import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createInvoice, getInvoice, updateInvoice } = await import('./invoices')
const {
  importStatement,
  listTransactions,
  matchToInvoice,
  ignoreTransaction,
  transactionToExpense,
  unmatchTransaction,
  forgetSource
} = await import('./bank')

/**
 * The bank import against a real database.
 *
 * The two things that matter here are both about not doing damage: importing
 * the same statement twice must not double anything, and reconciling must put
 * the payment on the date it arrived rather than on the day somebody happened
 * to sit down with the statement.
 */

const HEADER = 'Date,Description,Amount,Balance'

describe('importing', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-bank-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const statement = async (name: string, lines: string[]): Promise<string> => {
    const path = join(root, name)
    await writeFile(path, [HEADER, ...lines].join('\n'), 'utf8')
    return path
  }

  it('reads a statement in', async () => {
    const path = await statement('april.csv', [
      '01/04/2026,ACME LTD INV-0012,1500.00,2500.00',
      '02/04/2026,ADOBE,-19.97,2480.03'
    ])

    const result = await importStatement(db, path)
    expect(result).toMatchObject({ added: 2, alreadySeen: 0, error: null })
    expect(result.columns?.amount).toBe('Amount')
  })

  it('does not double anything when the same file goes in twice', async () => {
    const path = await statement('april.csv', ['01/04/2026,ACME LTD,1500.00,2500.00'])

    await importStatement(db, path)
    const second = await importStatement(db, path)

    expect(second).toMatchObject({ added: 0, alreadySeen: 1 })
    expect(listTransactions(db)).toHaveLength(1)
  })

  it('takes only the new half of an overlapping statement', async () => {
    // Which is what actually happens: people export the last ninety days
    // every month, and two thirds of it is already in.
    const april = await statement('april.csv', [
      '01/04/2026,ACME LTD,1500.00,2500.00',
      '15/04/2026,ADOBE,-19.97,2480.03'
    ])
    const both = await statement('april-may.csv', [
      '01/04/2026,ACME LTD,1500.00,2500.00',
      '15/04/2026,ADOBE,-19.97,2480.03',
      '02/05/2026,NORTHGATE,800.00,3280.03'
    ])

    await importStatement(db, april)
    const second = await importStatement(db, both)

    expect(second).toMatchObject({ added: 1, alreadySeen: 2 })
    expect(listTransactions(db)).toHaveLength(3)
  })

  it('says so rather than throwing when the file is not a statement', async () => {
    const path = join(root, 'clients.csv')
    await writeFile(path, 'name,email\nAda,ada@example.com', 'utf8')

    const result = await importStatement(db, path)
    expect(result.added).toBe(0)
    expect(result.error).toMatch(/bank statement/i)
  })

  it('says so when the file is not there at all', async () => {
    const result = await importStatement(db, join(root, 'nothing.csv'))
    expect(result.error).toMatch(/could not be read/i)
  })
})

describe('reconciling', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-bank-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const statement = async (lines: string[]): Promise<string> => {
    const path = join(root, 'statement.csv')
    await writeFile(path, [HEADER, ...lines].join('\n'), 'utf8')
    return path
  }

  const owed = (number: string, gross: number, dueDate = '2026-04-01'): number => {
    const invoice = createInvoice(db, {
      clientId: null,
      issueDate: '2026-03-01',
      dueDate,
      lines: [{ description: 'Work', quantity: 1, unitPrice: gross }]
    })
    db.run('UPDATE invoices SET number = ? WHERE id = ?', [number, invoice.id])
    updateInvoice(db, invoice.id, { status: 'sent' })
    return invoice.id
  }

  it('suggests the invoice whose number is in the reference', async () => {
    owed('INV-0012', 150_000)
    owed('INV-0013', 150_000)

    await importStatement(db, await statement(['01/04/2026,BACS INV-0013,1500.00,2500.00']))

    const [line] = listTransactions(db)
    expect(line!.matches[0]!.reasons).toContain('INV-0013 is in the reference')
    expect(line!.clear).toBe(true)
  })

  it('declines to be sure between two invoices that look alike', async () => {
    owed('INV-0012', 150_000)
    owed('INV-0013', 150_000)

    await importStatement(db, await statement(['01/04/2026,BACS TRANSFER,1500.00,2500.00']))

    expect(listTransactions(db)[0]!.clear).toBe(false)
  })

  it('marks the invoice paid on the day the money arrived', async () => {
    // Not today. A statement imported in June must not report April's income
    // as having landed in a month it did not.
    const id = owed('INV-0012', 150_000)
    await importStatement(db, await statement(['01/04/2026,BACS INV-0012,1500.00,2500.00']))

    const [line] = listTransactions(db)
    matchToInvoice(db, line!.id, id)

    const invoice = getInvoice(db, id)
    expect(invoice.status).toBe('paid')
    expect(invoice.paidAt).toBe('2026-04-01')
  })

  it('stops offering a line once it has been decided', async () => {
    const id = owed('INV-0012', 150_000)
    await importStatement(db, await statement(['01/04/2026,BACS INV-0012,1500.00,2500.00']))

    matchToInvoice(db, listTransactions(db)[0]!.id, id)

    const [line] = listTransactions(db)
    expect(line!.status).toBe('matched')
    expect(line!.matches).toHaveLength(0)
    expect(listTransactions(db, { status: 'new' })).toHaveLength(0)
  })

  it('does not un-pay an invoice when a match is cleared', async () => {
    // Somebody clearing a wrong match is saying "this line was not that".
    // Whether the invoice was paid some other way is a separate fact, and
    // reopening it could put a chaser on the desk of a client who has paid.
    const id = owed('INV-0012', 150_000)
    await importStatement(db, await statement(['01/04/2026,BACS INV-0012,1500.00,2500.00']))

    const lineId = listTransactions(db)[0]!.id
    matchToInvoice(db, lineId, id)
    unmatchTransaction(db, lineId)

    expect(getInvoice(db, id).status).toBe('paid')
    expect(listTransactions(db)[0]!.status).toBe('new')
  })

  it('turns a debit into an expense for what the statement says it was', async () => {
    await importStatement(db, await statement(['02/04/2026,ADOBE SUBSCRIPTION,-19.97,2480.03']))

    const lineId = listTransactions(db)[0]!.id
    await transactionToExpense(db, root, lineId, { category: 'Software' })

    const expense = db.get<{ vendor: string; net: number; vat: number; date: string }>(
      'SELECT vendor, net, vat, date FROM expenses'
    )!

    expect(expense).toMatchObject({ vendor: 'ADOBE SUBSCRIPTION', date: '2026-04-02' })
    // The debit was negative; an expense is not.
    expect(expense.net).toBe(1997)
    // VAT is not guessed. A statement cannot see whether there was any, and
    // inventing twenty per cent would overstate a reclaim.
    expect(expense.vat).toBe(0)
  })

  it('keeps an ignored line so re-importing does not raise it again', async () => {
    const path = await statement(['05/04/2026,TRANSFER TO SAVINGS,-500.00,2000.00'])
    await importStatement(db, path)

    ignoreTransaction(db, listTransactions(db)[0]!.id)
    await importStatement(db, path)

    expect(listTransactions(db)).toHaveLength(1)
    expect(listTransactions(db, { status: 'new' })).toHaveLength(0)
  })

  it('forgets a statement imported by mistake, but not decisions already made', async () => {
    const id = owed('INV-0012', 150_000)
    await importStatement(
      db,
      await statement([
        '01/04/2026,BACS INV-0012,1500.00,2500.00',
        '02/04/2026,ADOBE,-19.97,2480.03'
      ])
    )

    matchToInvoice(db, listTransactions(db, { status: 'new' })[1]!.id, id)
    const forgotten = forgetSource(db, 'statement.csv')

    expect(forgotten).toBe(1)
    // The reconciled one stays: a decision has been made about it.
    expect(listTransactions(db)).toHaveLength(1)
  })
})

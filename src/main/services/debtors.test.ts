import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { createInvoice, updateInvoice } = await import('./invoices')
const { markChased } = await import('./chasers')
const { agedDebtors } = await import('./debtors')
const { bucketFor, daysBetween } = await import('@shared/debtors')

/**
 * Aged debt.
 *
 * The report is only useful if the boundaries are exact — an invoice one day
 * either side of thirty days moves between two columns somebody makes a
 * decision from, and the day an invoice falls due is the day it is most likely
 * to be looked at.
 */

const ASOF = '2026-09-01'

describe('the buckets', () => {
  it('does not call an invoice late on the day it falls due', () => {
    expect(bucketFor(0)).toBe('current')
    expect(bucketFor(-5)).toBe('current')
  })

  it('is late the day after', () => {
    expect(bucketFor(1)).toBe('to30')
  })

  it('puts each boundary on the lower side', () => {
    expect(bucketFor(30)).toBe('to30')
    expect(bucketFor(31)).toBe('to60')
    expect(bucketFor(60)).toBe('to60')
    expect(bucketFor(61)).toBe('to90')
    expect(bucketFor(90)).toBe('to90')
    expect(bucketFor(91)).toBe('over90')
  })

  it('counts days without a clock in the way', () => {
    // Across the end of British Summer Time, which is where a local-time
    // subtraction comes out an hour short and rounds to the wrong day.
    expect(daysBetween('2026-10-20', '2026-11-03')).toBe(14)
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
  })
})

describe('the report', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  // Inserted directly rather than through `createClient`, which also makes a
  // folder on disk — this report never touches one.
  const client = (name: string): number => {
    db.run(
      "INSERT INTO clients (name, folder, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
      [name, `Clients/${name}`]
    )
    return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  }

  const owe = (dueDate: string, gross: number, clientId?: number): number => {
    const invoice = createInvoice(db, {
      clientId: clientId ?? null,
      issueDate: '2026-01-01',
      dueDate,
      lines: [{ description: 'Work', quantity: 1, unitPrice: gross }]
    })
    updateInvoice(db, invoice.id, { status: 'sent' })
    return invoice.id
  }

  it('is empty when nobody owes anything', () => {
    const report = agedDebtors(db, ASOF)
    expect(report.rows).toHaveLength(0)
    expect(report.total).toBe(0)
    expect(report.overdue).toBe(0)
  })

  it('ages each debt against its own due date', () => {
    owe('2026-08-25', 10_000) // 7 days
    owe('2026-07-15', 20_000) // 48 days
    owe('2026-04-01', 30_000) // 153 days

    const report = agedDebtors(db, ASOF)
    const buckets = report.rows.map((row) => row.bucket)

    // Oldest first, which is the order the work is in.
    expect(buckets).toEqual(['over90', 'to60', 'to30'])
  })

  it('counts what is not yet due but does not call it overdue', () => {
    owe('2026-09-30', 50_000)

    const report = agedDebtors(db, ASOF)
    expect(report.total).toBe(50_000)
    // The distinction the whole report turns on.
    expect(report.overdue).toBe(0)
    expect(report.buckets.current).toBe(50_000)
  })

  it('adds up to the same figure however it is sliced', () => {
    owe('2026-09-30', 10_000)
    owe('2026-08-25', 20_000)
    owe('2026-04-01', 30_000)

    const report = agedDebtors(db, ASOF)
    const acrossBuckets = Object.values(report.buckets).reduce((sum, one) => sum + one, 0)
    const acrossClients = report.byClient.reduce((sum, one) => sum + one.total, 0)

    expect(acrossBuckets).toBe(report.total)
    expect(acrossClients).toBe(report.total)
    expect(report.total).toBe(60_000)
  })

  it('leaves a paid invoice out', () => {
    const id = owe('2026-04-01', 30_000)
    // Marking it paid stamps `paid_at` itself.
    updateInvoice(db, id, { status: 'paid' })

    expect(agedDebtors(db, ASOF).rows).toHaveLength(0)
  })

  it('leaves a draft out', () => {
    // Never sent to anybody, so nobody owes it.
    createInvoice(db, {
      clientId: null,
      issueDate: '2026-01-01',
      dueDate: '2026-02-01',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 90_000 }]
    })

    expect(agedDebtors(db, ASOF).rows).toHaveLength(0)
  })

  it('gathers a client s invoices together', () => {
    const northgate = client('Northgate')
    owe('2026-08-25', 10_000, northgate)
    owe('2026-04-01', 30_000, northgate)

    const [debt] = agedDebtors(db, ASOF).byClient
    expect(debt).toMatchObject({
      clientName: 'Northgate',
      invoices: 2,
      total: 40_000
    })
    // The oldest of them, which is what decides how the conversation goes.
    expect(debt!.oldestDays).toBe(153)
  })

  it('keeps an invoice with no client rather than dropping it', () => {
    // Otherwise the per-client totals quietly stop adding up to the total.
    owe('2026-04-01', 30_000)

    const [debt] = agedDebtors(db, ASOF).byClient
    expect(debt).toMatchObject({ clientId: null, clientName: 'No client', total: 30_000 })
  })

  it('puts the biggest debtor at the top', () => {
    const small = client('Small')
    const large = client('Large')
    owe('2026-08-25', 10_000, small)
    owe('2026-08-25', 90_000, large)

    expect(agedDebtors(db, ASOF).byClient.map((one) => one.clientName)).toEqual(['Large', 'Small'])
  })

  it('offers the next note, not the one already sent', () => {
    const id = owe('2026-07-01', 10_000)
    expect(agedDebtors(db, ASOF).rows[0]!.nextAttempt).toBe(1)

    markChased(db, id, 1)
    expect(agedDebtors(db, ASOF).rows[0]!.nextAttempt).toBe(2)
  })

  it('stops at the last note rather than running off the end', () => {
    // The last word is the last word. Pressing again repeats it, which is a
    // register that exists, rather than asking for a fourth that does not.
    const id = owe('2026-07-01', 10_000)
    const attempts = agedDebtors(db, ASOF).rows[0]!.attempts

    markChased(db, id, attempts)
    expect(agedDebtors(db, ASOF).rows[0]!.nextAttempt).toBe(attempts)
  })

  it('remembers when it was last chased', () => {
    const id = owe('2026-07-01', 10_000)
    markChased(db, id, 1, '2026-08-20')

    expect(agedDebtors(db, ASOF).rows[0]!.lastChasedAt).toBe('2026-08-20')
  })
})

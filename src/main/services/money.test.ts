import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createClient } = await import('./clients')
const { createProject } = await import('./projects')
const { updateSettings } = await import('./settings')
const { createEntry, getRunning, startTimer, stopTimer, unbilledFor } = await import('./time')
const {
  claimInvoiceNumber,
  createInvoice,
  getInvoice,
  listInvoices,
  overdueInvoices,
  runRecurringInvoices,
  updateInvoice
} = await import('./invoices')
const { createQuote, convertQuote, getQuote } = await import('./quotes')
const { createExpense } = await import('./expenses')
const { summary } = await import('./finance')
const { today, addDays } = await import('@shared/taxYear')

describe('money services', () => {
  let root: string
  let db: InstanceType<typeof Database>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-money-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
    updateSettings(db, { businessName: 'Test Co', defaultHourlyRate: 6000, paymentTermsDays: 14 })
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  describe('timers', () => {
    it('reports no running timer initially', () => {
      expect(getRunning(db)).toBeNull()
    })

    it('starts and stops, recording a duration', () => {
      const running = startTimer(db, { projectId: null })
      expect(getRunning(db)).not.toBeNull()

      const stopped = stopTimer(db, running.entry.id)
      expect(stopped.endedAt).not.toBeNull()
      expect(getRunning(db)).toBeNull()
    })

    it('stops the previous timer when a second one starts', () => {
      // Double-counting the same minutes across two projects would quietly
      // inflate what a client is billed.
      const first = startTimer(db, { projectId: null })
      const second = startTimer(db, { projectId: null })

      expect(getRunning(db)?.entry.id).toBe(second.entry.id)
      const entries = db.all<{ id: number; ended_at: string | null }>(
        'SELECT id, ended_at FROM time_entries ORDER BY id'
      )
      expect(entries.find((e) => e.id === first.entry.id)?.ended_at).not.toBeNull()
    })

    it('snapshots the rate, using project over client over default', async () => {
      const client = await createClient(db, root, { name: 'Acme', defaultRate: 7000 })
      const withClientRate = await createProject(db, root, { name: 'A', clientId: client.id })
      const withOwnRate = await createProject(db, root, {
        name: 'B',
        clientId: client.id,
        rate: 9000
      })

      expect(startTimer(db, { projectId: withClientRate.id }).entry.rate).toBe(7000)
      expect(startTimer(db, { projectId: withOwnRate.id }).entry.rate).toBe(9000)
      expect(startTimer(db, { projectId: null }).entry.rate).toBe(6000)
    })

    it('values unbilled time from the snapshotted rate', async () => {
      const project = await createProject(db, root, { name: 'Rebrand', rate: 6000 })
      createEntry(db, {
        projectId: project.id,
        startedAt: `${today()}T09:00:00.000Z`,
        duration: 3600
      })
      createEntry(db, {
        projectId: project.id,
        startedAt: `${today()}T10:00:00.000Z`,
        duration: 1800
      })

      const unbilled = unbilledFor(db, project.id)
      expect(unbilled.seconds).toBe(5400)
      expect(unbilled.value).toBe(9000)
    })
  })

  describe('invoices', () => {
    it('numbers sequentially and never reuses a number', () => {
      expect(claimInvoiceNumber(db)).toBe('INV-0001')
      expect(claimInvoiceNumber(db)).toBe('INV-0002')
      expect(claimInvoiceNumber(db)).toBe('INV-0003')
    })

    it('computes totals from its lines', () => {
      updateSettings(db, { vatRegistered: true, vatRate: 2000 })
      const invoice = createInvoice(db, {
        clientId: null,
        lines: [
          { description: 'Design', quantity: 10, unitPrice: 6000 },
          { description: 'Expenses', quantity: 1, unitPrice: 4000 }
        ]
      })

      expect(invoice.net).toBe(64_000)
      expect(invoice.vat).toBe(12_800)
      expect(invoice.gross).toBe(76_800)
    })

    it('omits VAT when the business is not registered', () => {
      updateSettings(db, { vatRegistered: false })
      const invoice = createInvoice(db, {
        clientId: null,
        lines: [{ description: 'Design', quantity: 1, unitPrice: 50_000 }]
      })

      expect(invoice.vat).toBe(0)
      expect(invoice.gross).toBe(50_000)
    })

    it('uses the client payment terms for the due date', async () => {
      const client = await createClient(db, root, { name: 'Acme', paymentTermsDays: 30 })
      const invoice = createInvoice(db, {
        clientId: client.id,
        issueDate: '2026-06-01',
        lines: []
      })

      expect(invoice.dueDate).toBe('2026-07-01')
    })

    it('derives overdue rather than storing it', () => {
      const invoice = createInvoice(db, {
        clientId: null,
        issueDate: addDays(today(), -30),
        dueDate: addDays(today(), -5),
        status: 'sent',
        lines: [{ description: 'Work', quantity: 1, unitPrice: 10_000 }]
      })

      expect(getInvoice(db, invoice.id).displayStatus).toBe('overdue')
      expect(overdueInvoices(db)).toHaveLength(1)

      // Paying it clears the overdue state with no separate flag to reset.
      updateInvoice(db, invoice.id, { status: 'paid' })
      expect(getInvoice(db, invoice.id).displayStatus).toBe('paid')
      expect(overdueInvoices(db)).toHaveLength(0)
    })

    it('marks time as billed and releases it when the line is removed', async () => {
      const project = await createProject(db, root, { name: 'Rebrand', rate: 6000 })
      const entry = createEntry(db, {
        projectId: project.id,
        startedAt: `${today()}T09:00:00.000Z`,
        duration: 3600
      })

      const invoice = createInvoice(db, {
        clientId: null,
        projectId: project.id,
        lines: [
          {
            description: '1 hour',
            quantity: 1,
            unitPrice: 6000,
            kind: 'time',
            timeEntryIds: [entry.id]
          }
        ]
      })

      expect(unbilledFor(db, project.id).entries).toHaveLength(0)

      // Removing the line must return the time to the unbilled pool, or it
      // would be silently unbillable forever.
      updateInvoice(db, invoice.id, { lines: [] })
      expect(unbilledFor(db, project.id).entries).toHaveLength(1)
    })

    it('records the payment date when marked paid', () => {
      const invoice = createInvoice(db, { clientId: null, lines: [] })
      expect(updateInvoice(db, invoice.id, { status: 'paid' }).paidAt).toBe(today())
      expect(updateInvoice(db, invoice.id, { status: 'sent' }).paidAt).toBeNull()
    })
  })

  describe('recurring invoices', () => {
    it('issues a copy as a draft when one falls due', () => {
      const retainer = createInvoice(db, {
        clientId: null,
        issueDate: '2026-01-01',
        recurrence: 'monthly',
        lines: [{ description: 'Retainer', quantity: 1, unitPrice: 80_000 }]
      })

      const created = runRecurringInvoices(db, '2026-02-05')
      expect(created).toHaveLength(1)
      expect(created[0]?.status).toBe('draft')
      expect(created[0]?.gross).toBe(retainer.gross)
      expect(created[0]?.parentInvoiceId).toBe(retainer.id)
    })

    it('catches up on several missed cycles at once', () => {
      createInvoice(db, {
        clientId: null,
        issueDate: '2026-01-01',
        recurrence: 'monthly',
        lines: [{ description: 'Retainer', quantity: 1, unitPrice: 80_000 }]
      })

      // App not opened since January.
      expect(runRecurringInvoices(db, '2026-04-10')).toHaveLength(3)
    })

    it('does not re-issue one already generated', () => {
      createInvoice(db, {
        clientId: null,
        issueDate: '2026-01-01',
        recurrence: 'monthly',
        lines: []
      })

      runRecurringInvoices(db, '2026-02-05')
      expect(runRecurringInvoices(db, '2026-02-20')).toHaveLength(0)
    })

    it('leaves non-recurring invoices alone', () => {
      createInvoice(db, { clientId: null, issueDate: '2026-01-01', lines: [] })
      expect(runRecurringInvoices(db, '2027-01-01')).toHaveLength(0)
    })
  })

  describe('quotes', () => {
    it('converts an accepted quote into a project and a deposit invoice', async () => {
      const client = await createClient(db, root, { name: 'Acme' })
      const quote = createQuote(db, {
        clientId: client.id,
        lines: [{ description: 'Brand identity', quantity: 1, unitPrice: 400_000 }]
      })

      const result = await convertQuote(db, root, quote.id, {
        createProject: true,
        projectName: 'Brand identity',
        depositPercent: 25
      })

      expect(result.projectId).not.toBeNull()
      expect(result.invoiceId).not.toBeNull()
      expect(getQuote(db, quote.id).status).toBe('accepted')

      // 25% of £4000 is £1000.
      expect(getInvoice(db, result.invoiceId!).net).toBe(100_000)
    })

    it('can convert without a deposit', async () => {
      const quote = createQuote(db, {
        clientId: null,
        lines: [{ description: 'Work', quantity: 1, unitPrice: 100_000 }]
      })

      const result = await convertQuote(db, root, quote.id, { createProject: true })
      expect(result.invoiceId).toBeNull()
      expect(result.projectId).not.toBeNull()
    })
  })

  describe('finance summary', () => {
    it('counts income when paid, not when raised', async () => {
      const paid = createInvoice(db, {
        clientId: null,
        issueDate: today(),
        lines: [{ description: 'Done', quantity: 1, unitPrice: 100_000 }]
      })
      updateInvoice(db, paid.id, { status: 'paid' })

      createInvoice(db, {
        clientId: null,
        issueDate: today(),
        status: 'sent',
        lines: [{ description: 'Awaiting', quantity: 1, unitPrice: 50_000 }]
      })

      const result = summary(db, { from: addDays(today(), -30), to: today(), label: 'test' })
      expect(result.income).toBe(100_000)
      expect(result.outstanding).toBe(50_000)
    })

    it('subtracts expenses and sets aside tax from the profit', async () => {
      const invoice = createInvoice(db, {
        clientId: null,
        issueDate: today(),
        lines: [{ description: 'Work', quantity: 1, unitPrice: 100_000 }]
      })
      updateInvoice(db, invoice.id, { status: 'paid' })

      await createExpense(db, root, { date: today(), vendor: 'Adobe', net: 20_000, vat: 0 })

      const result = summary(db, { from: addDays(today(), -30), to: today(), label: 'test' })
      expect(result.expenses).toBe(20_000)
      expect(result.profit).toBe(80_000)
      // 30% is the default set-aside.
      expect(result.setAside).toBe(24_000)
    })

    it('never sets aside tax on a loss', async () => {
      await createExpense(db, root, { date: today(), vendor: 'Adobe', net: 20_000, vat: 0 })

      const result = summary(db, { from: addDays(today(), -30), to: today(), label: 'test' })
      expect(result.profit).toBe(-20_000)
      expect(result.setAside).toBe(0)
    })

    it('derives an expense total from net plus VAT rather than trusting it', async () => {
      const expense = await createExpense(db, root, {
        date: today(),
        vendor: 'Adobe',
        net: 10_000,
        vat: 2000
      })
      expect(expense.total).toBe(12_000)
    })
  })

  it('lists invoices newest first', () => {
    createInvoice(db, { clientId: null, issueDate: '2026-01-01', lines: [] })
    createInvoice(db, { clientId: null, issueDate: '2026-06-01', lines: [] })

    expect(listInvoices(db).map((i) => i.issueDate)).toEqual(['2026-06-01', '2026-01-01'])
  })
})

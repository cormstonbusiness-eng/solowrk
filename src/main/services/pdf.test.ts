import { describe, expect, it } from 'vitest'
import type { LineItemDocument, Settings, StatementForPdf } from '@shared/types'
import { renderHtml, safeFileName } from './pdf'

const SETTINGS = {
  businessName: 'Blockout Digital',
  addressLine1: '1 High Street',
  addressLine2: '',
  city: 'Leeds',
  postcode: 'LS1 1AA',
  country: 'United Kingdom',
  email: 'hello@example.com',
  phone: '01234 567890',
  vatRegistered: true,
  vatNumber: 'GB123456789',
  logoFile: ''
} as Settings

const LINES = [
  { id: 1, description: 'Design work', quantity: 2, unitPrice: 50_00, amount: 100_00 }
] as LineItemDocument['lines']

function lineDoc(kind: LineItemDocument['kind']): LineItemDocument {
  return {
    kind,
    number: 'INV-0042',
    issueDate: '2026-06-01',
    secondaryDate: '2026-06-15',
    clientName: 'Acme Ltd',
    clientAddress: '2 Low Road',
    lines: LINES,
    net: 100_00,
    vat: 20_00,
    vatRate: 2000,
    gross: 120_00,
    notes: 'Thanks for the work.'
  }
}

const STATEMENT: StatementForPdf = {
  kind: 'statement',
  number: 'Statement 2026-06-01 Acme Ltd',
  issueDate: '2026-06-01',
  periodFrom: null,
  clientName: 'Acme Ltd',
  clientAddress: '2 Low Road',
  notes: '',
  entries: [
    {
      number: 'INV-0041',
      issueDate: '2026-03-01',
      dueDate: '2026-03-15',
      gross: 60_00,
      paidAt: '2026-03-20',
      daysLate: 0
    },
    {
      number: 'INV-0042',
      issueDate: '2026-04-01',
      dueDate: '2026-04-15',
      gross: 120_00,
      paidAt: null,
      daysLate: 47
    }
  ],
  invoiced: 180_00,
  paid: 60_00,
  outstanding: 120_00,
  ageing: [
    { label: 'Not yet due', from: Number.NEGATIVE_INFINITY, amount: 0 },
    { label: '1–30 days', from: 1, amount: 0 },
    { label: '31–60 days', from: 31, amount: 120_00 },
    { label: 'Over 60 days', from: 61, amount: 0 }
  ]
}

/**
 * The template.
 *
 * These four documents are the only things SoloWrk produces that another
 * person reads, so a branch that renders an empty page or leaks raw markup is
 * seen by the customer's customer before it is seen by anybody who could fix
 * it.
 */
describe('rendering', () => {
  it('renders each kind under its own heading', () => {
    expect(renderHtml(lineDoc('invoice'), SETTINGS)).toContain('<h1>Invoice</h1>')
    expect(renderHtml(lineDoc('quote'), SETTINGS)).toContain('<h1>Quote</h1>')
    expect(renderHtml(lineDoc('receipt'), SETTINGS)).toContain('<h1>Receipt</h1>')
    expect(renderHtml(STATEMENT, SETTINGS)).toContain('<h1>Statement</h1>')
  })

  it('puts the work and the totals on an invoice', () => {
    const html = renderHtml(lineDoc('invoice'), SETTINGS)

    expect(html).toContain('Design work')
    expect(html).toContain('£120.00')
    expect(html).toContain('VAT at 20%')
    expect(html).toContain('Payment due by 15 June 2026')
  })

  it('says a receipt is settled and does not ask for money', () => {
    const html = renderHtml({ ...lineDoc('receipt'), secondaryDate: '2026-06-10' }, SETTINGS)

    expect(html).toContain('Paid in full')
    expect(html).toContain('Received with thanks on 10 June 2026')
    expect(html).not.toContain('Payment due by')

    // "Billed to" on a document confirming the bill is settled reads as a
    // second demand, and the notes on an invoice are the payment instructions
    // — repeating them here would tell somebody how to pay what they have paid.
    expect(html).toContain('Received from')
    expect(html).not.toContain('Billed to')
    expect(html).not.toContain('Thanks for the work.')

    // The invoice's own date under its own label, not the payment date twice.
    expect(html).toContain('Invoice dated')
    expect(html).not.toContain('>Issued<')
  })

  it('does not print the client name three times on a statement', () => {
    const html = renderHtml(STATEMENT, SETTINGS)
    expect(html).not.toContain(STATEMENT.number)
    expect(html).toContain('Acme Ltd')
  })

  it('puts the invoices, the position and the ageing on a statement', () => {
    const html = renderHtml(STATEMENT, SETTINGS)

    expect(html).toContain('INV-0041')
    expect(html).toContain('Paid 20 March 2026')
    expect(html).toContain('47 days overdue')
    expect(html).toContain('Outstanding')
    expect(html).toContain('How long it has been outstanding')
  })

  it('leaves the ageing table off a settled account', () => {
    // Four zeroes under an account with nothing owing reads as an accusation.
    const settled: StatementForPdf = {
      ...STATEMENT,
      entries: [{ ...STATEMENT.entries[0]! }],
      outstanding: 0,
      paid: 60_00,
      invoiced: 60_00
    }

    const html = renderHtml(settled, SETTINGS)
    expect(html).not.toContain('How long it has been outstanding')
    expect(html).toContain('Nothing is outstanding on this account')
  })

  it('shows the logo when there is one, and nothing when there is not', () => {
    const logo = 'data:image/png;base64,AAAA'

    expect(renderHtml(lineDoc('invoice'), SETTINGS, logo)).toContain(`src="${logo}"`)
    expect(renderHtml(lineDoc('invoice'), SETTINGS, null)).not.toContain('<img')
  })

  it('escapes what the user typed', () => {
    // A client named after a tag, or a line item pasted out of a web page.
    // The window has JavaScript disabled, so this is about the document not
    // silently losing half a description rather than about script execution.
    const html = renderHtml(
      {
        ...lineDoc('invoice'),
        clientName: 'Tom & Jerry <Ltd>',
        lines: [
          { id: 1, description: '"Bath & Body" <b>rush</b>', quantity: 1, unitPrice: 1, amount: 1 }
        ] as LineItemDocument['lines']
      },
      SETTINGS
    )

    expect(html).toContain('Tom &amp; Jerry &lt;Ltd&gt;')
    expect(html).toContain('&quot;Bath &amp; Body&quot; &lt;b&gt;rush&lt;/b&gt;')
    expect(html).not.toContain('<b>rush</b>')
  })

  it('does not shift a date across midnight', () => {
    // Dates are yyyy-mm-dd and formatted as UTC. Without that, an invoice
    // issued on the first renders as the last day of the previous month
    // anywhere west of Greenwich — on the one document that leaves the app.
    expect(renderHtml(lineDoc('invoice'), SETTINGS)).toContain('1 June 2026')
  })
})

/**
 * Turning a document reference into a file name.
 *
 * The invoice prefix is a free-text field in Settings and a statement carries
 * a client's name, so this receives whatever anybody typed. Every failure here
 * looks identical from the outside: an export button that appears to do
 * nothing.
 */
describe('safeFileName', () => {
  it('leaves an ordinary reference alone', () => {
    expect(safeFileName('INV-0042')).toBe('INV-0042')
    expect(safeFileName('Statement 2026-06-01 Acme Ltd')).toBe('Statement 2026-06-01 Acme Ltd')
  })

  it('defuses a separator in the invoice prefix', () => {
    // Someone types "INV/" in Settings, which reads perfectly on the invoice.
    // Unhandled, this either writes into a folder that does not exist or
    // escapes the year folder entirely.
    expect(safeFileName('INV/2026/0042')).toBe('INV-2026-0042')
    expect(safeFileName('INV\\0042')).toBe('INV-0042')
  })

  it('defuses an attempt to climb out of the folder', () => {
    expect(safeFileName('../../secrets')).not.toContain('/')
    expect(safeFileName('..\\..\\secrets')).not.toContain('\\')
  })

  it('handles the rest of what Windows refuses', () => {
    expect(safeFileName('Q1: "final" <draft>?')).toBe('Q1- -final- -draft--')
  })

  it('strips a trailing dot or space', () => {
    // Windows silently drops both, which would quietly turn two different
    // references into one file and lose the first.
    expect(safeFileName('INV-1.')).toBe('INV-1')
    expect(safeFileName('INV-1 ')).toBe('INV-1')
  })

  it('renames the device names Windows will not allow', () => {
    // A client called "CON" is far-fetched. A write that fails with an
    // unreadable OS error is not worth the gamble either way.
    for (const name of ['CON', 'con', 'PRN', 'nul', 'COM1', 'LPT9']) {
      expect(safeFileName(name)).not.toBe(name)
      expect(safeFileName(name).length).toBeGreaterThan(0)
    }
  })

  it('never returns an empty name', () => {
    for (const reference of ['', '   ', '///', '...']) {
      expect(safeFileName(reference).length).toBeGreaterThan(0)
    }
  })

  it('keeps two different references different', () => {
    // The property that matters more than any particular substitution: a
    // collision here overwrites a document that already exists.
    const references = ['INV/1', 'INV\\1', 'INV-1', 'INV:2', 'INV 3', 'INV-4']
    const names = references.map(safeFileName)
    // INV/1, INV\1 and INV-1 genuinely are the same file name once cleaned —
    // there is no way around that — but nothing else may collide.
    expect(new Set(names).size).toBe(4)
  })

  it('leaves room for the folder path', () => {
    expect(safeFileName('X'.repeat(400)).length).toBeLessThanOrEqual(120)
  })
})

import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { GATES, gateFor } from './gating'

/**
 * The paid-feature gate.
 *
 * Two failures matter and neither is visible from the outside: a channel
 * escaping the gate gives a paid feature away, and a channel wrongly caught by
 * it locks a customer out of something they bought. Both are silent, so they
 * are pinned here.
 */

describe('marketing is Pro', () => {
  it('gates every marketing channel there is', () => {
    const marketing = IPC_CHANNELS.filter((channel) => channel.startsWith('marketing:'))

    // Sixteen at the time of writing. If this ever reads zero the prefix has
    // been renamed and the whole section has quietly gone free.
    expect(marketing.length).toBeGreaterThan(10)

    for (const channel of marketing) {
      expect(gateFor(channel)?.feature).toBe('marketing')
    }
  })

  it('gates a marketing channel that does not exist yet', () => {
    // The point of matching by prefix. Somebody adding marketing:schedulePost
    // next month should not have to know this file exists.
    expect(gateFor('marketing:somethingAddedLater')?.feature).toBe('marketing')
  })
})

describe('the assistant', () => {
  it('gates sending', () => {
    expect(gateFor('ai:send')?.feature).toBe('assistant')
  })

  it('leaves the rest of ai: alone', () => {
    // The business plan and the status the upsell panel reads are Basic. If
    // these were gated, a Basic user could not be told why the assistant is
    // unavailable — the panel that explains it would itself be refused.
    for (const channel of IPC_CHANNELS.filter(
      (name) => name.startsWith('ai:') && name !== 'ai:send'
    )) {
      expect(gateFor(channel)).toBeNull()
    }
  })
})

describe('the chase schedule is Pro, chasing is not', () => {
  it('gates the automatic schedule', () => {
    const chasing = IPC_CHANNELS.filter((channel) => channel.startsWith('chasing:'))

    expect(chasing.length).toBeGreaterThan(0)
    for (const channel of chasing) {
      expect(gateFor(channel)?.feature).toBe('chasing')
    }
  })

  it('leaves the button that chases one invoice by hand alone', () => {
    // The line the tier is drawn on. Pro sells not having to remember which
    // invoices have gone quiet; it does not sell the ability to ask for your
    // own money, and a Basic customer who notices an overdue invoice must be
    // able to write to their client about it.
    expect(gateFor('invoices:chaser')).toBeNull()
  })

  it('gates the statement of account', () => {
    // Pro, and the one gate that sits next to an export. The distinction is
    // that an invoice PDF gets the customer's own record out of the app, which
    // must always work, while a statement is a document derived from those
    // records — the same reasoning that lets the year-end pack be Pro.
    expect(gateFor('chasing:statement')?.feature).toBe('chasing')
  })

  it('does not gate the documents a client asks for', () => {
    // An invoice and its receipt are the two halves of one transaction. A
    // client asking for a receipt is not asking their supplier to upgrade.
    expect(gateFor('invoices:pdf')).toBeNull()
    expect(gateFor('invoices:receipt')).toBeNull()
  })

  it('gates a scheduling channel that does not exist yet', () => {
    // Why these live under `chasing:` rather than `invoices:` — the gate is one
    // rule, and anything added to the feature is covered without an edit here.
    expect(gateFor('chasing:somethingAddedLater')?.feature).toBe('chasing')
  })
})

describe('everything else stays free', () => {
  it('does not gate any other channel', () => {
    const gated = IPC_CHANNELS.filter((channel) => gateFor(channel) !== null)
    const unexpected = gated.filter(
      (channel) =>
        !channel.startsWith('marketing:') &&
        !channel.startsWith('chasing:') &&
        !channel.startsWith('yearEnd:') &&
        channel !== 'ai:send'
    )

    expect(unexpected).toEqual([])
  })

  it('never gates an export', () => {
    // The terms promise exports keep working even on a lapsed licence, and the
    // whole product argument is that the work belongs to the customer. A gate
    // on an export would contradict both.
    for (const channel of IPC_CHANNELS.filter((name) => /export|pdf/i.test(name))) {
      expect(gateFor(channel)).toBeNull()
    }
  })

  it('leaves the money alone', () => {
    // Invoicing is Basic. Gating it would mean a lapsed customer could not bill
    // for work already done, which is the one thing read-only exists to avoid.
    for (const channel of IPC_CHANNELS.filter((name) =>
      /^(invoices|quotes|expenses|finance|time):/.test(name)
    )) {
      expect(gateFor(channel)).toBeNull()
    }
  })
})

describe('the messages', () => {
  it('tell the reader what to do', () => {
    for (const gate of GATES) {
      expect(gate.message).toContain('Pro')
      expect(gate.message).toContain('solo-wrk.com')
      expect(gate.message).toMatch(/[.!?]$/)
    }
  })

  it('uses feature names the licence server actually issues', () => {
    // These strings are matched against the comma-joined list from the server
    // by `hasFeature`, with no trim and no normalisation. A capital letter or a
    // stray space here would fail every check silently.
    for (const gate of GATES) {
      expect(gate.feature).toBe(gate.feature.trim().toLowerCase())
      expect(gate.feature).not.toContain(',')
      expect(['assistant', 'marketing', 'chasing', 'yearend']).toContain(gate.feature)
    }
  })
})

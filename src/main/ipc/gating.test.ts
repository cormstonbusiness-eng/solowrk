import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { FEATURES, LIMITS, TIER_NAMES, requires, type Limit } from '@shared/entitlements'
import { ACCOUNT_URL, GATES, gateFor, limitsFor } from './gating'

/**
 * The paid-feature gate, and the volume limits beside it.
 *
 * Two failures matter and neither is visible from the outside: a channel
 * escaping the gate gives a paid feature away, and a channel wrongly caught by
 * it locks a customer out of something they bought. Both are silent, so they
 * are pinned here.
 *
 * This file used to have a sibling, `shared/ipc.test.ts`, which existed
 * because read-only was classified from channel *names* by a regex that failed
 * open — so any write with an unfamiliar verb was silently permitted on a
 * lapsed licence, and it caught four such bugs. §3.4 removed read-only as a
 * state, and that whole class of bug went with it. The successor failure is
 * here instead: a creation channel missing from the limit map is a limit that
 * silently does not apply.
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
  it('is no longer gated as a feature at all', () => {
    // §2.1 gives Free twenty messages a month and the paid tiers unlimited, so
    // sending is governed by a limit rather than by a gate. A gate here would
    // refuse a Free user their first message.
    expect(gateFor('ai:send')).toBeNull()
    expect(limitsFor('ai:send')).toEqual(['assistantMessages'])
  })

  it('leaves the rest of ai: alone', () => {
    for (const channel of IPC_CHANNELS.filter((name) => name.startsWith('ai:'))) {
      expect(gateFor(channel)).toBeNull()
    }
  })

  it('gates the review that writes itself', () => {
    // The weekly business review is Pro; the assistant it runs through is not.
    expect(gateFor('review:week')?.feature).toBe('aireview')
  })
})

describe('the chase schedule is paid, chasing is not', () => {
  it('gates the automatic schedule', () => {
    const chasing = IPC_CHANNELS.filter((channel) => channel.startsWith('chasing:'))

    expect(chasing.length).toBeGreaterThan(0)
    for (const channel of chasing) {
      expect(gateFor(channel)?.feature).toBe('chasing')
    }
  })

  it('leaves the button that chases one invoice by hand alone', () => {
    // The line the tier is drawn on. A paid tier sells not having to remember
    // which invoices have gone quiet; it does not sell the ability to ask for
    // your own money, and anyone who notices an overdue invoice must be able
    // to write to their client about it.
    expect(gateFor('invoices:chaser')).toBeNull()
  })

  it('does not gate the documents a client asks for', () => {
    // An invoice and its receipt are the two halves of one transaction. A
    // client asking for a receipt is not asking their supplier to upgrade.
    expect(gateFor('invoices:pdf')).toBeNull()
    expect(gateFor('invoices:receipt')).toBeNull()
  })

  it('gates the bank import, and only the reconciling', () => {
    // §2.1 says import is free on every tier. This is the deliberate
    // carve-out: that clause is about data portability, and a bank statement
    // is held at the user's own bank. Every invoice and expense it touches
    // stays free to read and export either way.
    expect(gateFor('bank:import')?.feature).toBe('bank')
    expect(gateFor('bank:matchInvoice')?.feature).toBe('bank')
    expect(gateFor('expenses:list')).toBeNull()
  })

  it('keeps the library while charging for writing one from a project', () => {
    /*
      §12 splits these deliberately, and longest-prefix-first is what makes
      the split expressible. Keeping a case study is Basic+ — somebody who
      wrote one by hand must always be able to file it. What Pro buys is the
      app reading a finished project and filling in the dates, the hours and
      the deliverables.
    */
    expect(gateFor('library:list')?.feature).toBe('marketing')
    expect(gateFor('library:create')?.feature).toBe('marketing')
    expect(gateFor('library:draftCaseStudy')?.feature).toBe('casestudies')
  })

  it('gates the update pack without gating the client', () => {
    // One channel, not a prefix — longest-prefix-first is what makes that
    // work, and it is worth asserting because getting it wrong would gate
    // every client operation there is.
    expect(gateFor('clients:updatePack')?.feature).toBe('updatepack')
    expect(gateFor('clients:list')).toBeNull()
    expect(gateFor('clients:create')).toBeNull()
  })
})

describe('everything else stays free', () => {
  it('does not gate any other channel', () => {
    const gated = IPC_CHANNELS.filter((channel) => gateFor(channel) !== null)

    // Derived from the gates themselves rather than a second hardcoded list.
    // The old version of this test kept a copy of every prefix and had to be
    // edited in two places for each new gate, which is exactly how a list
    // stops matching what it describes.
    const unexpected = gated.filter(
      (channel) => !GATES.some((gate) => channel.startsWith(gate.prefix))
    )

    expect(unexpected).toEqual([])
  })

  it('never gates an export', () => {
    // The terms promise exports keep working on every tier, and the whole
    // product argument is that the work belongs to the customer. §2.1 puts
    // export and import on Free for exactly this reason.
    for (const channel of IPC_CHANNELS.filter((name) => /export|pdf/i.test(name))) {
      expect(gateFor(channel)).toBeNull()
    }
  })

  it('leaves invoicing itself alone', () => {
    // Invoicing is on every tier, capped by volume rather than gated. A gate
    // here would mean somebody who has dropped to Free cannot bill for work
    // already done, which §4.3 forbids in as many words.
    for (const channel of IPC_CHANNELS.filter((name) =>
      /^(invoices|quotes|finance|time):/.test(name)
    )) {
      expect(gateFor(channel)).toBeNull()
    }
  })
})

describe('the limits', () => {
  it('names only channels that exist', () => {
    // A typo here is a limit that silently never applies, because the channel
    // it is keyed on is never called.
    for (const channel of IPC_CHANNELS) {
      for (const limit of limitsFor(channel)) {
        expect(LIMITS).toContain(limit)
      }
    }
  })

  it('covers every counted thing', () => {
    // The successor to the fail-open verb regex: if something is counted, some
    // channel had better be checked against it, or the cap is decorative.
    const covered = new Set(IPC_CHANNELS.flatMap((channel) => limitsFor(channel)))

    /*
      Two limits are not enforced through a channel, and both for the same
      reason: nothing about them is countable from a workspace database.

      Devices are counted by the licence server at activation — nothing local
      can see the other computers. Workspaces are counted in the config file,
      because a workspace *is* a database and there is no single one to ask;
      `workspaces.ts` refuses at the point one would be created.
    */
    const elsewhere = new Set<Limit>(['devices', 'workspaces'])

    for (const limit of LIMITS) {
      if (elsewhere.has(limit)) continue
      expect([...covered]).toContain(limit)
    }
  })

  it('counts creating and nothing else', () => {
    // §4.2: loading data that exceeds a limit is always allowed. A limit on a
    // read would hide somebody's own clients from them.
    for (const channel of IPC_CHANNELS) {
      if (limitsFor(channel).length === 0) continue
      expect(channel).toMatch(/create|start|send|convert/)
    }
  })

  it('charges a quote conversion for both things it makes', () => {
    // It creates a project and an invoice in one call, and its name says
    // neither — the one channel where a single limit would be a side door.
    expect(limitsFor('quotes:convert')).toEqual(['projects', 'invoicesPerMonth'])
  })

  it('does not limit reading any of them', () => {
    for (const channel of ['clients:list', 'projects:list', 'invoices:list', 'goals:list']) {
      expect(limitsFor(channel)).toEqual([])
    }
  })
})

describe('the messages', () => {
  it('name the tier that actually unlocks the feature', () => {
    // Generated rather than written, so moving a feature between tiers cannot
    // leave a sentence behind claiming the old one. This is what the old test
    // could not do: it asserted the literal word "Pro" in every message, and
    // would have failed the moment a feature moved to Basic+.
    for (const gate of GATES) {
      expect(gate.message).toContain(TIER_NAMES[requires(gate.feature)])
    }
  })

  it('tell the reader where to go, and read as sentences', () => {
    for (const gate of GATES) {
      expect(gate.message).toContain(ACCOUNT_URL)
      expect(gate.message).toMatch(/[.!?]$/)
    }
  })

  it('say what still works without it', () => {
    // Every gate in this app sits next to something the user keeps. Saying so
    // is what stops a paywall reading as a hostage note, and it is the half of
    // the message that is deliberately hand-written.
    for (const gate of GATES) {
      expect(gate.message.length).toBeGreaterThan(80)
    }
  })

  it('uses feature names the licence server issues', () => {
    for (const gate of GATES) {
      // Derived from the entitlement map rather than a second hardcoded
      // allowlist, so adding a gate is one edit and not three.
      expect(FEATURES).toContain(gate.feature)
    }
  })
})
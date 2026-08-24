import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DueChase, Settings } from '@shared/types'
import { DEFAULT_CHASE_DAYS } from '@shared/chasing'
import { Database } from '../db'
import { createInvoice } from './invoices'
import { updateSettings } from './settings'
import {
  chaseDedupeKey,
  chaseSchedule,
  draftChaser,
  dueChasers,
  markChased,
  stopChasing
} from './chasers'

/**
 * The chase schedule.
 *
 * The consequences of getting this wrong land on somebody else's client, in the
 * user's name, so the parsing is deliberately forgiving and pinned here, and
 * the sweep is exercised against a real database below.
 */

function settingsWith(chaseDays: string, chaseEnabled = true): Settings {
  return { chaseDays, chaseEnabled } as Settings
}

describe('reading the schedule', () => {
  it('takes a plain list', () => {
    expect(chaseSchedule(settingsWith('7,14,30'))).toEqual([7, 14, 30])
  })

  it('tolerates the spaces people type', () => {
    expect(chaseSchedule(settingsWith('7, 14 , 30'))).toEqual([7, 14, 30])
  })

  it('sorts, so a schedule entered backwards still escalates', () => {
    // "30,7,14" almost certainly means the same three milestones, and chasing
    // hardest first would be the opposite of what they meant.
    expect(chaseSchedule(settingsWith('30,7,14'))).toEqual([7, 14, 30])
  })

  it('drops duplicates', () => {
    // Two chasers on the same day is one too many.
    expect(chaseSchedule(settingsWith('7,7,14'))).toEqual([7, 14])
  })

  it('ignores nonsense rather than failing', () => {
    // A schedule someone mangled by hand should chase sensibly, not stop
    // chasing — silence here would look identical to "nobody owes me anything".
    expect(chaseSchedule(settingsWith('7,banana,14'))).toEqual([7, 14])
    expect(chaseSchedule(settingsWith('7,-3,14'))).toEqual([7, 14])
  })

  it('falls back when there is nothing usable', () => {
    for (const input of ['', '   ', 'nonsense', ',,,']) {
      expect(chaseSchedule(settingsWith(input))).toEqual(DEFAULT_CHASE_DAYS)
    }
  })

  it('allows chasing on the due date itself', () => {
    // Zero is a legitimate choice for somebody who invoices on delivery.
    expect(chaseSchedule(settingsWith('0,7'))).toEqual([0, 7])
  })

  it('accepts a single milestone', () => {
    expect(chaseSchedule(settingsWith('14'))).toEqual([14])
  })
})

/**
 * The sweep, against a real database.
 *
 * The property that matters is that it does not nag: a sweep running every
 * morning must raise each invoice once per milestone and then stay quiet. A
 * bug here would not throw or fail a build — it would simply badger a paying
 * customer about the same invoice every day until they turned the feature off.
 */
describe('the sweep', () => {
  let db: Database

  /** An invoice sent and unpaid, with a due date the given number of days ago. */
  function overdueBy(days: number, gross = 100_00): number {
    const due = new Date(Date.UTC(2026, 5, 1) - days * 86_400_000).toISOString().slice(0, 10)
    const invoice = createInvoice(db, {
      clientId: null,
      status: 'sent',
      issueDate: due,
      dueDate: due,
      lines: [{ description: 'Work', quantity: 1, unitPrice: gross }]
    })
    return invoice.id
  }

  /** 1 June 2026, the day every case below is judged against. */
  const TODAY = '2026-06-01'

  beforeEach(() => {
    db = new Database(':memory:')
    updateSettings(db, { chaseEnabled: true, chaseDays: '7,14,30' })
  })

  afterEach(() => {
    db.close()
  })

  it('says nothing until the first milestone', () => {
    overdueBy(6)
    expect(dueChasers(db, TODAY)).toEqual([])
  })

  it('raises an invoice once it has crossed one', () => {
    const id = overdueBy(7)
    const due = dueChasers(db, TODAY)

    expect(due).toHaveLength(1)
    expect(due[0]!.invoice.id).toBe(id)
    expect(due[0]!.attempt).toBe(1)
    expect(due[0]!.attempts).toBe(3)
    expect(due[0]!.daysLate).toBe(7)
  })

  it('does not raise it again once it has been acted on', () => {
    // The whole feature. Running the sweep every morning must not mean being
    // told about the same invoice every morning.
    const id = overdueBy(7)
    markChased(db, id, 1, TODAY)

    expect(dueChasers(db, TODAY)).toEqual([])
  })

  it('raises it again at the next milestone, and not before', () => {
    const id = overdueBy(7)
    markChased(db, id, 1, TODAY)

    expect(dueChasers(db, '2026-06-07')).toEqual([]) // 13 days late
    expect(dueChasers(db, '2026-06-08')).toHaveLength(1) // 14
    expect(dueChasers(db, '2026-06-08')[0]!.attempt).toBe(2)
  })

  it('catches up in one note rather than three', () => {
    // A fortnight with the laptop shut. Somebody coming back to find three
    // notifications about one invoice would reasonably conclude the app was
    // broken; the milestone actually reached is the one worth sending.
    overdueBy(31)
    const due = dueChasers(db, TODAY)

    expect(due).toHaveLength(1)
    expect(due[0]!.attempt).toBe(3)
  })

  it('stops after the last milestone', () => {
    const id = overdueBy(400)
    markChased(db, id, 3, TODAY)

    // Nothing in the schedule left to reach. It stays overdue and stays on the
    // list; it just stops asking.
    expect(dueChasers(db, TODAY)).toEqual([])
  })

  it('stops chasing one invoice without touching the others', () => {
    const quiet = overdueBy(30)
    const loud = overdueBy(30)
    stopChasing(db, quiet)

    const due = dueChasers(db, TODAY)
    expect(due.map((chase) => chase.invoice.id)).toEqual([loud])
  })

  it('says nothing at all while the setting is off', () => {
    overdueBy(90)
    updateSettings(db, { chaseEnabled: false })

    expect(dueChasers(db, TODAY)).toEqual([])
  })

  it('leaves paid and draft invoices alone', () => {
    // Chasing somebody who has already paid is the one mistake here that costs
    // a relationship rather than a morning.
    const paid = overdueBy(30)
    db.run("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?", [TODAY, paid])

    const draft = createInvoice(db, {
      clientId: null,
      status: 'draft',
      issueDate: '2026-01-01',
      dueDate: '2026-01-01',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 100_00 }]
    })

    const due = dueChasers(db, TODAY)
    expect(due.map((chase) => chase.invoice.id)).not.toContain(paid)
    expect(due.map((chase) => chase.invoice.id)).not.toContain(draft.id)
  })
})

/**
 * The dedupe key.
 *
 * `notify` compares against every notification ever raised, so this string is
 * the entire difference between one prompt and a daily nag — and getting it
 * wrong fails silently in the direction that makes people uninstall.
 */
describe('what counts as the same news', () => {
  const chase = (id: number, attempt: number): DueChase =>
    ({ invoice: { id }, attempt, attempts: 3, daysLate: 7 }) as DueChase

  it('is the same key for the same invoices at the same milestones', () => {
    // Tomorrow morning, with nothing paid and nothing chased: no new news, so
    // nothing is said. The queue on the Invoices page is still there.
    expect(chaseDedupeKey([chase(5, 1)])).toBe(chaseDedupeKey([chase(5, 1)]))
  })

  it('does not depend on the date', () => {
    // The bug this replaced. A key containing today's date is unique every
    // morning, which announces the same unchanged set daily for ever.
    expect(chaseDedupeKey([chase(5, 1)])).not.toContain('-20')
  })

  it('changes when an invoice reaches the next milestone', () => {
    expect(chaseDedupeKey([chase(5, 2)])).not.toBe(chaseDedupeKey([chase(5, 1)]))
  })

  it('changes when another invoice goes late', () => {
    expect(chaseDedupeKey([chase(5, 1), chase(9, 1)])).not.toBe(chaseDedupeKey([chase(5, 1)]))
  })

  it('does not care what order they arrive in', () => {
    expect(chaseDedupeKey([chase(9, 1), chase(5, 2)])).toBe(
      chaseDedupeKey([chase(5, 2), chase(9, 1)])
    )
  })

  it('does not confuse one set for another that reads the same run together', () => {
    // Without the separator, invoice 1 at milestone 12 and invoices 1 and 2 at
    // milestone 2 could collide.
    expect(chaseDedupeKey([chase(1, 12)])).not.toBe(chaseDedupeKey([chase(1, 1), chase(2, 2)]))
  })
})

describe('the notes themselves', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('gets firmer without getting rude', () => {
    const invoice = createInvoice(db, {
      clientId: null,
      status: 'sent',
      issueDate: '2026-01-01',
      dueDate: '2026-01-01',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 100_00 }]
    })

    const notes = [1, 2, 3].map((attempt) => draftChaser(db, invoice.id, attempt))

    // Three distinct registers, not the same note relabelled.
    expect(new Set(notes.map((note) => note.subject)).size).toBe(3)
    expect(new Set(notes.map((note) => note.body)).size).toBe(3)

    // The fourth-week note must not open as though nobody is paying attention.
    expect(notes[0]!.body).toContain('I hope you are well')
    expect(notes[2]!.body).not.toContain('I hope you are well')

    // And none of them threatens anybody. A freelancer sending a solicitor's
    // letter over three hundred pounds has already lost more than they are
    // chasing.
    for (const note of notes) {
      expect(note.body).not.toMatch(/legal|solicitor|court|debt collect|interest will/i)
      expect(note.body).toContain(invoice.number)
    }
  })

  it('asks for a milestone past the end of the schedule without falling over', () => {
    // A schedule shortened after an invoice had already been chased four times.
    const invoice = createInvoice(db, {
      clientId: null,
      status: 'sent',
      issueDate: '2026-01-01',
      dueDate: '2026-01-01',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 100_00 }]
    })

    expect(() => draftChaser(db, invoice.id, 9)).not.toThrow()
    expect(draftChaser(db, invoice.id, 9).body).toBe(draftChaser(db, invoice.id, 3).body)
  })
})

describe('the default', () => {
  it('escalates rather than repeating', () => {
    const gaps = DEFAULT_CHASE_DAYS.slice(1).map((day, i) => day - DEFAULT_CHASE_DAYS[i]!)
    expect(gaps.every((gap) => gap > 0)).toBe(true)
  })

  it('does not chase before the invoice is meaningfully late', () => {
    // A note the morning after payment terms expire reads as though the
    // invoice matters more than the relationship. A week is a reasonable
    // interval to have let the post, or an accounts run, happen.
    expect(DEFAULT_CHASE_DAYS[0]).toBeGreaterThanOrEqual(5)
  })
})

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
const { createBlock, getBlock, listBlocks } = await import('./blocks')
const { deleteOccurrence, editOccurrence } = await import('./recurrence')

/**
 * A weekly stand-up: Mondays at 09:00, starting 3 August 2026.
 *
 * Every test here is really the same question — did an edit reach further than
 * it was asked to? That is the failure that makes people stop trusting a
 * calendar, and it is invisible until they look at next month.
 */
const STAND_UP = {
  title: 'Stand-up',
  startsAt: '2026-08-03T09:00',
  endsAt: '2026-08-03T09:30',
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO'
}

const AUGUST = { from: '2026-08-01', to: '2026-08-31' }

describe('repeating blocks', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-recur-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  describe('expansion', () => {
    it('shows every Monday from one row', () => {
      createBlock(db, STAND_UP)

      const found = listBlocks(db, AUGUST)
      expect(found.map((one) => one.startsAt)).toEqual([
        '2026-08-03T09:00',
        '2026-08-10T09:00',
        '2026-08-17T09:00',
        '2026-08-24T09:00',
        '2026-08-31T09:00'
      ])
      // One row, five occurrences. The repeats are built, not stored.
      expect(db.all('SELECT id FROM calendar_blocks')).toHaveLength(1)
    })

    it('marks which are real and which are generated', () => {
      const master = createBlock(db, STAND_UP)
      const found = listBlocks(db, AUGUST)

      expect(found[0]?.occurrenceOf).toBeNull()
      expect(found[1]?.occurrenceOf).toBe(master.id)
    })

    it('keeps the length, and the wall time', () => {
      createBlock(db, STAND_UP)
      const found = listBlocks(db, AUGUST)
      expect(found[3]).toMatchObject({
        startsAt: '2026-08-24T09:00',
        endsAt: '2026-08-24T09:30'
      })
    })

    it('shows a series that began long before the range', () => {
      // The row is nowhere near August, which is why it cannot be found by
      // overlap and has to be fetched as a series.
      createBlock(db, { ...STAND_UP, startsAt: '2025-01-06T09:00', endsAt: '2025-01-06T09:30' })
      expect(listBlocks(db, AUGUST)).toHaveLength(5)
    })
  })

  describe('what is next', () => {
    it('finds a repeat, not just the row', async () => {
      const { upcomingBlocks } = await import('./blocks')
      // The row is last year. A query over rows would say Monday was empty.
      createBlock(db, { ...STAND_UP, startsAt: '2025-01-06T09:00', endsAt: '2025-01-06T09:30' })

      const next = upcomingBlocks(db, '2026-08-04T00:00', 3)
      expect(next.map((one) => one.startsAt)).toEqual([
        '2026-08-10T09:00',
        '2026-08-17T09:00',
        '2026-08-24T09:00'
      ])
    })

    it('puts a one-off and a repeat in the right order', async () => {
      const { upcomingBlocks } = await import('./blocks')
      createBlock(db, STAND_UP)
      createBlock(db, {
        title: 'Dentist',
        startsAt: '2026-08-05T14:00',
        endsAt: '2026-08-05T15:00'
      })

      expect(upcomingBlocks(db, '2026-08-04T00:00', 2).map((one) => one.title)).toEqual([
        'Dentist',
        'Stand-up'
      ])
    })
  })

  describe('reminders on a repeat', () => {
    it('fires for an occurrence whose series row is long past', async () => {
      const { dueReminders } = await import('./blocks')
      createBlock(db, {
        ...STAND_UP,
        startsAt: '2025-01-06T09:00',
        endsAt: '2025-01-06T09:30',
        reminderMinutes: 15
      })

      // Monday 10 August 2026, quarter to nine.
      const { due } = dueReminders(db, '2026-08-10T08:45')
      expect(due.map((one) => one.startsAt)).toEqual(['2026-08-10T09:00'])
    })

    it('gives each occurrence its own dedupe key', async () => {
      const { dueReminders } = await import('./blocks')
      const master = createBlock(db, { ...STAND_UP, reminderMinutes: 15 })

      const first = dueReminders(db, '2026-08-03T08:45').due[0]
      const second = dueReminders(db, '2026-08-10T08:45').due[0]

      // The row is the same one; the occurrences are not. Without the day in
      // the key the second reminder would be swallowed as a duplicate.
      expect(first?.key).toBe(String(master.id))
      expect(second?.key).toBe(`${master.id}@2026-08-10`)
    })

    it('does not silence the series when one occurrence is marked', async () => {
      const { dueReminders, markReminded } = await import('./blocks')
      const master = createBlock(db, { ...STAND_UP, reminderMinutes: 15 })

      // The first occurrence is a real row and does get marked.
      markReminded(db, [master.id], '2026-08-03T08:45')
      expect(dueReminders(db, '2026-08-03T08:45').due).toHaveLength(0)

      // Every Monday after it must still fire.
      expect(dueReminders(db, '2026-08-10T08:45').due).toHaveLength(1)
    })
  })

  describe('changing one occurrence', () => {
    it('leaves the rest of the series alone', () => {
      const master = createBlock(db, STAND_UP)

      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'one', {
        startsAt: '2026-08-17T14:00',
        endsAt: '2026-08-17T14:30'
      })

      const found = listBlocks(db, AUGUST)
      expect(found.map((one) => one.startsAt)).toEqual([
        '2026-08-03T09:00',
        '2026-08-10T09:00',
        '2026-08-17T14:00',
        '2026-08-24T09:00',
        '2026-08-31T09:00'
      ])
    })

    it('becomes a real row that points back at the series', () => {
      const master = createBlock(db, STAND_UP)
      const moved = editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'one', {
        startsAt: '2026-08-17T14:00',
        endsAt: '2026-08-17T14:30'
      })

      expect(moved.recurrenceParentId).toBe(master.id)
      // And it does not repeat itself, or one Monday would spawn a series.
      expect(moved.recurrenceRule).toBeNull()
      expect(getBlock(db, master.id).recurrenceExdates).toEqual(['2026-08-17'])
    })

    it('inherits everything the series had', () => {
      const master = createBlock(db, {
        ...STAND_UP,
        blockType: 'meeting',
        location: 'Zoom',
        colour: '#E5484D',
        reminderMinutes: 10
      })
      const moved = editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'one', {
        startsAt: '2026-08-17T14:00'
      })

      expect(moved).toMatchObject({ location: 'Zoom', colour: '#E5484D', reminderMinutes: 10 })
    })
  })

  describe('changing this one and everything after', () => {
    it('splits into two series at the right day', () => {
      const master = createBlock(db, STAND_UP)

      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'future', {
        startsAt: '2026-08-17T14:00',
        endsAt: '2026-08-17T14:30'
      })

      expect(listBlocks(db, AUGUST).map((one) => one.startsAt)).toEqual([
        '2026-08-03T09:00',
        '2026-08-10T09:00',
        '2026-08-17T14:00',
        '2026-08-24T14:00',
        '2026-08-31T14:00'
      ])
    })

    it('ends the old series the day before, rather than leaving it running', () => {
      const master = createBlock(db, STAND_UP)
      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'future', {
        startsAt: '2026-08-17T14:00'
      })

      expect(getBlock(db, master.id).recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20260816')
    })

    it('turns a count into an end date, because the count was for the whole run', () => {
      const master = createBlock(db, { ...STAND_UP, recurrenceRule: 'FREQ=WEEKLY;COUNT=10' })
      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'future', {
        startsAt: '2026-08-17T14:00'
      })

      const rule = getBlock(db, master.id).recurrenceRule ?? ''
      expect(rule).toContain('UNTIL=20260816')
      expect(rule).not.toContain('COUNT')
    })

    it('is the same as "all" when it starts from the first occurrence', () => {
      // Splitting there would leave an empty series behind with nothing in it.
      const master = createBlock(db, STAND_UP)
      editOccurrence(db, { id: master.id, day: '2026-08-03' }, 'future', {
        startsAt: '2026-08-03T14:00',
        endsAt: '2026-08-03T14:30'
      })

      expect(db.all('SELECT id FROM calendar_blocks')).toHaveLength(1)
      expect(listBlocks(db, AUGUST).map((one) => one.startsAt)).toEqual([
        '2026-08-03T14:00',
        '2026-08-10T14:00',
        '2026-08-17T14:00',
        '2026-08-24T14:00',
        '2026-08-31T14:00'
      ])
    })
  })

  describe('changing all of them', () => {
    it('shifts every occurrence rather than pinning them to one day', () => {
      // The failure this guards against is a year of Tuesdays collapsing onto
      // a single afternoon because the edit was applied as a value.
      const master = createBlock(db, STAND_UP)

      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'all', {
        startsAt: '2026-08-17T10:30',
        endsAt: '2026-08-17T11:00'
      })

      expect(listBlocks(db, AUGUST).map((one) => one.startsAt)).toEqual([
        '2026-08-03T10:30',
        '2026-08-10T10:30',
        '2026-08-17T10:30',
        '2026-08-24T10:30',
        '2026-08-31T10:30'
      ])
    })

    it('moves the whole series to another weekday', () => {
      const master = createBlock(db, { ...STAND_UP, recurrenceRule: 'FREQ=WEEKLY' })

      // Dragged one Monday onto the Tuesday. Every Monday follows.
      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'all', {
        startsAt: '2026-08-18T09:00',
        endsAt: '2026-08-18T09:30'
      })

      expect(listBlocks(db, AUGUST).map((one) => one.startsAt)).toEqual([
        '2026-08-04T09:00',
        '2026-08-11T09:00',
        '2026-08-18T09:00',
        '2026-08-25T09:00'
      ])
    })

    it('applies a plain field change without touching the times', () => {
      const master = createBlock(db, STAND_UP)
      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'all', { title: 'Team sync' })

      const found = listBlocks(db, AUGUST)
      expect(found.every((one) => one.title === 'Team sync')).toBe(true)
      expect(found[0]?.startsAt).toBe('2026-08-03T09:00')
    })

    it('still adds up to one row', () => {
      const master = createBlock(db, STAND_UP)
      editOccurrence(db, { id: master.id, day: '2026-08-17' }, 'all', { title: 'Team sync' })
      expect(db.all('SELECT id FROM calendar_blocks')).toHaveLength(1)
    })
  })

  describe('removing occurrences', () => {
    it('skips just the one', () => {
      const master = createBlock(db, STAND_UP)
      deleteOccurrence(db, { id: master.id, day: '2026-08-17' }, 'one')

      expect(listBlocks(db, AUGUST).map((one) => one.startsAt)).toEqual([
        '2026-08-03T09:00',
        '2026-08-10T09:00',
        '2026-08-24T09:00',
        '2026-08-31T09:00'
      ])
    })

    it('stops the series from a day onward', () => {
      const master = createBlock(db, STAND_UP)
      deleteOccurrence(db, { id: master.id, day: '2026-08-17' }, 'future')

      expect(listBlocks(db, AUGUST).map((one) => one.startsAt)).toEqual([
        '2026-08-03T09:00',
        '2026-08-10T09:00'
      ])
    })

    it('refuses to delete a whole series behind the back of the trash', () => {
      const master = createBlock(db, STAND_UP)
      expect(() => deleteOccurrence(db, { id: master.id, day: '2026-08-17' }, 'all')).toThrow(
        /trash/
      )
    })
  })

  describe('a block that does not repeat', () => {
    it('is edited plainly, whatever scope it is given', () => {
      const one = createBlock(db, {
        title: 'Dentist',
        startsAt: '2026-08-12T09:00',
        endsAt: '2026-08-12T10:00'
      })

      const edited = editOccurrence(db, { id: one.id, day: '2026-08-12' }, 'all', {
        title: 'Dentist (moved)'
      })
      expect(edited.title).toBe('Dentist (moved)')
    })
  })
})

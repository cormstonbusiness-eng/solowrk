import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blockTypeMeta } from '@shared/types'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createProject } = await import('./projects')
const {
  createBlock,
  dueReminders,
  getBlock,
  listBlocks,
  markReminded,
  updateBlock,
  upcomingBlocks
} = await import('./blocks')

describe('calendar blocks', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-blocks-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const meeting = {
    title: 'Kickoff call',
    startsAt: '2026-08-17T10:00',
    endsAt: '2026-08-17T11:00'
  }

  it('creates and reads a block back unchanged', () => {
    const created = createBlock(db, { ...meeting, location: 'Zoom' })
    expect(getBlock(db, created.id)).toMatchObject({
      title: 'Kickoff call',
      startsAt: '2026-08-17T10:00',
      endsAt: '2026-08-17T11:00',
      location: 'Zoom',
      // Not 'focus'. A block with no type stated is an hour with a time on it
      // and nothing more, and claiming otherwise would put invented billable
      // hours into the capacity figures.
      blockType: 'meeting',
      source: 'local',
      allDay: false
    })
  })

  describe('block types', () => {
    it('takes billable from what the type usually means', () => {
      expect(createBlock(db, { ...meeting, blockType: 'focus' }).billable).toBe(true)
      expect(createBlock(db, { ...meeting, blockType: 'admin' }).billable).toBe(false)
    })

    it('lets an explicit answer beat the type', () => {
      // Pro bono work is still focus work; a paid workshop is still a meeting.
      expect(createBlock(db, { ...meeting, blockType: 'focus', billable: false }).billable).toBe(
        false
      )
      expect(createBlock(db, { ...meeting, blockType: 'meeting', billable: true }).billable).toBe(
        true
      )
    })

    it('agrees with the shared registry about what counts', () => {
      // The registry is what the capacity maths reads, so a type that claims
      // to be billable here and not there would produce two different weeks.
      expect(blockTypeMeta('focus')).toMatchObject({ billable: true, counts: true })
      expect(blockTypeMeta('personal')).toMatchObject({ billable: false, counts: false })
      expect(blockTypeMeta('deadline').draggable).toBe(false)
    })
  })

  describe('colour', () => {
    it('falls back to the project colour, then to the type', async () => {
      const project = await createProject(db, root, { name: 'Rebrand', colour: '#3B82F6' })

      const inherited = createBlock(db, { ...meeting, projectId: project.id })
      expect(inherited.displayColour).toBe('#3B82F6')

      const explicit = createBlock(db, { ...meeting, projectId: project.id, colour: '#E5484D' })
      expect(explicit.displayColour).toBe('#E5484D')

      expect(createBlock(db, { ...meeting, blockType: 'holiday' }).displayColour).toBe(
        blockTypeMeta('holiday').colour
      )
    })
  })

  describe('a block always has a length', () => {
    it('turns a backwards span into the minimum, not a point', () => {
      const created = createBlock(db, {
        title: 'Backwards',
        startsAt: '2026-08-17T14:00',
        endsAt: '2026-08-17T09:00'
      })
      // Collapsing to a point was the old behaviour and it was wrong: a block
      // of no length renders as nothing at all, so it cannot be clicked,
      // found, or deleted by anybody who does not already know it is there.
      expect(created.endsAt).toBe('2026-08-17T14:15')
    })

    it('refuses a start and end at the same moment', () => {
      const created = createBlock(db, {
        title: 'Instant',
        startsAt: '2026-08-17T14:00',
        endsAt: '2026-08-17T14:00'
      })
      expect(created.endsAt).toBe('2026-08-17T14:15')
    })

    it('holds the line on an update as well as a create', () => {
      const created = createBlock(db, meeting)
      expect(updateBlock(db, created.id, { endsAt: '2026-08-17T10:00' }).endsAt).toBe(
        '2026-08-17T10:15'
      )
    })
  })

  it('refuses to change a block that came from someone else’s calendar', () => {
    const created = createBlock(db, {
      ...meeting,
      source: 'ics_subscription',
      sourceUid: 'abc@example.com',
      locked: true
    })

    // Refused in the service rather than only in the UI, because the assistant
    // and the IPC layer reach this too.
    expect(() => updateBlock(db, created.id, { title: 'Renamed' })).toThrow(/subscribe/)
  })

  describe('listing a range', () => {
    beforeEach(() => {
      createBlock(db, meeting)
      createBlock(db, {
        title: 'Late night deploy',
        startsAt: '2026-08-19T23:00',
        endsAt: '2026-08-20T02:00'
      })
      createBlock(db, {
        title: 'Next month',
        startsAt: '2026-09-05T09:00',
        endsAt: '2026-09-05T10:00'
      })
    })

    it('returns blocks overlapping the range', () => {
      const found = listBlocks(db, { from: '2026-08-01', to: '2026-08-31' })
      expect(found.map((block) => block.title)).toEqual(['Kickoff call', 'Late night deploy'])
    })

    it('includes a block that starts late on the last day of the range', () => {
      // The naive comparison '2026-08-19' >= '2026-08-19T23:00' is false, which
      // would drop this block from a range ending on its own start day.
      const found = listBlocks(db, { from: '2026-08-19', to: '2026-08-19' })
      expect(found.map((block) => block.title)).toEqual(['Late night deploy'])
    })

    it('includes a block that started before the range and runs into it', () => {
      const found = listBlocks(db, { from: '2026-08-20', to: '2026-08-20' })
      expect(found.map((block) => block.title)).toEqual(['Late night deploy'])
    })

    it('filters to one project', async () => {
      const project = await createProject(db, root, { name: 'Rebrand' })
      createBlock(db, { ...meeting, title: 'Project call', projectId: project.id })

      const found = listBlocks(db, { from: '2026-08-01', to: '2026-08-31', projectId: project.id })
      expect(found.map((block) => block.title)).toEqual(['Project call'])
    })
  })

  it('lists the next blocks in start order', () => {
    createBlock(db, { title: 'Second', startsAt: '2026-08-18T09:00', endsAt: '2026-08-18T10:00' })
    createBlock(db, { title: 'First', startsAt: '2026-08-17T09:00', endsAt: '2026-08-17T10:00' })

    expect(upcomingBlocks(db, '2026-08-01T00:00', 5).map((b) => b.title)).toEqual([
      'First',
      'Second'
    ])
  })

  describe('reminders', () => {
    it('does not fire before the reminder time', () => {
      createBlock(db, { ...meeting, reminderMinutes: 15 })
      expect(dueReminders(db, '2026-08-17T09:30').due).toHaveLength(0)
    })

    it('fires once the reminder time has arrived', () => {
      createBlock(db, { ...meeting, reminderMinutes: 15 })
      expect(dueReminders(db, '2026-08-17T09:45').due.map((b) => b.title)).toEqual(['Kickoff call'])
    })

    it('ignores blocks with no reminder set', () => {
      createBlock(db, meeting)
      expect(dueReminders(db, '2026-08-17T09:59').due).toHaveLength(0)
    })

    it('does not fire twice', () => {
      const created = createBlock(db, { ...meeting, reminderMinutes: 15 })
      markReminded(db, [created.id], '2026-08-17T09:45')
      expect(dueReminders(db, '2026-08-17T09:50').due).toHaveLength(0)
    })

    it('retires a reminder whose moment has long passed rather than showing it', () => {
      // The app was closed over the meeting. Being told at 11:30 about a call
      // that started at 10:00 is noise, so it is swept rather than shown.
      createBlock(db, { ...meeting, reminderMinutes: 15 })
      const { due, stale } = dueReminders(db, '2026-08-17T11:30')
      expect(due).toHaveLength(0)
      expect(stale.map((b) => b.title)).toEqual(['Kickoff call'])
    })

    it('still shows a reminder for a block that started moments ago', () => {
      createBlock(db, { ...meeting, reminderMinutes: 15 })
      expect(dueReminders(db, '2026-08-17T10:02').due).toHaveLength(1)
    })

    it('re-arms when the block is moved', () => {
      const created = createBlock(db, { ...meeting, reminderMinutes: 15 })
      markReminded(db, [created.id], '2026-08-17T09:45')

      updateBlock(db, created.id, {
        startsAt: '2026-08-18T10:00',
        endsAt: '2026-08-18T11:00'
      })

      expect(getBlock(db, created.id).remindedAt).toBeNull()
      expect(dueReminders(db, '2026-08-18T09:45').due).toHaveLength(1)
    })

    it('does not re-arm for an unrelated edit', () => {
      const created = createBlock(db, { ...meeting, reminderMinutes: 15 })
      markReminded(db, [created.id], '2026-08-17T09:45')

      updateBlock(db, created.id, { title: 'Kickoff call (renamed)' })
      expect(getBlock(db, created.id).remindedAt).not.toBeNull()
    })
  })

  describe('updating', () => {
    it('keeps the original end when only the start moves', () => {
      const created = createBlock(db, meeting)
      const moved = updateBlock(db, created.id, { startsAt: '2026-08-17T10:30' })
      expect(moved).toMatchObject({ startsAt: '2026-08-17T10:30', endsAt: '2026-08-17T11:00' })
    })

    it('gives a start dragged past the existing end the minimum length', () => {
      const created = createBlock(db, meeting)
      const moved = updateBlock(db, created.id, { startsAt: '2026-08-17T12:00' })
      // Not 12:00. §13 forbids a zero-length block anywhere, and this is one
      // of the entry points somebody can reach by accident with a mouse.
      expect(moved.endsAt).toBe('2026-08-17T12:15')
    })

    it('stores all-day as a flag, not as a missing time', () => {
      const created = createBlock(db, { ...meeting, allDay: true })
      expect(created.allDay).toBe(true)
      expect(updateBlock(db, created.id, { allDay: false }).allDay).toBe(false)
    })
  })
})
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
const { createProject } = await import('./projects')
const {
  createEvent,
  deleteEvent,
  dueReminders,
  getEvent,
  listEvents,
  markReminded,
  updateEvent,
  upcomingEvents
} = await import('./events')

describe('events', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-events-'))
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

  it('creates and reads an event back unchanged', () => {
    const created = createEvent(db, { ...meeting, location: 'Zoom' })
    expect(getEvent(db, created.id)).toMatchObject({
      title: 'Kickoff call',
      startsAt: '2026-08-17T10:00',
      endsAt: '2026-08-17T11:00',
      location: 'Zoom',
      kind: 'local',
      allDay: false
    })
  })

  it('falls back to the project colour, then to the default', async () => {
    const project = await createProject(db, root, { name: 'Rebrand', colour: '#3B82F6' })

    const inherited = createEvent(db, { ...meeting, projectId: project.id })
    expect(inherited.displayColour).toBe('#3B82F6')

    const explicit = createEvent(db, { ...meeting, projectId: project.id, colour: '#E5484D' })
    expect(explicit.displayColour).toBe('#E5484D')

    expect(createEvent(db, meeting).displayColour).toBe('#6E56CF')
  })

  it('refuses to store an event that ends before it starts', () => {
    const created = createEvent(db, {
      title: 'Backwards',
      startsAt: '2026-08-17T14:00',
      endsAt: '2026-08-17T09:00'
    })
    // Collapsed to a point rather than stored with negative length, which would
    // render as an invisible block of negative height.
    expect(created.endsAt).toBe('2026-08-17T14:00')
  })

  describe('listing a range', () => {
    beforeEach(() => {
      createEvent(db, meeting)
      createEvent(db, {
        title: 'Late night deploy',
        startsAt: '2026-08-19T23:00',
        endsAt: '2026-08-20T02:00'
      })
      createEvent(db, {
        title: 'Next month',
        startsAt: '2026-09-05T09:00',
        endsAt: '2026-09-05T10:00'
      })
    })

    it('returns events overlapping the range', () => {
      const found = listEvents(db, { from: '2026-08-01', to: '2026-08-31' })
      expect(found.map((event) => event.title)).toEqual(['Kickoff call', 'Late night deploy'])
    })

    it('includes an event that starts late on the last day of the range', () => {
      // The naive comparison '2026-08-19' >= '2026-08-19T23:00' is false, which
      // would drop this event from a range ending on its own start day.
      const found = listEvents(db, { from: '2026-08-19', to: '2026-08-19' })
      expect(found.map((event) => event.title)).toEqual(['Late night deploy'])
    })

    it('includes an event that started before the range and runs into it', () => {
      const found = listEvents(db, { from: '2026-08-20', to: '2026-08-20' })
      expect(found.map((event) => event.title)).toEqual(['Late night deploy'])
    })

    it('filters to one project', async () => {
      const project = await createProject(db, root, { name: 'Rebrand' })
      createEvent(db, { ...meeting, title: 'Project call', projectId: project.id })

      const found = listEvents(db, { from: '2026-08-01', to: '2026-08-31', projectId: project.id })
      expect(found.map((event) => event.title)).toEqual(['Project call'])
    })
  })

  it('lists the next events in start order', () => {
    createEvent(db, { title: 'Second', startsAt: '2026-08-18T09:00', endsAt: '2026-08-18T10:00' })
    createEvent(db, { title: 'First', startsAt: '2026-08-17T09:00', endsAt: '2026-08-17T10:00' })

    expect(upcomingEvents(db, '2026-08-01T00:00', 5).map((e) => e.title)).toEqual([
      'First',
      'Second'
    ])
  })

  it('deletes an event', () => {
    const created = createEvent(db, meeting)
    deleteEvent(db, created.id)
    expect(listEvents(db, { from: '2026-08-01', to: '2026-08-31' })).toHaveLength(0)
  })

  describe('reminders', () => {
    it('does not fire before the reminder time', () => {
      createEvent(db, { ...meeting, reminderMinutes: 15 })
      expect(dueReminders(db, '2026-08-17T09:30').due).toHaveLength(0)
    })

    it('fires once the reminder time has arrived', () => {
      createEvent(db, { ...meeting, reminderMinutes: 15 })
      expect(dueReminders(db, '2026-08-17T09:45').due.map((e) => e.title)).toEqual(['Kickoff call'])
    })

    it('ignores events with no reminder set', () => {
      createEvent(db, meeting)
      expect(dueReminders(db, '2026-08-17T09:59').due).toHaveLength(0)
    })

    it('does not fire twice', () => {
      const created = createEvent(db, { ...meeting, reminderMinutes: 15 })
      markReminded(db, [created.id], '2026-08-17T09:45')
      expect(dueReminders(db, '2026-08-17T09:50').due).toHaveLength(0)
    })

    it('retires a reminder whose moment has long passed rather than showing it', () => {
      // The app was closed over the meeting. Being told at 11:30 about a call
      // that started at 10:00 is noise, so it is swept rather than shown.
      createEvent(db, { ...meeting, reminderMinutes: 15 })
      const { due, stale } = dueReminders(db, '2026-08-17T11:30')
      expect(due).toHaveLength(0)
      expect(stale.map((e) => e.title)).toEqual(['Kickoff call'])
    })

    it('still shows a reminder for an event that started moments ago', () => {
      createEvent(db, { ...meeting, reminderMinutes: 15 })
      expect(dueReminders(db, '2026-08-17T10:02').due).toHaveLength(1)
    })

    it('re-arms when the event is moved', () => {
      const created = createEvent(db, { ...meeting, reminderMinutes: 15 })
      markReminded(db, [created.id], '2026-08-17T09:45')

      updateEvent(db, created.id, {
        startsAt: '2026-08-18T10:00',
        endsAt: '2026-08-18T11:00'
      })

      expect(getEvent(db, created.id).remindedAt).toBeNull()
      expect(dueReminders(db, '2026-08-18T09:45').due).toHaveLength(1)
    })

    it('does not re-arm for an unrelated edit', () => {
      const created = createEvent(db, { ...meeting, reminderMinutes: 15 })
      markReminded(db, [created.id], '2026-08-17T09:45')

      updateEvent(db, created.id, { title: 'Kickoff call (renamed)' })
      expect(getEvent(db, created.id).remindedAt).not.toBeNull()
    })
  })

  describe('updating', () => {
    it('keeps the original end when only the start moves', () => {
      const created = createEvent(db, meeting)
      const moved = updateEvent(db, created.id, { startsAt: '2026-08-17T10:30' })
      expect(moved).toMatchObject({ startsAt: '2026-08-17T10:30', endsAt: '2026-08-17T11:00' })
    })

    it('collapses a start dragged past the existing end', () => {
      const created = createEvent(db, meeting)
      const moved = updateEvent(db, created.id, { startsAt: '2026-08-17T12:00' })
      expect(moved.endsAt).toBe('2026-08-17T12:00')
    })

    it('stores all-day as a flag, not as a missing time', () => {
      const created = createEvent(db, { ...meeting, allDay: true })
      expect(created.allDay).toBe(true)
      expect(updateEvent(db, created.id, { allDay: false }).allDay).toBe(false)
    })
  })
})

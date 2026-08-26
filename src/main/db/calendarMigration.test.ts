import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database, type Row } from './index'
import { migrations } from './migrations'

/**
 * Migration 23, which drops the calendar's old table.
 *
 * On disk rather than in memory, and through two separate opens, because that
 * is the only way to exercise what actually happens to somebody's workspace:
 * an in-memory database is created at the newest schema and never migrates
 * anything. The rows here are the ones a real workspace would hold, and the
 * point of the test is that `DROP TABLE events` takes nothing with it.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'solo-calmig-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Open at a given schema version by hiding the later migrations. */
function openAt(file: string, upTo: number): Database {
  const kept = migrations.filter((migration) => migration.id <= upTo)
  const removed = migrations.splice(0, migrations.length, ...kept)
  try {
    return new Database(file)
  } finally {
    migrations.splice(0, migrations.length, ...removed)
  }
}

/** The schema version immediately before the calendar was rebuilt. */
const BEFORE_BLOCKS = 22

interface BlockRow extends Row {
  id: number
  title: string
  block_type: string
  starts_at: string
  ends_at: string
  all_day: number
  timezone: string
  source: string
  source_uid: string | null
  colour: string
  reminder_minutes: number | null
  project_id: number | null
}

describe('migrating the calendar to blocks', () => {
  const file = (): string => join(dir, 'solo.db')

  function seedOldCalendar(path: string): void {
    const old = openAt(path, BEFORE_BLOCKS)
    old.run(
      `INSERT INTO events
         (title, description, location, kind, starts_at, ends_at, all_day, colour,
          meeting_url, reminder_minutes, external_id, created_at, updated_at)
       VALUES
         ('Kickoff call', 'Bring the deck', 'Zoom', 'local',
          '2026-08-17T10:00', '2026-08-17T11:00', 0, '#E5484D',
          'https://meet.example/abc', 15, NULL, datetime('now'), datetime('now')),
         ('Bank holiday', '', '', 'local',
          '2026-08-31T00:00', '2026-08-31T23:59', 1, '',
          '', NULL, NULL, datetime('now'), datetime('now')),
         ('Standup', '', '', 'google',
          '2026-08-18T09:15', '2026-08-18T09:30', 0, '',
          '', NULL, 'uid-from-google', datetime('now'), datetime('now'))`
    )
    old.close()
  }

  it('brings every event across as a block, keeping its id', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    const blocks = db.all<BlockRow>('SELECT * FROM calendar_blocks ORDER BY id')

    expect(blocks.map((block) => block.title)).toEqual(['Kickoff call', 'Bank holiday', 'Standup'])
    // Ids are what links, tags, activity and the trash all point at. A
    // migration that renumbered them would silently repoint every one.
    expect(blocks.map((block) => block.id)).toEqual([1, 2, 3])

    db.close()
  })

  it('keeps the times, the all-day flag and the colour exactly', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    const [call, holiday] = db.all<BlockRow>('SELECT * FROM calendar_blocks ORDER BY id')

    expect(call).toMatchObject({
      starts_at: '2026-08-17T10:00',
      ends_at: '2026-08-17T11:00',
      all_day: 0,
      colour: '#E5484D',
      reminder_minutes: 15
    })
    expect(holiday).toMatchObject({ all_day: 1, colour: '' })

    db.close()
  })

  it('types everything as a meeting rather than guessing', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    const types = db.all<BlockRow>('SELECT block_type FROM calendar_blocks')

    // Guessing 'focus' from anything would invent billable hours, and those
    // feed straight into the capacity figures the whole module is built on.
    expect(types.every((row) => row.block_type === 'meeting')).toBe(true)
    expect(
      db.all<BlockRow>('SELECT id FROM calendar_blocks WHERE billable = 1')
    ).toHaveLength(0)

    db.close()
  })

  it('moves provenance out of the type column and into source', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    const [call, , standup] = db.all<BlockRow>('SELECT * FROM calendar_blocks ORDER BY id')

    // `kind` was local | google | teams — where a row came from, not what it
    // is. That question now has its own column, and the answer survives.
    expect(call).toMatchObject({ source: 'local', source_uid: null })
    expect(standup).toMatchObject({ source: 'ics_subscription', source_uid: 'uid-from-google' })

    db.close()
  })

  it('gives every block a timezone', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    const zones = db.all<BlockRow>('SELECT timezone FROM calendar_blocks')

    // The old rows were wall time with no zone recorded. Europe/London is what
    // they were written in, and an empty zone would make a block's start
    // ambiguous the first time it is compared across a DST boundary.
    expect(zones.every((row) => row.timezone === 'Europe/London')).toBe(true)

    db.close()
  })

  it('leaves the old table behind', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    const tables = db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('events', 'calendar_blocks')`
    )

    expect(tables.map((row) => row.name)).toEqual(['calendar_blocks'])
    db.close()
  })

  it('seeds exactly one row of calendar settings, and will not take a second', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    expect(db.all('SELECT * FROM calendar_settings')).toHaveLength(1)

    // The CHECK on the primary key is what keeps "how this person works" a
    // single answer rather than a table somebody can accidentally append to.
    expect(() =>
      db.run(`INSERT INTO calendar_settings (id, updated_at) VALUES (2, datetime('now'))`)
    ).toThrow()

    db.close()
  })

  it('starts a timeline for a block, like every other entity', () => {
    const path = file()
    seedOldCalendar(path)

    const db = new Database(path)
    db.run(
      `INSERT INTO calendar_blocks (title, starts_at, ends_at, created_at, updated_at)
       VALUES ('Deep work', '2026-08-19T09:00', '2026-08-19T12:00',
               datetime('now'), datetime('now'))`
    )

    const entries = db.all<{ action: string; detail: string }>(
      `SELECT action, detail FROM activity WHERE entity_type = 'block'`
    )
    expect(entries).toEqual([{ action: 'created', detail: 'Deep work' }])

    // Migrated rows deliberately have no 'created' entry: the trigger did not
    // exist when they were written, and inventing one would claim they were
    // made the moment the app updated.
    db.close()
  })
})

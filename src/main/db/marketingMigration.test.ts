import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database, type Row } from './index'
import { migrations } from './migrations'

/**
 * Migration 30, which corrects Marketing and moves the pipeline to Clients.
 *
 * On disk rather than in memory, and through two separate opens, because that
 * is the only way to exercise what happens to somebody's workspace: an
 * in-memory database is created at the newest schema and never migrates
 * anything at all.
 *
 * **The reason this file exists.** Giving `clients` the five-stage vocabulary
 * meant widening a CHECK constraint, and widening one in SQLite means
 * rebuilding the table. Rebuilding `clients` with foreign keys enforced runs
 * an implicit delete against every child row — projects, invoices, quotes and
 * time entries all have `ON DELETE SET NULL` — so it succeeds without an
 * error and quietly severs every link in the workspace. It was tried in a
 * scratch database first and did exactly that. The migration uses ADD COLUMN
 * and DROP COLUMN instead, and these tests are what hold it to that.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'solo-mktmig-'))
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

/** The schema version immediately before Marketing was corrected. */
const BEFORE = 29

function seed(file: string): void {
  const db = openAt(file, BEFORE)

  /*
   * Seeded at schema 29, where the column really is `status` with the old
   * four-value vocabulary. That is the whole point of this file: these are the
   * rows a workspace held the moment before migration 30 ran.
   */

  db.run(
    `INSERT INTO clients (name, folder, status, created_at, updated_at)
     VALUES ('Northgate Studio', 'Clients\\northgate', 'active', datetime('now'), datetime('now'))`
  )
  db.run(
    `INSERT INTO clients (name, folder, status, created_at, updated_at)
     VALUES ('Halden Ltd', 'Clients\\halden', 'interested', datetime('now'), datetime('now'))`
  )
  db.run(
    `INSERT INTO clients (name, folder, status, created_at, updated_at)
     VALUES ('Old Work', 'Clients\\old', 'past', datetime('now'), datetime('now'))`
  )
  db.run(
    `INSERT INTO clients (name, folder, status, created_at, updated_at)
     VALUES ('Went Cold', 'Clients\\cold', 'not_interested', datetime('now'), datetime('now'))`
  )

  // The children whose links the rebuild would have severed.
  db.run(
    `INSERT INTO projects (name, client_id, folder, created_at, updated_at)
     VALUES ('Rebrand', 1, 'Clients\\northgate\\rebrand', datetime('now'), datetime('now'))`
  )
  db.run(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, created_at, updated_at)
     VALUES ('INV-001', 1, 'sent', '2026-08-01', '2026-08-31', datetime('now'), datetime('now'))`
  )

  db.close()
}

describe('what migration 30 must not lose', () => {
  it('keeps every project attached to its client', () => {
    // The failure this whole file is about. A table rebuild returns success
    // and leaves client_id null on every row.
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    const project = db.get<Row & { client_id: number | null }>(
      "SELECT client_id FROM projects WHERE name = 'Rebrand'"
    )

    expect(project?.client_id).toBe(1)
    db.close()
  })

  it('keeps every invoice attached to its client', () => {
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    const invoice = db.get<Row & { client_id: number | null }>(
      "SELECT client_id FROM invoices WHERE number = 'INV-001'"
    )

    expect(invoice?.client_id).toBe(1)
    db.close()
  })

  it('keeps every client', () => {
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    expect(db.get<Row & { n: number }>('SELECT COUNT(*) AS n FROM clients')?.n).toBe(4)
    db.close()
  })
})

describe('the stage vocabulary', () => {
  function stages(file: string): Record<string, string> {
    const db = new Database(file)
    const rows = db.all<Row & { name: string; relationship_stage: string }>(
      'SELECT name, relationship_stage FROM clients'
    )
    db.close()

    return Object.fromEntries(rows.map((row) => [row.name, row.relationship_stage]))
  }

  it('carries each old status to its nearest new stage', () => {
    const file = join(dir, 'solo.db')
    seed(file)

    expect(stages(file)).toEqual({
      'Northgate Studio': 'active',
      'Halden Ltd': 'prospect',
      // Both of these become `former`. The distinction they carried — finished
      // versus never started — survives as whether there are invoices against
      // them, which is a truer test than a status set once and forgotten.
      'Old Work': 'former',
      'Went Cold': 'former'
    })
  })

  it('replaces the old column rather than sitting beside it', () => {
    // Two columns both meaning "where is this client up to" is two answers to
    // one question, and they drift.
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    const columns = db
      .all<Row & { name: string }>("SELECT name FROM pragma_table_info('clients')")
      .map((row) => row.name)

    expect(columns).toContain('relationship_stage')
    expect(columns).not.toContain('status')
    db.close()
  })

  it('still refuses a stage that is not one of the five', () => {
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    expect(() =>
      db.run("UPDATE clients SET relationship_stage = 'nonsense' WHERE id = 1")
    ).toThrow()
    db.close()
  })
})

describe('what it adds', () => {
  it('gives a client somewhere to record where they came from', () => {
    // The whole of attribution, with no tracking infrastructure: the user says
    // where somebody came from when they add them.
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    const columns = db
      .all<Row & { name: string }>("SELECT name FROM pragma_table_info('clients')")
      .map((row) => row.name)

    expect(columns).toContain('source_campaign_id')
    expect(columns).toContain('source_channel_id')
    db.close()
  })

  it('starts the marketing plan with its single row already there', () => {
    // A single-row table nobody inserted into reads as an empty module rather
    // than an unwritten one.
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    expect(db.get<Row & { n: number }>('SELECT COUNT(*) AS n FROM marketing_plan')?.n).toBe(1)
    db.close()
  })

  it('leaves the leads where they are, for the code that converts them', () => {
    // The migration is schema only. Converting a lead into a client creates a
    // folder on disk first, so no row can point at a directory that does not
    // exist — and SQL cannot make a directory.
    const file = join(dir, 'solo.db')
    seed(file)

    const db = new Database(file)
    expect(() => db.get('SELECT COUNT(*) FROM leads')).not.toThrow()
    db.close()
  })
})

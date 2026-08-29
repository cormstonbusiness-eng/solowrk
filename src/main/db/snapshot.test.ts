import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from './index'
import { migrations } from './migrations'

/**
 * The copy taken before the database changes shape.
 *
 * Each migration runs in a transaction, so one that throws rolls itself back.
 * This is about the other case: one that succeeds and is wrong. A table rebuild
 * that has already committed cannot be undone, and the rolling daily backup is
 * no help because it runs after the database is opened — so after migrations —
 * and only once a day.
 */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'solo-snapshot-'))
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

describe('before migrating', () => {
  it('takes no copy of a database that has never been migrated', () => {
    // A brand-new workspace has nothing to lose, and a file full of empty
    // tables is only litter.
    const file = join(dir, 'solo.db')
    new Database(file).close()

    expect(readdirSync(dir).filter((name) => name.includes('before-v'))).toEqual([])
  })

  it('copies the database aside when there is a new migration to run', () => {
    const file = join(dir, 'solo.db')

    // Open at an older schema, put something in it, then open at the newest.
    const old = openAt(file, 15)
    old.run(
      `INSERT INTO clients (name, contact_name, folder, status, created_at, updated_at)
     VALUES ('Acme Ltd', 'Dana', 'Clients/Acme', 'active', datetime('now'), datetime('now'))`
    )
    old.close()

    new Database(file).close()

    expect(existsSync(join(dir, 'solo.before-v15.db'))).toBe(true)
  })

  it('copies the work, not an empty shell', () => {
    // The WAL trap: recent writes sit in the -wal file, so copying solo.db
    // without checkpointing first can silently miss the last session.
    const file = join(dir, 'solo.db')

    const old = openAt(file, 15)
    old.run(
      `INSERT INTO clients (name, contact_name, folder, status, created_at, updated_at)
     VALUES ('Findable Ltd', 'Dana', 'Clients/F', 'active', datetime('now'), datetime('now'))`
    )
    old.close()

    new Database(file).close()

    const copy = readFileSync(join(dir, 'solo.before-v15.db')).toString('latin1')
    expect(copy).toContain('Findable Ltd')
  })

  it('names the copy after the version it is leaving', () => {
    // So somebody looking at a folder of them can tell which is which.
    const file = join(dir, 'solo.db')
    openAt(file, 14).close()
    openAt(file, 16).close()
    new Database(file).close()

    const copies = readdirSync(dir).filter((name) => name.includes('before-v'))
    expect(copies).toContain('solo.before-v14.db')
    expect(copies).toContain('solo.before-v16.db')
  })

  it('takes no second copy when there is nothing to migrate', () => {
    const file = join(dir, 'solo.db')
    openAt(file, 15).close()
    new Database(file).close()

    const before = readdirSync(dir)
    new Database(file).close()

    expect(readdirSync(dir)).toEqual(before)
  })

  it('leaves an in-memory database alone', () => {
    // Used by every other test in the suite; it must not try to copy a file
    // that does not exist.
    expect(() => new Database(':memory:').close()).not.toThrow()
  })
})

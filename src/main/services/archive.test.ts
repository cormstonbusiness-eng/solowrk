import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { isArchived, setArchived } from './archive'
import { canArchive } from '@shared/types'

/**
 * Filing something away.
 *
 * One function over five tables, so the thing worth checking is that it really
 * does reach all five — and that it refuses the two it should, rather than
 * writing to a column that is not there.
 */

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

function id(): number {
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function client(): number {
  db.run(
    `INSERT INTO clients (name, contact_name, folder, relationship_stage, created_at, updated_at)
     VALUES ('Acme Ltd', 'Dana', 'Clients/Acme', 'active', datetime('now'), datetime('now'))`
  )
  return id()
}

function project(): number {
  db.run(
    `INSERT INTO projects (client_id, name, status, colour, folder, created_at, updated_at)
     VALUES (NULL, 'Rebrand', 'active', '#FF7A2F', 'Clients/Acme/Rebrand', datetime('now'), datetime('now'))`
  )
  return id()
}

function task(): number {
  db.run(
    `INSERT INTO tasks (project_id, title, status, created_at, updated_at)
     VALUES (NULL, 'Draw the logo', 'todo', datetime('now'), datetime('now'))`
  )
  return id()
}

function note(): number {
  db.run(
    `INSERT INTO notes (project_id, title, file, created_at, updated_at)
     VALUES (NULL, 'Kickoff', 'Notes/Kickoff.md', datetime('now'), datetime('now'))`
  )
  return id()
}

function document(): number {
  db.run(
    `INSERT INTO documents (title, file, created_at, updated_at)
     VALUES ('Insurance', 'Documents/Insurance.pdf', datetime('now'), datetime('now'))`
  )
  return id()
}

describe('every list that can be filed away', () => {
  const makers = {
    client,
    project,
    task,
    note,
    document
  } as const

  for (const [type, make] of Object.entries(makers)) {
    it(`archives and restores a ${type}`, () => {
      const ref = { type: type as keyof typeof makers, id: make() }

      setArchived(db, ref, true)
      expect(isArchived(db, ref)).toBe(true)

      setArchived(db, ref, false)
      expect(isArchived(db, ref)).toBe(false)
    })
  }

  it('records when, and forgets when it comes back', () => {
    // Written from the flag rather than trusted, so "when was this filed away"
    // cannot drift from "is this filed away".
    const ref = { type: 'client' as const, id: client() }

    setArchived(db, ref, true)
    expect(
      db.get<{ archived_at: string | null }>('SELECT archived_at FROM clients WHERE id = ?', [
        ref.id
      ])!.archived_at
    ).not.toBeNull()

    setArchived(db, ref, false)
    expect(
      db.get<{ archived_at: string | null }>('SELECT archived_at FROM clients WHERE id = ?', [
        ref.id
      ])!.archived_at
    ).toBeNull()
  })
})

describe('the two that are left out', () => {
  it('refuses an invoice', () => {
    // An invoice already has a status saying where it is. A second axis for
    // "put this away" would mean two answers to where an invoice went.
    expect(canArchive('invoice')).toBe(false)
    expect(() => setArchived(db, { type: 'invoice', id: 1 }, true)).toThrow(/cannot be archived/)
  })

  it('refuses a quote', () => {
    expect(canArchive('quote')).toBe(false)
  })

  it('says nothing is archived for a type that cannot be', () => {
    expect(isArchived(db, { type: 'invoice', id: 1 })).toBe(false)
  })
})

describe('when it has gone', () => {
  it('says so rather than silently doing nothing', () => {
    expect(() => setArchived(db, { type: 'client', id: 404 }, true)).toThrow(/has gone/)
  })
})

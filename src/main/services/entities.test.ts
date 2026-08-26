import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { findAcrossTypes, findEntities, labelFor } from './entities'

/**
 * Looking a row up by type and id.
 *
 * Small on purpose. The reason it is tested at all is that it builds SQL from
 * a registry, and a picker that silently returns nothing is indistinguishable
 * from a workspace that is empty.
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

function client(name: string): number {
  db.run(
    `INSERT INTO clients (name, contact_name, folder, status, created_at, updated_at)
     VALUES (?, 'Dana', ?, 'active', datetime('now'), datetime('now'))`,
    [name, `Clients\\${name}`]
  )
  return id()
}

function project(name: string): number {
  db.run(
    `INSERT INTO projects (client_id, name, status, colour, folder, created_at, updated_at)
     VALUES (NULL, ?, 'active', '#FF7A2F', ?, datetime('now'), datetime('now'))`,
    [name, `Clients\\X\\${name}`]
  )
  return id()
}

describe('what a row is called', () => {
  it('finds the name', () => {
    expect(labelFor(db, { type: 'client', id: client('Acme Ltd') })).toBe('Acme Ltd')
  })

  it('says so when it has gone', () => {
    // The drawer opens on a ref out of the URL, which can name something
    // deleted since the link was made.
    expect(labelFor(db, { type: 'client', id: 404 })).toBeNull()
  })
})

describe('finding something to link to', () => {
  it('matches anywhere in the name, not just the start', () => {
    // Somebody looking for the Acme rebrand types "rebrand", not "Acme".
    project('Acme rebrand')

    expect(findEntities(db, 'project', 'rebrand').map((row) => row.label)).toEqual(['Acme rebrand'])
  })

  it('shows something to pick before anything is typed', () => {
    client('Acme Ltd')
    client('Beta Ltd')

    expect(findEntities(db, 'client', '')).toHaveLength(2)
  })

  it('puts the newest first', () => {
    client('Older')
    client('Newer')

    expect(findEntities(db, 'client', '').map((row) => row.label)).toEqual(['Newer', 'Older'])
  })

  it('treats a wildcard character as a character', () => {
    // A client genuinely called "50% Design" must not make every row match.
    client('50% Design')
    client('Acme Ltd')

    expect(findEntities(db, 'client', '%').map((row) => row.label)).toEqual(['50% Design'])
  })

  it('stops at the limit', () => {
    for (let n = 0; n < 30; n += 1) client(`Client ${n}`)

    expect(findEntities(db, 'client', '')).toHaveLength(20)
  })

  it('searches every type when the picker has not been narrowed', () => {
    client('Acme Ltd')
    project('Acme rebrand')

    const found = findAcrossTypes(db, 'Acme')
    expect(found.map((row) => row.type).sort()).toEqual(['client', 'project'])
  })
})

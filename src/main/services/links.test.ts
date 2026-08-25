import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { link, pruneLinks, relatedTo, unlink } from './links'
import type { BacklinkGroup, EntityType } from '@shared/types'

/**
 * Connections.
 *
 * The thing worth testing hardest is that the two sources come back as one
 * answer: a client's projects arrive by foreign key, a note somebody attached
 * to that client arrives from the links table, and the caller drawing the
 * panel should not be able to tell which was which except by asking.
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

function client(name = 'Acme Ltd'): number {
  db.run(
    `INSERT INTO clients (name, contact_name, folder, status, created_at, updated_at)
     VALUES (?, 'Dana', ?, 'active', datetime('now'), datetime('now'))`,
    [name, `Clients\\${name}`]
  )
  return id()
}

function project(clientId: number | null, name: string): number {
  db.run(
    `INSERT INTO projects (client_id, name, status, colour, folder, created_at, updated_at)
     VALUES (?, ?, 'active', '#FF7A2F', ?, datetime('now'), datetime('now'))`,
    [clientId, name, `Clients\\Acme\\${name}`]
  )
  return id()
}

function task(projectId: number | null, title: string): number {
  db.run(
    `INSERT INTO tasks (project_id, title, status, created_at, updated_at)
     VALUES (?, ?, 'todo', datetime('now'), datetime('now'))`,
    [projectId, title]
  )
  return id()
}

function note(projectId: number | null, title: string): number {
  db.run(
    `INSERT INTO notes (project_id, title, file, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [projectId, title, `Notes\\${title}.md`]
  )
  return id()
}

function invoice(clientId: number | null, number: string, projectId: number | null = null): number {
  db.run(
    `INSERT INTO invoices (number, client_id, project_id, status, issue_date, due_date, gross, created_at, updated_at)
     VALUES (?, ?, ?, 'sent', '2026-06-01', '2026-06-15', 120000, datetime('now'), datetime('now'))`,
    [number, clientId, projectId]
  )
  return id()
}

function document(clientId: number | null, title: string): number {
  db.run(
    `INSERT INTO documents (title, file, client_id, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [title, `Documents\\${title}.pdf`, clientId]
  )
  return id()
}

function group(groups: BacklinkGroup[], type: EntityType): BacklinkGroup | undefined {
  return groups.find((one) => one.type === type)
}

function labels(groups: BacklinkGroup[], type: EntityType): string[] {
  return (group(groups, type)?.items ?? []).map((item) => item.label).sort()
}

describe('keys and links come back as one answer', () => {
  it('finds what a foreign key already connects', () => {
    const acme = client()
    project(acme, 'Rebrand')
    project(acme, 'Website')

    expect(labels(relatedTo(db, { type: 'client', id: acme }), 'project')).toEqual([
      'Rebrand',
      'Website'
    ])
  })

  it('finds the parent from the child as well as the child from the parent', () => {
    const acme = client()
    const rebrand = project(acme, 'Rebrand')

    const up = relatedTo(db, { type: 'project', id: rebrand })
    expect(labels(up, 'client')).toEqual(['Acme Ltd'])
  })

  it('finds a hand-made link the keys do not express', () => {
    const acme = client()
    const orphan = note(null, 'Kickoff call')

    link(db, { type: 'client', id: acme }, { type: 'note', id: orphan })

    expect(labels(relatedTo(db, { type: 'client', id: acme }), 'note')).toEqual(['Kickoff call'])
    expect(labels(relatedTo(db, { type: 'note', id: orphan }), 'client')).toEqual(['Acme Ltd'])
  })

  it('says which connections are structural', () => {
    const acme = client()
    project(acme, 'Rebrand')
    const orphan = note(null, 'Kickoff call')
    link(db, { type: 'client', id: acme }, { type: 'note', id: orphan })

    const groups = relatedTo(db, { type: 'client', id: acme })
    expect(group(groups, 'project')!.items[0]!.structural).toBe(true)
    expect(group(groups, 'note')!.items[0]!.structural).toBe(false)
  })

  it('names the relationship rather than calling everything related', () => {
    const acme = client()
    invoice(acme, 'INV-001')

    const groups = relatedTo(db, { type: 'client', id: acme })
    expect(group(groups, 'invoice')!.items[0]!.relationship).toBe('billed to')
  })

  it('gives a draft invoice a usable name', () => {
    const acme = client()
    invoice(acme, '')

    expect(labels(relatedTo(db, { type: 'client', id: acme }), 'invoice')).toEqual(['Draft invoice'])
  })
})

describe('a link has no direction', () => {
  it('is the same fact from either end', () => {
    const acme = client()
    const doc = document(null, 'Signed contract')

    link(db, { type: 'document', id: doc }, { type: 'client', id: acme })
    link(db, { type: 'client', id: acme }, { type: 'document', id: doc })

    // Two calls, one row — otherwise the panel shows the same document twice.
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM links')!.n).toBe(1)
  })

  it('unlinks from either end', () => {
    const acme = client()
    const doc = document(null, 'Signed contract')
    link(db, { type: 'client', id: acme }, { type: 'document', id: doc })

    unlink(db, { type: 'document', id: doc }, { type: 'client', id: acme })

    expect(relatedTo(db, { type: 'client', id: acme })).toEqual([])
  })

  it('refuses to link a thing to itself', () => {
    const acme = client()
    expect(() => link(db, { type: 'client', id: acme }, { type: 'client', id: acme })).toThrow()
  })

  it('refuses to link something that does not exist', () => {
    const acme = client()
    expect(() => link(db, { type: 'client', id: acme }, { type: 'note', id: 999 })).toThrow(
      /no longer exists/
    )
  })
})

describe('a client sees the work under their projects', () => {
  it('reaches tasks and notes through the project', () => {
    // §1.1 asks for notes on a client record, and notes only key to a project.
    const acme = client()
    const rebrand = project(acme, 'Rebrand')
    task(rebrand, 'Draw the logo')
    note(rebrand, 'Brand guidelines')

    const groups = relatedTo(db, { type: 'client', id: acme })
    expect(labels(groups, 'task')).toEqual(['Draw the logo'])
    expect(labels(groups, 'note')).toEqual(['Brand guidelines'])
  })

  it('does not follow the hop backwards', () => {
    // A task reaches its client through its project. Listing the client
    // directly as well would put it in the panel twice.
    const acme = client()
    const rebrand = project(acme, 'Rebrand')
    const draw = task(rebrand, 'Draw the logo')

    const groups = relatedTo(db, { type: 'task', id: draw })
    expect(labels(groups, 'project')).toEqual(['Rebrand'])
    expect(group(groups, 'client')).toBeUndefined()
  })

  it('does not count another client’s work', () => {
    const acme = client('Acme Ltd')
    const other = client('Beta Ltd')
    project(acme, 'Rebrand')
    const theirs = project(other, 'Their thing')
    task(theirs, 'Not mine')

    expect(labels(relatedTo(db, { type: 'client', id: acme }), 'task')).toEqual([])
  })
})

describe('the same row twice', () => {
  it('keeps the key rather than the hand-made link', () => {
    // Somebody links an invoice to the client it is already billed to. That is
    // one connection, and the key is the one that means something.
    const acme = client()
    const inv = invoice(acme, 'INV-001')
    link(db, { type: 'client', id: acme }, { type: 'invoice', id: inv })

    const groups = relatedTo(db, { type: 'client', id: acme })
    expect(group(groups, 'invoice')!.count).toBe(1)
    expect(group(groups, 'invoice')!.items[0]!.relationship).toBe('billed to')
  })

  it('does not list a project under both its keys twice', () => {
    const acme = client()
    const rebrand = project(acme, 'Rebrand')
    invoice(acme, 'INV-001', rebrand)

    // The invoice keys to both the client and the project, so asking the
    // client must not return it once per key.
    expect(group(relatedTo(db, { type: 'client', id: acme }), 'invoice')!.count).toBe(1)
  })
})

describe('counts stay honest when there is a lot', () => {
  it('caps what it returns and reports the real total', () => {
    const acme = client()
    for (let n = 0; n < 60; n += 1) invoice(acme, `INV-${n}`)

    const invoices = group(relatedTo(db, { type: 'client', id: acme }), 'invoice')!
    expect(invoices.items).toHaveLength(50)
    expect(invoices.count).toBe(60)
  })
})

describe('when the other end is deleted', () => {
  it('stops showing it immediately', () => {
    // No foreign key can cascade from a polymorphic table, so the row is still
    // there — but nothing should render a link to something that has gone.
    const acme = client()
    const doc = document(null, 'Signed contract')
    link(db, { type: 'client', id: acme }, { type: 'document', id: doc })

    db.run('DELETE FROM documents WHERE id = ?', [doc])

    expect(relatedTo(db, { type: 'client', id: acme })).toEqual([])
  })

  it('sweeps the row away', () => {
    const acme = client()
    const doc = document(null, 'Signed contract')
    link(db, { type: 'client', id: acme }, { type: 'document', id: doc })
    db.run('DELETE FROM documents WHERE id = ?', [doc])

    expect(pruneLinks(db)).toBe(1)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM links')!.n).toBe(0)
  })

  it('leaves live links alone', () => {
    const acme = client()
    const doc = document(null, 'Signed contract')
    link(db, { type: 'client', id: acme }, { type: 'document', id: doc })

    expect(pruneLinks(db)).toBe(0)
  })

  it('leaves a type it does not recognise alone', () => {
    // A newer version sharing the same workspace — Dropbox, two machines —
    // must not have its links deleted by an older build that has never heard
    // of the type.
    const acme = client()
    db.run(
      `INSERT INTO links (source_type, source_id, target_type, target_id, relationship, created_at)
       VALUES ('client', ?, 'event', 4, 'related', datetime('now'))`,
      [acme]
    )

    expect(pruneLinks(db)).toBe(0)
    // And it is quietly skipped rather than rendered as a broken row.
    expect(relatedTo(db, { type: 'client', id: acme })).toEqual([])
  })
})

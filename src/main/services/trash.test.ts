import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import {
  emptyTrash,
  expireTrash,
  listTrash,
  purgeTrash,
  restoreTrash,
  trashEntity
} from './trash'
import { activityFor } from './activity'
import { link, relatedTo } from './links'

/**
 * Deleting without losing.
 *
 * The row is genuinely removed, so everything worth testing is about what was
 * captured on the way out. Three things go wrong if the capture is incomplete
 * and none of them is visible at the time: a restored project comes back with
 * no tasks, a restored client comes back with none of their projects attached,
 * or a restored anything comes back with its history missing.
 *
 * The dependency walk reads `PRAGMA foreign_key_list`, so these tests are also
 * the check that the schema and the walk still agree.
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
    `INSERT INTO clients (name, contact_name, folder, relationship_stage, created_at, updated_at)
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

function note(projectId: number, title: string): number {
  db.run(
    `INSERT INTO notes (project_id, title, file, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [projectId, title, `Notes\\${title}.md`]
  )
  return id()
}

function invoice(clientId: number | null, number: string): number {
  db.run(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, gross, created_at, updated_at)
     VALUES (?, ?, 'sent', '2026-06-01', '2026-06-15', 120000, datetime('now'), datetime('now'))`,
    [number, clientId]
  )
  return id()
}

function line(invoiceId: number, description: string): number {
  db.run(
    `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, sort_order)
     VALUES (?, ?, 1, 10000, 0)`,
    [invoiceId, description]
  )
  return id()
}

function count(table: string): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n
}

describe('the row really goes', () => {
  it('is gone from its own table', () => {
    // Not hidden. Every query in the app stays honest without knowing this
    // feature exists.
    const acme = client()
    trashEntity(db, { type: 'client', id: acme })

    expect(count('clients')).toBe(0)
  })

  it('appears in the trash under the name it had', () => {
    trashEntity(db, { type: 'client', id: client('Acme Ltd') })

    expect(listTrash(db)[0]).toMatchObject({ entityType: 'client', label: 'Acme Ltd' })
  })

  it('refuses to trash something that has already gone', () => {
    expect(() => trashEntity(db, { type: 'client', id: 404 })).toThrow(/already gone/)
  })
})

describe('what a delete takes with it', () => {
  it('captures the cascade and puts it back', () => {
    const rebrand = project(null, 'Rebrand')
    task(rebrand, 'Draw the logo')
    task(rebrand, 'Pick a font')
    note(rebrand, 'Brand guidelines')

    const entry = trashEntity(db, { type: 'project', id: rebrand })
    expect(count('tasks')).toBe(0)
    expect(count('notes')).toBe(0)

    restoreTrash(db, entry.id)

    expect(count('tasks')).toBe(2)
    expect(count('notes')).toBe(1)
  })

  it('captures a cascade several levels deep', () => {
    // Subtasks hang off tasks, which hang off the project.
    const rebrand = project(null, 'Rebrand')
    const parent = task(rebrand, 'Draw the logo')
    db.run(
      `INSERT INTO tasks (project_id, parent_id, title, status, created_at, updated_at)
       VALUES (?, ?, 'Sketch it', 'todo', datetime('now'), datetime('now'))`,
      [rebrand, parent]
    )

    const entry = trashEntity(db, { type: 'project', id: rebrand })
    restoreTrash(db, entry.id)

    expect(count('tasks')).toBe(2)
    expect(db.get<{ parent_id: number }>('SELECT parent_id FROM tasks WHERE title = ?', ['Sketch it'])!.parent_id).toBe(parent)
  })

  it('reattaches what was only cut loose, not taken', () => {
    // A project's client_id is ON DELETE SET NULL, so deleting a client leaves
    // the projects behind with nothing pointing back. A restore that did not
    // notice would return a client with no work against their name.
    const acme = client()
    const rebrand = project(acme, 'Rebrand')

    const entry = trashEntity(db, { type: 'client', id: acme })
    expect(count('projects')).toBe(1)
    expect(
      db.get<{ client_id: number | null }>('SELECT client_id FROM projects WHERE id = ?', [rebrand])!
        .client_id
    ).toBeNull()

    restoreTrash(db, entry.id)

    expect(
      db.get<{ client_id: number | null }>('SELECT client_id FROM projects WHERE id = ?', [rebrand])!
        .client_id
    ).toBe(acme)
  })

  it('brings back an invoice with its lines', () => {
    const inv = invoice(client(), 'INV-001')
    line(inv, 'Design work')
    line(inv, 'Expenses')

    const entry = trashEntity(db, { type: 'invoice', id: inv })
    expect(count('invoice_lines')).toBe(0)

    restoreTrash(db, entry.id)
    expect(count('invoice_lines')).toBe(2)
  })

  it('says what else is going', () => {
    const rebrand = project(null, 'Rebrand')
    task(rebrand, 'One')
    task(rebrand, 'Two')
    note(rebrand, 'Notes')

    const entry = trashEntity(db, { type: 'project', id: rebrand })
    expect(entry.summary).toContain('2 tasks')
    expect(entry.summary).toContain('1 note')
  })
})

describe('the connections and the history', () => {
  it('brings back links no foreign key covers', () => {
    const acme = client()
    const rebrand = project(null, 'Rebrand')
    link(db, { type: 'client', id: acme }, { type: 'project', id: rebrand })

    const entry = trashEntity(db, { type: 'client', id: acme })
    restoreTrash(db, entry.id)

    expect(relatedTo(db, { type: 'client', id: acme })[0]!.items[0]!.label).toBe('Rebrand')
  })

  it('brings back the timeline', () => {
    const acme = client('Acme Ltd')
    const before = activityFor(db, { type: 'client', id: acme }).length
    expect(before).toBeGreaterThan(0)

    const entry = trashEntity(db, { type: 'client', id: acme })
    restoreTrash(db, entry.id)

    // The creation is still the creation. A restore is not a new beginning.
    expect(activityFor(db, { type: 'client', id: acme })[0]!.detail).toBe('Acme Ltd')
  })

  it('keeps the history of what came back with it', () => {
    const rebrand = project(null, 'Rebrand')
    const draw = task(rebrand, 'Draw the logo')

    const entry = trashEntity(db, { type: 'project', id: rebrand })
    restoreTrash(db, entry.id)

    expect(activityFor(db, { type: 'task', id: draw })).not.toHaveLength(0)
  })
})

describe('when the world has moved on', () => {
  it('comes back without a parent that has gone too, and says which', () => {
    // Delete a task, then its project. The task can still come back — as a
    // task with no project, which is recoverable. Refusing outright is not.
    const rebrand = project(null, 'Rebrand')
    const draw = task(rebrand, 'Draw the logo')

    const entry = trashEntity(db, { type: 'task', id: draw })
    db.run('DELETE FROM projects WHERE id = ?', [rebrand])

    const result = restoreTrash(db, entry.id)

    expect(result.orphaned).toContain('projects')
    expect(
      db.get<{ project_id: number | null }>('SELECT project_id FROM tasks WHERE id = ?', [draw])!
        .project_id
    ).toBeNull()
  })

  it('brings a note back as a standalone one', () => {
    // Every one of the eight types keys to its parent nullably — migration 12
    // rebuilt notes for exactly this, so a note can live in the notebook
    // rather than under a project. So a note whose project has gone comes back
    // as a note, which is the right answer and not a compromise.
    const rebrand = project(null, 'Rebrand')
    const brand = note(rebrand, 'Brand guidelines')

    const entry = trashEntity(db, { type: 'note', id: brand })
    db.run('DELETE FROM projects WHERE id = ?', [rebrand])

    const result = restoreTrash(db, entry.id)

    expect(result.orphaned).toContain('projects')
    expect(count('notes')).toBe(1)
  })

  it('refuses to restore something already restored', () => {
    const entry = trashEntity(db, { type: 'client', id: client() })
    restoreTrash(db, entry.id)

    expect(() => restoreTrash(db, entry.id)).toThrow(/no longer in the trash/)
  })
})

describe('emptying it', () => {
  it('takes one entry', () => {
    const first = trashEntity(db, { type: 'client', id: client('One') })
    trashEntity(db, { type: 'client', id: client('Two') })

    purgeTrash(db, first.id)

    expect(listTrash(db).map((entry) => entry.label)).toEqual(['Two'])
  })

  it('takes all of it, and says how many', () => {
    trashEntity(db, { type: 'client', id: client('One') })
    trashEntity(db, { type: 'client', id: client('Two') })

    expect(emptyTrash(db).count).toBe(2)
    expect(listTrash(db)).toEqual([])
  })

  it('hands back the note bodies to remove, and nothing else', () => {
    // A note's .md is scaffolding the app wrote. A document or a receipt is
    // the user's own file and stays on disk whatever the app does.
    const rebrand = project(null, 'Rebrand')
    note(rebrand, 'Brand guidelines')
    db.run(
      `INSERT INTO documents (title, file, created_at, updated_at)
       VALUES ('Insurance', 'Documents/Insurance.pdf', datetime('now'), datetime('now'))`
    )
    const doc = id()

    const noteEntry = trashEntity(db, { type: 'project', id: rebrand })
    const docEntry = trashEntity(db, { type: 'document', id: doc })

    const removed = purgeTrash(db, noteEntry.id)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('Brand guidelines.md')
    expect(purgeTrash(db, docEntry.id)).toEqual([])
  })

  it('lets go of what has been there long enough', () => {
    const entry = trashEntity(db, { type: 'client', id: client() })
    db.run(`UPDATE trash SET deleted_at = datetime('now', '-31 days') WHERE id = ?`, [entry.id])

    expect(expireTrash(db).count).toBe(1)
  })

  it('keeps what has not', () => {
    const entry = trashEntity(db, { type: 'client', id: client() })
    db.run(`UPDATE trash SET deleted_at = datetime('now', '-29 days') WHERE id = ?`, [entry.id])

    expect(expireTrash(db).count).toBe(0)
  })
})

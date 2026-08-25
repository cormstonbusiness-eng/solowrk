import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { createInvoice } from './invoices'
import { buildUpdatePack } from './updatePack'

/**
 * The client update pack.
 *
 * This one gets emailed to somebody else's client, which makes every mistake
 * here a mistake in front of the person paying the user's invoices. The two
 * that matter: never showing a draft invoice as owed, and never opening with
 * work that finished last spring as though it were news.
 */
const ASOF = '2026-08-25'

function addClient(db: Database, name: string): number {
  db.run(
    `INSERT INTO clients (name, contact_name, folder, status, created_at, updated_at)
     VALUES (?, 'Dana', ?, 'active', datetime('now'), datetime('now'))`,
    [name, `Clients\\${name}`]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function addProject(
  db: Database,
  clientId: number,
  name: string,
  status = 'active',
  updatedAt = ASOF
): number {
  db.run(
    `INSERT INTO projects (client_id, name, description, status, colour, folder, created_at, updated_at)
     VALUES (?, ?, '', ?, '#FF7A2F', ?, datetime('now'), ?)`,
    [clientId, name, status, `Clients\\x\\${name}`, `${updatedAt}T12:00:00`]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function addTask(
  db: Database,
  projectId: number,
  title: string,
  status: string,
  updatedAt = ASOF
): void {
  db.run(
    `INSERT INTO tasks (project_id, title, notes, status, sort_order, created_at, updated_at)
     VALUES (?, ?, '', ?, 0, datetime('now'), ?)`,
    [projectId, title, status, `${updatedAt}T12:00:00`]
  )
}

describe('the update pack', () => {
  let db: Database
  let client: number

  beforeEach(() => {
    db = new Database(':memory:')
    client = addClient(db, 'Acme Ltd')
  })

  afterEach(() => {
    db.close()
  })

  it('never shows a draft invoice as owed', () => {
    // The worst thing this document could do. A draft has never been sent, so
    // asking a client to pay it is asking for money they have no record of.
    createInvoice(db, {
      clientId: client,
      status: 'draft',
      issueDate: '2026-08-01',
      dueDate: '2026-08-15',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 500_00 }]
    })

    const pack = buildUpdatePack(db, client, { asOf: ASOF })
    expect(pack.outstanding).toEqual([])
    expect(pack.outstandingTotal).toBe(0)
  })

  it('shows what is genuinely outstanding, and flags what is late', () => {
    createInvoice(db, {
      clientId: client,
      status: 'sent',
      issueDate: '2026-07-01',
      dueDate: '2026-07-15',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 200_00 }]
    })
    createInvoice(db, {
      clientId: client,
      status: 'sent',
      issueDate: '2026-08-20',
      dueDate: '2026-09-20',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 300_00 }]
    })

    const pack = buildUpdatePack(db, client, { asOf: ASOF })

    expect(pack.outstandingTotal).toBe(500_00)
    // Oldest first, which is the order a conversation about them goes in.
    expect(pack.outstanding[0]!.overdue).toBe(true)
    expect(pack.outstanding[1]!.overdue).toBe(false)
  })

  it('leaves a paid invoice off entirely', () => {
    const paid = createInvoice(db, {
      clientId: client,
      status: 'paid',
      issueDate: '2026-07-01',
      dueDate: '2026-07-15',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 200_00 }]
    })
    db.run('UPDATE invoices SET paid_at = ? WHERE id = ?', ['2026-07-10', paid.id])

    expect(buildUpdatePack(db, client, { asOf: ASOF }).outstanding).toEqual([])
  })

  it('reports work done inside the window, not everything ever finished', () => {
    const project = addProject(db, client, 'Rebrand')
    addTask(db, project, 'Logo concepts', 'done', '2026-08-20')
    addTask(db, project, 'Ancient history', 'done', '2025-01-01')
    addTask(db, project, 'Style guide', 'todo')

    const [entry] = buildUpdatePack(db, client, { asOf: ASOF }).projects

    expect(entry!.completed).toEqual(['Logo concepts'])
    expect(entry!.next).toEqual(['Style guide'])
  })

  it('drops a project finished long ago, and keeps one just finished', () => {
    // "We finished this" is the best news on the page — but only while it is
    // news. A pack opening with last spring reads as padding.
    addProject(db, client, 'Old thing', 'completed', '2025-02-01')
    addProject(db, client, 'Just landed', 'completed', '2026-08-18')
    addProject(db, client, 'Live one', 'active')

    const names = buildUpdatePack(db, client, { asOf: ASOF }).projects.map((p) => p.name)

    expect(names).toContain('Just landed')
    expect(names).toContain('Live one')
    expect(names).not.toContain('Old thing')
  })

  it('leaves cancelled and archived projects out', () => {
    addProject(db, client, 'Cancelled', 'cancelled')
    const archived = addProject(db, client, 'Archived', 'active')
    db.run('UPDATE projects SET archived = 1 WHERE id = ?', [archived])

    expect(buildUpdatePack(db, client, { asOf: ASOF }).projects).toEqual([])
  })

  it('caps what is coming up, because a client does not need the backlog', () => {
    const project = addProject(db, client, 'Big one')
    for (let index = 0; index < 12; index += 1) addTask(db, project, `Task ${index}`, 'todo')

    expect(buildUpdatePack(db, client, { asOf: ASOF }).projects[0]!.next).toHaveLength(5)
  })

  it('is a perfectly good document with nothing in it', () => {
    // A brand-new client. It must not throw, and it must not claim anything.
    const pack = buildUpdatePack(db, client, { asOf: ASOF })

    expect(pack.projects).toEqual([])
    expect(pack.outstanding).toEqual([])
    expect(pack.hoursRecent).toBe(0)
    expect(pack.clientName).toBe('Acme Ltd')
  })
})

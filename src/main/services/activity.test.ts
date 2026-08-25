import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { activityFor, describeActivity, pruneActivity, recentActivity } from './activity'
import type { ActivityEntry } from '@shared/types'

/**
 * History.
 *
 * Nothing in `activity.ts` writes — the rows come from SQLite triggers, so
 * most of what follows is testing the migration rather than the service. That
 * is deliberate: triggers are the only way to cover every write path including
 * the assistant's tools and the automation actions, and the price of that is
 * that the behaviour has to be pinned here or nobody will ever see it.
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

function invoice(clientId: number, number: string): number {
  db.run(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, gross, created_at, updated_at)
     VALUES (?, ?, 'draft', '2026-06-01', '2026-06-15', 120000, datetime('now'), datetime('now'))`,
    [number, clientId]
  )
  return id()
}

/** Touch a row the way a service does, at a stated time. */
function touch(table: string, rowId: number, at: string): void {
  db.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, [at, rowId])
}

/** Move the last recorded edit back in time, to test the coalescing window. */
function backdateLastEdit(minutes: number): void {
  db.run(
    `UPDATE activity SET at = datetime('now', ?)
      WHERE id = (SELECT MAX(id) FROM activity WHERE action = 'edited')`,
    [`-${minutes} minutes`]
  )
}

describe('things record their own history', () => {
  it('records a creation, with the name it was given', () => {
    const acme = client()

    const history = activityFor(db, { type: 'client', id: acme })
    expect(history).toHaveLength(1)
    expect(history[0]!.action).toBe('created')
    expect(history[0]!.detail).toBe('Acme Ltd')
  })

  it('keeps the name as written, so a rename does not rewrite the past', () => {
    const acme = client('Acme Ltd')
    db.run(`UPDATE clients SET name = 'Acme Group' WHERE id = ?`, [acme])

    expect(activityFor(db, { type: 'client', id: acme })[0]!.detail).toBe('Acme Ltd')
  })

  it('records a status change with both ends of it', () => {
    const acme = client()
    const inv = invoice(acme, 'INV-001')
    db.run(`UPDATE invoices SET status = 'sent' WHERE id = ?`, [inv])

    const latest = activityFor(db, { type: 'invoice', id: inv })[0]!
    expect(latest.action).toBe('status')
    expect(latest.detail).toBe('draft to sent')
  })

  it('says nothing when a status is written but not changed', () => {
    const acme = client()
    const inv = invoice(acme, 'INV-001')
    db.run(`UPDATE invoices SET status = 'draft' WHERE id = ?`, [inv])

    expect(activityFor(db, { type: 'invoice', id: inv }).map((e) => e.action)).toEqual(['created'])
  })

  it('covers a write that never went through a service', () => {
    // The point of doing this with triggers: raw SQL from the assistant, an
    // automation or a future importer is recorded the same as anything else.
    db.run(
      `INSERT INTO clients (name, contact_name, folder, status, created_at, updated_at)
       VALUES ('Straight to SQL', '', 'Clients\\S', 'active', datetime('now'), datetime('now'))`
    )
    expect(recentActivity(db)[0]!.detail).toBe('Straight to SQL')
  })
})

describe('edits are a sitting, not a keystroke', () => {
  it('records the first edit', () => {
    const acme = client()
    touch('clients', acme, '2026-08-25 10:00:00')

    expect(activityFor(db, { type: 'client', id: acme }).map((e) => e.action)).toEqual([
      'edited',
      'created'
    ])
  })

  it('does not record a second edit ten minutes later', () => {
    // Note bodies save as you type. Recorded literally, an Activity panel is
    // four hundred identical lines and the three events worth seeing are gone.
    const acme = client()
    touch('clients', acme, '2026-08-25 10:00:00')
    touch('clients', acme, '2026-08-25 10:00:05')
    touch('clients', acme, '2026-08-25 10:00:11')

    const edits = activityFor(db, { type: 'client', id: acme }).filter((e) => e.action === 'edited')
    expect(edits).toHaveLength(1)
  })

  it('records the next sitting once the window has passed', () => {
    const acme = client()
    touch('clients', acme, '2026-08-25 10:00:00')
    backdateLastEdit(11)
    touch('clients', acme, '2026-08-25 14:00:00')

    const edits = activityFor(db, { type: 'client', id: acme }).filter((e) => e.action === 'edited')
    expect(edits).toHaveLength(2)
  })

  it('never coalesces a status change', () => {
    // Those are the timeline. Two moves in a minute are two things that
    // happened, however close together they were.
    const acme = client()
    const inv = invoice(acme, 'INV-001')
    db.run(`UPDATE invoices SET status = 'sent' WHERE id = ?`, [inv])
    db.run(`UPDATE invoices SET status = 'paid' WHERE id = ?`, [inv])

    const moves = activityFor(db, { type: 'invoice', id: inv }).filter((e) => e.action === 'status')
    expect(moves.map((e) => e.detail)).toEqual(['sent to paid', 'draft to sent'])
  })

  it('coalesces one thing without silencing another', () => {
    const one = client('One')
    const two = client('Two')
    touch('clients', one, '2026-08-25 10:00:00')
    touch('clients', two, '2026-08-25 10:00:01')

    expect(activityFor(db, { type: 'client', id: two }).map((e) => e.action)).toContain('edited')
  })
})

describe('reading it back', () => {
  it('puts the newest first, and breaks a tie by what happened last', () => {
    // Several rows share a second — creating a project writes the project and
    // its scaffolding in one transaction — and id is the only honest tiebreak.
    const acme = client()
    const inv = invoice(acme, 'INV-001')
    db.run(`UPDATE invoices SET status = 'sent' WHERE id = ?`, [inv])

    expect(activityFor(db, { type: 'invoice', id: inv }).map((e) => e.action)).toEqual([
      'status',
      'created'
    ])
  })

  it('keeps one thing’s history to itself', () => {
    const acme = client('Acme Ltd')
    client('Beta Ltd')

    const history = activityFor(db, { type: 'client', id: acme })
    expect(history.map((e) => e.detail)).toEqual(['Acme Ltd'])
  })

  it('reads the whole workspace for the weekly view', () => {
    client('Acme Ltd')
    client('Beta Ltd')

    expect(recentActivity(db)).toHaveLength(2)
  })

  it('writes a line a person can read', () => {
    const acme = client()
    const inv = invoice(acme, 'INV-001')
    db.run(`UPDATE invoices SET status = 'sent' WHERE id = ?`, [inv])

    const [latest, created] = activityFor(db, { type: 'invoice', id: inv }) as [
      ActivityEntry,
      ActivityEntry
    ]
    expect(describeActivity(latest)).toBe('Moved from draft to sent')
    expect(describeActivity(created)).toBe('Created invoice INV-001')
  })
})

describe('forgetting what no longer exists', () => {
  it('drops the history of a deleted thing', () => {
    const acme = client()
    db.run('DELETE FROM clients WHERE id = ?', [acme])

    expect(pruneActivity(db)).toBe(1)
    expect(recentActivity(db)).toEqual([])
  })

  it('takes the history of what the delete cascaded to as well', () => {
    const acme = client()
    invoice(acme, 'INV-001')
    db.run('DELETE FROM clients WHERE id = ?', [acme])

    // The invoice keys to the client with ON DELETE SET NULL, so it survives —
    // and so must its history.
    expect(pruneActivity(db)).toBe(1)
    expect(recentActivity(db).map((e) => e.entityType)).toEqual(['invoice'])
  })

  it('leaves living things alone', () => {
    client()
    expect(pruneActivity(db)).toBe(0)
  })
})

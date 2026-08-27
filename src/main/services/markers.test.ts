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
const { createProject, updateProject } = await import('./projects')
const { createTask, updateTask } = await import('./tasks')
const { derivedMarkers } = await import('./scheduling')

/**
 * The dates the calendar shows but does not own.
 *
 * The point of every test here is the same one: none of this is a row in
 * `calendar_blocks`, so changing the record changes the calendar and there is
 * no second copy to go stale.
 */
describe('derived markers', () => {
  let db: InstanceType<typeof Database>
  let root: string

  const august = { from: '2026-08-01', to: '2026-08-31' }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-markers-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('shows a project deadline without copying it anywhere', async () => {
    const project = await createProject(db, root, { name: 'Rebrand', dueOn: '2026-08-20' })

    expect(derivedMarkers(db, august)).toEqual([
      expect.objectContaining({ kind: 'project', id: project.id, day: '2026-08-20', label: 'Rebrand' })
    ])

    // Move the deadline on the project and the calendar moves with it, because
    // the calendar was never holding a copy of it.
    await updateProject(db, root, project.id, { dueOn: '2026-08-25' })
    expect(derivedMarkers(db, august)[0]?.day).toBe('2026-08-25')

    // And nothing was ever written to the calendar.
    expect(db.all('SELECT id FROM calendar_blocks')).toHaveLength(0)
  })

  it('leaves out a project that is finished', async () => {
    const project = await createProject(db, root, { name: 'Rebrand', dueOn: '2026-08-20' })
    await updateProject(db, root, project.id, { status: 'completed' })

    expect(derivedMarkers(db, august)).toEqual([])
  })

  it('shows milestones, which are dates rather than work', async () => {
    const project = await createProject(db, root, { name: 'Rebrand' })
    db.run(
      `INSERT INTO project_milestones (project_id, title, due_on, created_at, updated_at)
       VALUES (?, 'Design sign-off', '2026-08-14', datetime('now'), datetime('now'))`,
      [project.id]
    )

    expect(derivedMarkers(db, august)).toEqual([
      expect.objectContaining({ kind: 'milestone', label: 'Design sign-off', detail: 'Rebrand' })
    ])
  })

  it('drops a milestone once it has been reached', async () => {
    const project = await createProject(db, root, { name: 'Rebrand' })
    db.run(
      `INSERT INTO project_milestones (project_id, title, due_on, reached_at, created_at, updated_at)
       VALUES (?, 'Design sign-off', '2026-08-14', datetime('now'), datetime('now'), datetime('now'))`,
      [project.id]
    )

    expect(derivedMarkers(db, august)).toEqual([])
  })

  it('shows a task deadline, and stops once the task is done', () => {
    const task = createTask(db, { title: 'Send the deck', dueAt: '2026-08-12' })
    expect(derivedMarkers(db, august).map((one) => one.label)).toEqual(['Send the deck'])

    updateTask(db, task.id, { status: 'done' })
    expect(derivedMarkers(db, august)).toEqual([])
  })

  it('shows an invoice falling due, with what it is worth', () => {
    db.run(
      `INSERT INTO invoices (client_id, number, status, issue_date, due_date, gross,
                             created_at, updated_at)
       VALUES (NULL, 'INV-0042', 'sent', '2026-08-01', '2026-08-15', 120000,
               datetime('now'), datetime('now'))`
    )

    expect(derivedMarkers(db, august)).toEqual([
      expect.objectContaining({ kind: 'invoice', label: 'INV-0042', detail: '£1,200 due' })
    ])
  })

  it('leaves out an invoice nobody has sent', () => {
    db.run(
      `INSERT INTO invoices (client_id, number, status, issue_date, due_date, gross,
                             created_at, updated_at)
       VALUES (NULL, 'INV-0043', 'draft', '2026-08-01', '2026-08-15', 120000,
               datetime('now'), datetime('now'))`
    )

    // A draft is not owed. Putting one on the calendar as money coming in
    // would be the app telling you about a decision you have not made.
    expect(derivedMarkers(db, august)).toEqual([])
  })

  it('stays inside the range it was asked for', async () => {
    await createProject(db, root, { name: 'September thing', dueOn: '2026-09-05' })
    expect(derivedMarkers(db, august)).toEqual([])
  })

  it('comes back in date order', async () => {
    await createProject(db, root, { name: 'Late', dueOn: '2026-08-28' })
    createTask(db, { title: 'Early', dueAt: '2026-08-03' })

    expect(derivedMarkers(db, august).map((one) => one.label)).toEqual(['Early', 'Late'])
  })
})

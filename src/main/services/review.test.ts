import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createInvoice, updateInvoice } = await import('./invoices')
const { fileWeeklyReview, mondayOf, reviewFacts, weeklyReview } = await import('./review')

/**
 * Gathering the week.
 *
 * `@shared/review.test.ts` proves the prose. This proves the arithmetic that
 * feeds it — chiefly that the review covers the week that has *finished*, not
 * the one being lived, and that a note written twice on the same Monday is
 * still one note.
 */

// A Monday. Everything here is relative to it.
const MONDAY = '2026-08-24'

describe('which week', () => {
  it('finds the Monday of any day in a week', () => {
    expect(mondayOf('2026-08-24')).toBe('2026-08-24')
    expect(mondayOf('2026-08-28')).toBe('2026-08-24')
    // Sunday belongs to the week that is ending, not the one about to start.
    expect(mondayOf('2026-08-30')).toBe('2026-08-24')
    expect(mondayOf('2026-08-31')).toBe('2026-08-31')
  })
})

describe('the facts', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  const worked = (date: string, hours: number, projectId: number | null = null): void => {
    db.run(
      `INSERT INTO time_entries (project_id, started_at, ended_at, duration, billable, rate, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 5000, '', datetime('now'), datetime('now'))`,
      [projectId, `${date}T09:00:00`, `${date}T17:00:00`, hours * 3600]
    )
  }

  it('reviews the week that finished, not the one being lived', () => {
    const facts = reviewFacts(db, MONDAY)
    expect(facts.from).toBe('2026-08-17')
    expect(facts.to).toBe('2026-08-23')
  })

  it('reviews the same week from any day inside it', () => {
    // Somebody who opens the app on Wednesday should not get a different
    // review from somebody who opened it on Monday.
    expect(reviewFacts(db, '2026-08-27').from).toBe(reviewFacts(db, MONDAY).from)
  })

  it('adds up the hours in the week and the one before', () => {
    worked('2026-08-19', 6)
    worked('2026-08-20', 2)
    worked('2026-08-12', 4)

    const facts = reviewFacts(db, MONDAY)
    expect(facts.hoursThisWeek).toBe(8)
    expect(facts.hoursLastWeek).toBe(4)
  })

  it('does not count work done in the week still in progress', () => {
    worked('2026-08-25', 8)
    expect(reviewFacts(db, MONDAY).hoursThisWeek).toBe(0)
  })

  it('counts money by the day it arrived', () => {
    const invoice = createInvoice(db, {
      clientId: null,
      issueDate: '2026-08-01',
      dueDate: '2026-08-15',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 150_000 }]
    })
    updateInvoice(db, invoice.id, { status: 'sent' })
    db.run("UPDATE invoices SET status = 'paid', paid_at = '2026-08-19' WHERE id = ?", [invoice.id])

    expect(reviewFacts(db, MONDAY).paidThisWeek).toBe(150_000)
  })

  it('reports what is overdue, with how late', () => {
    const invoice = createInvoice(db, {
      clientId: null,
      issueDate: '2026-06-01',
      dueDate: '2026-07-01',
      lines: [{ description: 'Work', quantity: 1, unitPrice: 50_000 }]
    })
    updateInvoice(db, invoice.id, { status: 'sent' })

    const [overdue] = reviewFacts(db, MONDAY).overdue
    expect(overdue!.amount).toBe(50_000)
    expect(overdue!.daysLate).toBe(54)
  })

  it('leaves a deadline alone when there is no work left on it', () => {
    // A project due Friday with everything done is not at risk.
    db.run(
      "INSERT INTO projects (name, folder, status, due_on, created_at, updated_at) VALUES ('Ashfield', 'P/A', 'active', '2026-08-28', datetime('now'), datetime('now'))"
    )
    expect(reviewFacts(db, MONDAY).slipping).toHaveLength(0)
  })

  it('flags a deadline that still has open tasks', () => {
    db.run(
      "INSERT INTO projects (name, folder, status, due_on, created_at, updated_at) VALUES ('Ashfield', 'P/A', 'active', '2026-08-28', datetime('now'), datetime('now'))"
    )
    const projectId = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
    db.run(
      "INSERT INTO tasks (project_id, title, status, created_at, updated_at) VALUES (?, 'Render', 'todo', datetime('now'), datetime('now'))",
      [projectId]
    )

    const [slipping] = reviewFacts(db, MONDAY).slipping
    expect(slipping).toMatchObject({ project: 'Ashfield', openTasks: 1, daysLeft: 4 })
  })

  it('spots a project that has run past its budget', () => {
    db.run(
      "INSERT INTO projects (name, folder, budget, created_at, updated_at) VALUES ('Ashfield', 'P/A', 100000, datetime('now'), datetime('now'))"
    )
    const projectId = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
    // 40 hours at £50 is £2,000 against a £1,000 budget.
    worked('2026-08-19', 40, projectId)

    const [over] = reviewFacts(db, MONDAY).overBudget
    expect(over).toMatchObject({ project: 'Ashfield', budget: 100_000, spent: 200_000 })
  })

  it('survives an empty workspace without producing nonsense', () => {
    const review = weeklyReview(db, MONDAY)
    expect(review.quiet).toBe(true)
    expect(review.body).not.toContain('NaN')
    expect(review.body).not.toContain('undefined')
    expect(review.focus).toHaveLength(3)
  })
})

describe('filing it', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-review-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('writes the review into the notebook', async () => {
    const filed = await fileWeeklyReview(db, root, MONDAY)

    expect(filed.created).toBe(true)
    const note = db.get<{ file: string; pinned: number }>(
      'SELECT file, pinned FROM notes WHERE id = ?',
      [filed.noteId]
    )!
    // Pinned, because the point is that it is there without being looked for.
    expect(note.pinned).toBe(1)
    expect(await readFile(join(root, note.file), 'utf8')).toContain('Week in review')
  })

  it('rewrites rather than piling up a second note for the same week', async () => {
    // A Monday reviewed twice is still one Monday.
    const first = await fileWeeklyReview(db, root, MONDAY)
    const second = await fileWeeklyReview(db, root, '2026-08-27')

    expect(second.created).toBe(false)
    expect(second.noteId).toBe(first.noteId)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notes')!.n).toBe(1)
  })

  it('writes a separate note for a different week', async () => {
    await fileWeeklyReview(db, root, MONDAY)
    await fileWeeklyReview(db, root, '2026-08-31')

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notes')!.n).toBe(2)
  })
})

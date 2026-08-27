import type { Database, Row } from '../db'
import { buildReview, type Review, type ReviewFacts } from '@shared/review'
import { addDays, today } from '@shared/taxYear'
import { agedDebtors } from './debtors'
import { getCalendarSettings } from './calendarSettings'
import { createNote, writeNote } from './notes'

/**
 * Gathering the week.
 *
 * Every figure comes out of the database in one place, so the review and the
 * pages it summarises can never disagree — and so that the prose in
 * `@shared/review` can be tested against facts somebody made up rather than a
 * database somebody has to build.
 */

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const at = new Date(year, month - 1, day)
  // getDay() is 0 on Sunday, and the working week starts on Monday.
  return addDays(date, -((at.getDay() + 6) % 7))
}

/** A deadline further off than this is not this week's problem. */
const HORIZON_DAYS = 14

function seconds(db: Database, from: string, to: string): number {
  return (
    db.get<Row & { total: number | null }>(
      `SELECT SUM(duration) AS total FROM time_entries
        WHERE ended_at IS NOT NULL AND date(started_at) >= ? AND date(started_at) <= ?`,
      [from, to]
    )?.total ?? 0
  )
}

export function reviewFacts(db: Database, asOf: string = today()): ReviewFacts {
  // The week that has just finished, not the one in progress. A review of a
  // week still being lived is a progress bar, not a review.
  const thisMonday = mondayOf(asOf)
  const from = addDays(thisMonday, -7)
  const to = addDays(thisMonday, -1)
  const previousFrom = addDays(from, -7)

  const debt = agedDebtors(db, asOf)
  const calendar = getCalendarSettings(db)

  const paid =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(gross) AS total FROM invoices
        WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?`,
      [from, to]
    )?.total ?? 0

  const raised =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(gross) AS total FROM invoices
        WHERE status IN ('sent','paid') AND issue_date >= ? AND issue_date <= ?`,
      [from, to]
    )?.total ?? 0

  const tasksCompleted =
    db.get<Row & { n: number }>(
      "SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND date(updated_at) BETWEEN ? AND ?",
      [from, to]
    )?.n ?? 0

  // A project "moved" if time went into it, which is the only signal that is
  // true of every kind of work.
  const projectsMoved = db
    .all<Row & { name: string }>(
      `SELECT DISTINCT p.name FROM time_entries t
         JOIN projects p ON p.id = t.project_id
        WHERE t.ended_at IS NOT NULL AND date(t.started_at) BETWEEN ? AND ?
        ORDER BY p.name`,
      [from, to]
    )
    .map((row) => row.name)

  const slipping = db
    .all<Row & { name: string; due_on: string; open: number }>(
      `SELECT p.name, p.due_on,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.project_id = p.id AND t.status != 'done' AND t.archived = 0) AS open
         FROM projects p
        WHERE p.archived = 0 AND p.status = 'active'
          AND p.due_on IS NOT NULL AND p.due_on <= ?
        ORDER BY p.due_on`,
      [addDays(asOf, HORIZON_DAYS)]
    )
    // A deadline with no work left on it is a deadline that is fine.
    .filter((row) => row.open > 0)
    .map((row) => ({
      project: row.name,
      dueOn: row.due_on,
      daysLeft: daysBetween(asOf, row.due_on),
      openTasks: row.open
    }))

  const overBudget = db
    .all<Row & { name: string; budget: number; spent: number | null }>(
      `SELECT p.name, p.budget,
              (SELECT SUM(t.duration * COALESCE(t.rate, 0) / 3600)
                 FROM time_entries t
                WHERE t.project_id = p.id AND t.ended_at IS NOT NULL) AS spent
         FROM projects p
        WHERE p.archived = 0 AND p.budget IS NOT NULL AND p.budget > 0`
    )
    .filter((row) => (row.spent ?? 0) > row.budget)
    .map((row) => ({ project: row.name, budget: row.budget, spent: Math.round(row.spent ?? 0) }))

  const monthStart = `${asOf.slice(0, 7)}-01`

  const byClient = db.all<Row & { name: string; amount: number | null; hours: number | null }>(
    `SELECT c.name,
            (SELECT SUM(i.gross) FROM invoices i
              WHERE i.client_id = c.id AND i.status = 'paid'
                AND i.paid_at >= ? AND i.paid_at <= ?) AS amount,
            (SELECT SUM(t.duration) / 3600.0 FROM time_entries t
               JOIN projects p ON p.id = t.project_id
              WHERE p.client_id = c.id AND t.ended_at IS NOT NULL
                AND date(t.started_at) >= ? AND date(t.started_at) <= ?) AS hours
       FROM clients c
      WHERE c.archived = 0`,
    [monthStart, asOf, monthStart, asOf]
  )

  const earning = byClient.filter((row) => (row.amount ?? 0) > 0)
  const best = earning.reduce<(typeof earning)[number] | null>(
    (top, row) => (top === null || (row.amount ?? 0) > (top.amount ?? 0) ? row : top),
    null
  )

  // Worst by effective rate, not by size. A small client paying well is not
  // the problem; a large one paying badly is.
  const rated = earning.filter((row) => (row.hours ?? 0) > 0)
  const worst = rated.reduce<(typeof rated)[number] | null>((low, row) => {
    if (low === null) return row
    return (row.amount ?? 0) / (row.hours ?? 1) < (low.amount ?? 0) / (low.hours ?? 1) ? row : low
  }, null)

  const unbilled = db.all<Row & { duration: number; rate: number | null }>(
    `SELECT duration, rate FROM time_entries
      WHERE ended_at IS NOT NULL AND billable = 1 AND invoice_line_id IS NULL`
  )

  const plannedMinutes =
    db.get<Row & { total: number | null }>(
      `SELECT SUM(
                (CAST(substr(ends_at, 12, 2) AS INTEGER) * 60 + CAST(substr(ends_at, 15, 2) AS INTEGER)) -
                (CAST(substr(starts_at, 12, 2) AS INTEGER) * 60 + CAST(substr(starts_at, 15, 2) AS INTEGER))
              ) AS total
         FROM calendar_blocks
        WHERE archived = 0 AND all_day = 0
          AND substr(starts_at, 1, 10) BETWEEN ? AND ?`,
      [thisMonday, addDays(thisMonday, 6)]
    )?.total ?? 0

  const workingDays = countBits(calendar.workingDays)

  return {
    from,
    to,
    writtenOn: asOf,
    hoursThisWeek: round(seconds(db, from, to) / 3600),
    hoursLastWeek: round(seconds(db, previousFrom, addDays(from, -1)) / 3600),
    paidThisWeek: paid,
    raisedThisWeek: raised,
    tasksCompleted,
    projectsMoved,
    overdue: debt.rows
      .filter((row) => row.daysOverdue > 0)
      .map((row) => ({
        number: row.invoice.number,
        client: row.invoice.clientName ?? 'No client',
        amount: row.invoice.gross,
        daysLate: row.daysOverdue
      })),
    slipping,
    overBudget,
    bestClient: best ? { name: best.name, amount: best.amount ?? 0 } : null,
    worstClient: worst
      ? { name: worst.name, amount: worst.amount ?? 0, hours: round(worst.hours ?? 0) }
      : null,
    unbilledValue: unbilled.reduce(
      (sum, row) => sum + Math.round((row.duration / 3600) * (row.rate ?? 0)),
      0
    ),
    unbilledHours: round(unbilled.reduce((sum, row) => sum + row.duration, 0) / 3600),
    plannedNextWeek: round(plannedMinutes / 60),
    capacityHours: round((calendar.dailyCapacityMinutes / 60) * workingDays)
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** How many days are set in the working-days bitmask. */
function countBits(mask: number): number {
  let bits = 0
  for (let day = 0; day < 7; day += 1) if (mask & (1 << day)) bits += 1
  return bits
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  )
}

/* ------------------------------------------------------------------ *
 * Writing it down
 * ------------------------------------------------------------------ */

export function weeklyReview(db: Database, asOf: string = today()): Review {
  return buildReview(reviewFacts(db, asOf))
}

/**
 * Write the review into the notebook, once per week.
 *
 * A note rather than a panel, because a note is a thing that stays: it can be
 * searched, added to, and read back in November to see what February looked
 * like. Two reviews for the same week would be two notes, so the existing one
 * is rewritten instead — a Monday reviewed twice is still one Monday.
 */
export async function fileWeeklyReview(
  db: Database,
  workspacePath: string,
  asOf: string = today()
): Promise<{ review: Review; noteId: number; created: boolean }> {
  const review = weeklyReview(db, asOf)

  const existing = db.get<Row & { id: number }>(
    'SELECT id FROM notes WHERE project_id IS NULL AND title = ?',
    [review.title]
  )

  if (existing) {
    await writeNote(db, workspacePath, existing.id, review.body)
    return { review, noteId: existing.id, created: false }
  }

  const note = await createNote(db, workspacePath, null, review.title)
  await writeNote(db, workspacePath, note.id, review.body)
  // Pinned: the point is that it is there on Monday without being looked for.
  db.run('UPDATE notes SET pinned = 1 WHERE id = ?', [note.id])

  return { review, noteId: note.id, created: true }
}

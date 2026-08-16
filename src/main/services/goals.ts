import type { Database, Row } from '../db'
import type { Goal, GoalInput, GoalKind, GoalPeriod, GoalProgress, GoalStatus } from '@shared/types'
import { addDays, daysBetween } from '@shared/calendar'
import { rangeFor, today } from '@shared/taxYear'
import { summary } from './finance'

/**
 * Goals, measured from the data the app already holds.
 *
 * Only a `custom` goal carries a number you type. Everything else is counted
 * from invoices, clients, projects, time or posts — a target you have to update
 * by hand is a target that quietly goes stale, and a stale goal is worse than
 * no goal because you still believe it.
 */

interface GoalRow extends Row {
  id: number
  name: string
  description: string
  kind: string
  target: number
  manual: number
  period: string
  starts_on: string | null
  ends_on: string | null
  colour: string
  status: string
  created_at: string
  updated_at: string
}

function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind as GoalKind,
    target: row.target,
    manual: row.manual,
    period: row.period as GoalPeriod,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    colour: row.colour,
    status: row.status as GoalStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * The window a goal is measured over.
 *
 * A recurring goal takes the current calendar or tax period, so "£4,000 a
 * month" resets on the 1st without anyone touching it. A one-off runs from when
 * it was set to the date it is due.
 */
function windowFor(goal: Goal, reference: string): { from: string; to: string } {
  if (goal.period === 'once') {
    return {
      from: goal.startsOn ?? goal.createdAt.slice(0, 10),
      to: goal.endsOn ?? reference
    }
  }

  const range = rangeFor(goal.period, reference)
  return { from: range.from, to: range.to }
}

function measure(db: Database, goal: Goal, range: { from: string; to: string }): number {
  switch (goal.kind) {
    case 'revenue':
      return summary(db, { ...range, label: '' }).income

    case 'profit':
      return summary(db, { ...range, label: '' }).profit

    case 'hours': {
      const row = db.get<Row & { seconds: number | null }>(
        `SELECT SUM(duration) AS seconds FROM time_entries
          WHERE substr(started_at, 1, 10) BETWEEN ? AND ?`,
        [range.from, range.to]
      )
      return Math.round((row?.seconds ?? 0) / 3600)
    }

    case 'clients': {
      const row = db.get<Row & { n: number }>(
        `SELECT COUNT(*) AS n FROM clients
          WHERE substr(created_at, 1, 10) BETWEEN ? AND ?`,
        [range.from, range.to]
      )
      return row?.n ?? 0
    }

    case 'projects': {
      // Counted when finished, not when started — the goal is delivery.
      const row = db.get<Row & { n: number }>(
        `SELECT COUNT(*) AS n FROM projects
          WHERE status = 'completed' AND substr(updated_at, 1, 10) BETWEEN ? AND ?`,
        [range.from, range.to]
      )
      return row?.n ?? 0
    }

    case 'posts': {
      const row = db.get<Row & { n: number }>(
        `SELECT COUNT(*) AS n FROM posts
          WHERE status = 'published' AND substr(COALESCE(published_at, scheduled_at), 1, 10)
                BETWEEN ? AND ?`,
        [range.from, range.to]
      )
      return row?.n ?? 0
    }

    case 'custom':
      return goal.manual
  }
}

/**
 * Where this goal would land if the rest of the period went like the part
 * already elapsed.
 *
 * Deliberately null for the first stretch of a period: extrapolating from two
 * days of a month produces a confident number that is nonsense, and a
 * projection nobody can trust is worse than no projection.
 */
function project(current: number, range: { from: string; to: string }, reference: string): number | null {
  const total = daysBetween(range.from, range.to) + 1
  const elapsed = Math.min(total, daysBetween(range.from, reference) + 1)

  if (total <= 1 || elapsed < 3 || elapsed / total < 0.15) return null
  return Math.round((current / elapsed) * total)
}

export function goalProgress(db: Database, goal: Goal, reference = today()): GoalProgress {
  const range = windowFor(goal, reference)
  const current = measure(db, goal, range)

  const share = goal.target > 0 ? Math.min(10_000, Math.round((current * 10_000) / goal.target)) : 0

  const daysLeft = range.to >= reference ? daysBetween(reference, range.to) : 0

  return {
    ...goal,
    current,
    share,
    range,
    daysLeft: goal.period === 'once' && !goal.endsOn ? null : daysLeft,
    projected: project(current, range, reference)
  }
}

export function listGoals(db: Database, includeArchived = false): GoalProgress[] {
  const where = includeArchived ? '' : "WHERE status != 'archived'"
  const reference = today()

  return db
    .all<GoalRow>(`SELECT * FROM goals ${where} ORDER BY status, id`)
    .map(toGoal)
    .map((goal) => goalProgress(db, goal, reference))
}

export function getGoal(db: Database, id: number): Goal {
  const row = db.get<GoalRow>('SELECT * FROM goals WHERE id = ?', [id])
  if (!row) throw new Error(`No goal with id ${id}`)
  return toGoal(row)
}

export function createGoal(db: Database, input: GoalInput): GoalProgress {
  const period = input.period ?? 'year'

  db.run(
    `INSERT INTO goals (name, description, kind, target, manual, period, starts_on, ends_on,
                        colour, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name,
      input.description ?? '',
      input.kind ?? 'custom',
      input.target ?? 0,
      input.manual ?? 0,
      period,
      // A one-off with no start began today; a recurring goal takes its window
      // from the calendar, so a stored start would only go stale.
      input.startsOn ?? (period === 'once' ? today() : null),
      input.endsOn ?? (period === 'once' ? addDays(today(), 90) : null),
      input.colour ?? '#6E56CF',
      input.status ?? 'active'
    ]
  )

  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Goal was not created')
  return goalProgress(db, getGoal(db, row.id))
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  kind: 'kind',
  target: 'target',
  manual: 'manual',
  period: 'period',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  colour: 'colour',
  status: 'status'
}

export function updateGoal(db: Database, id: number, patch: Partial<GoalInput>): GoalProgress {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE goals SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  return goalProgress(db, getGoal(db, id))
}

export function deleteGoal(db: Database, id: number): void {
  db.run('DELETE FROM goals WHERE id = ?', [id])
}

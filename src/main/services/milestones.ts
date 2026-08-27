import type { Database, Row } from '../db'
import type { ProjectMilestone } from '@shared/types'

/**
 * The dates inside a project that are not its deadline.
 *
 * `projects.due_on` is the one date a project ends. A three-month build has a
 * design sign-off, a content deadline and a launch besides, and putting those
 * in as tasks makes a board full of things nobody does — a milestone is a date
 * you are held to, not work you perform. They appear on the calendar as
 * derived markers, which is to say they are never copied into it.
 */

interface MilestoneRow extends Row {
  id: number
  project_id: number
  title: string
  due_on: string
  notes: string
  reached_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function toMilestone(row: MilestoneRow): ProjectMilestone {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    dueOn: row.due_on,
    notes: row.notes,
    reachedAt: row.reached_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listMilestones(db: Database, projectId: number): ProjectMilestone[] {
  return db
    .all<MilestoneRow>(
      'SELECT * FROM project_milestones WHERE project_id = ? ORDER BY due_on, sort_order, id',
      [projectId]
    )
    .map(toMilestone)
}

export function createMilestone(
  db: Database,
  input: { projectId: number; title: string; dueOn: string; notes?: string }
): ProjectMilestone {
  db.run(
    `INSERT INTO project_milestones (project_id, title, due_on, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [input.projectId, input.title.trim() || 'Milestone', input.dueOn, input.notes ?? '']
  )
  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Milestone was not created')
  return getMilestone(db, row.id)
}

export function getMilestone(db: Database, id: number): ProjectMilestone {
  const row = db.get<MilestoneRow>('SELECT * FROM project_milestones WHERE id = ?', [id])
  if (!row) throw new Error(`No milestone with id ${id}`)
  return toMilestone(row)
}

const UPDATABLE: Record<string, string> = {
  title: 'title',
  dueOn: 'due_on',
  notes: 'notes',
  reachedAt: 'reached_at',
  sortOrder: 'sort_order'
}

export function updateMilestone(
  db: Database,
  id: number,
  patch: Partial<ProjectMilestone>
): ProjectMilestone {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE project_milestones SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getMilestone(db, id)
}

/**
 * Reached, rather than done.
 *
 * A milestone is a date. Passing one is not completing a task, and the word
 * matters: "done" would invite somebody to look for the work it represented.
 */
export function markReached(db: Database, id: number, reached: boolean): ProjectMilestone {
  db.run(
    `UPDATE project_milestones SET reached_at = ?, updated_at = datetime('now') WHERE id = ?`,
    [reached ? new Date().toISOString() : null, id]
  )
  return getMilestone(db, id)
}

export function deleteMilestone(db: Database, id: number): void {
  db.run('DELETE FROM project_milestones WHERE id = ?', [id])
}

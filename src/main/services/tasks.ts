import type { Database, Row } from '../db'
import type { Task, TaskFilter, TaskInput, TaskStatus, TaskWithContext } from '@shared/types'

interface TaskRow extends Row {
  id: number
  project_id: number | null
  category_id: number | null
  parent_id: number | null
  title: string
  notes: string
  status: string
  priority: number
  due_at: string | null
  colour: string
  sort_order: number
  completed_at: string | null
  archived: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

type ContextRow = TaskRow & {
  project_name: string | null
  project_colour: string | null
  category_name: string | null
  category_colour: string | null
  subtask_count: number
  subtask_done_count: number
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    categoryId: row.category_id,
    parentId: row.parent_id,
    title: row.title,
    notes: row.notes,
    status: row.status as TaskStatus,
    priority: row.priority,
    dueAt: row.due_at,
    colour: row.colour,
    sortOrder: row.sort_order,
    completedAt: row.completed_at,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toTaskWithContext(row: ContextRow): TaskWithContext {
  return {
    ...toTask(row),
    projectName: row.project_name,
    projectColour: row.project_colour,
    categoryName: row.category_name,
    categoryColour: row.category_colour,
    subtaskCount: row.subtask_count,
    subtaskDoneCount: row.subtask_done_count
  }
}

const SELECT_WITH_CONTEXT = `
  SELECT t.*,
         p.name   AS project_name,
         p.colour AS project_colour,
         c.name   AS category_name,
         c.colour AS category_colour,
         (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
         (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done')
           AS subtask_done_count
    FROM tasks t
    LEFT JOIN projects   p ON p.id = t.project_id
    LEFT JOIN categories c ON c.id = t.category_id
`

export function listTasks(db: Database, filter: TaskFilter = {}): TaskWithContext[] {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter.projectId !== undefined) {
    if (filter.projectId === null) {
      conditions.push('t.project_id IS NULL')
    } else {
      conditions.push('t.project_id = ?')
      params.push(filter.projectId)
    }
  }

  if (filter.categoryId !== undefined && filter.categoryId !== null) {
    conditions.push('t.category_id = ?')
    params.push(filter.categoryId)
  }

  if (filter.status) {
    conditions.push('t.status = ?')
    params.push(filter.status)
  }

  if (filter.topLevelOnly) conditions.push('t.parent_id IS NULL')

  // Archived tasks stay out of every list unless explicitly asked for, so no
  // caller has to remember to exclude them.
  if (filter.archived === 'only') conditions.push('t.archived = 1')
  else if (filter.archived !== true) conditions.push('t.archived = 0')

  if (filter.search) {
    conditions.push('(t.title LIKE ? OR t.notes LIKE ?)')
    const like = `%${filter.search}%`
    params.push(like, like)
  }

  if (filter.dueBefore) {
    conditions.push('t.due_at IS NOT NULL AND t.due_at <= ?')
    params.push(filter.dueBefore)
  }

  if (filter.dueAfter) {
    conditions.push('t.due_at IS NOT NULL AND t.due_at >= ?')
    params.push(filter.dueAfter)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db
    .all<ContextRow>(`${SELECT_WITH_CONTEXT} ${where} ORDER BY t.sort_order, t.id`, params)
    .map(toTaskWithContext)
}

export function getTask(db: Database, id: number): TaskWithContext {
  const row = db.get<ContextRow>(`${SELECT_WITH_CONTEXT} WHERE t.id = ?`, [id])
  if (!row) throw new Error(`No task with id ${id}`)
  return toTaskWithContext(row)
}

/**
 * New tasks go to the end of their column. Sort orders are REAL so a task
 * dropped between two others takes the midpoint of their orders — no
 * renumbering of everything below it.
 */
function nextSortOrder(db: Database, projectId: number | null, status: TaskStatus): number {
  const row = db.get<Row & { max_order: number | null }>(
    `SELECT MAX(sort_order) AS max_order FROM tasks
      WHERE status = ? AND project_id IS ?`,
    [status, projectId]
  )
  return (row?.max_order ?? 0) + 1
}

export function createTask(db: Database, input: TaskInput): TaskWithContext {
  const status = input.status ?? 'todo'
  const projectId = input.projectId ?? null

  db.run(
    `INSERT INTO tasks (project_id, category_id, parent_id, title, notes, status, priority,
                        due_at, colour, sort_order, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      projectId,
      input.categoryId ?? null,
      input.parentId ?? null,
      input.title,
      input.notes ?? '',
      status,
      input.priority ?? 1,
      input.dueAt ?? null,
      input.colour ?? '',
      input.sortOrder ?? nextSortOrder(db, projectId, status),
      status === 'done' ? new Date().toISOString() : null
    ]
  )

  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Task was not created')
  return getTask(db, row.id)
}

const UPDATABLE: Record<string, string> = {
  projectId: 'project_id',
  categoryId: 'category_id',
  parentId: 'parent_id',
  title: 'title',
  notes: 'notes',
  status: 'status',
  priority: 'priority',
  dueAt: 'due_at',
  colour: 'colour',
  sortOrder: 'sort_order',
  archived: 'archived'
}

export function updateTask(db: Database, id: number, patch: Partial<TaskInput>): TaskWithContext {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }

  // archived_at is derived from the flag, for the same reason completed_at is
  // derived from status: "when was this filed away" must not drift from
  // "is this filed away".
  if (patch.archived !== undefined) {
    assignments.push('archived_at = ?')
    values.push(patch.archived ? new Date().toISOString() : null)
  }

  // completed_at is derived from status rather than trusted from the caller,
  // so "when was this finished" cannot drift from "is this finished".
  if (patch.status) {
    assignments.push('completed_at = ?')
    values.push(patch.status === 'done' ? new Date().toISOString() : null)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE tasks SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  return getTask(db, id)
}

/**
 * Move a task to a position within a status column, taking the midpoint
 * between its new neighbours.
 */
export function moveTask(
  db: Database,
  id: number,
  target: { status: TaskStatus; projectId: number | null; beforeId: number | null }
): TaskWithContext {
  const siblings = db.all<Row & { id: number; sort_order: number }>(
    `SELECT id, sort_order FROM tasks
      WHERE status = ? AND project_id IS ? AND id != ? AND parent_id IS NULL
      ORDER BY sort_order, id`,
    [target.status, target.projectId, id]
  )

  let sortOrder: number
  if (target.beforeId === null) {
    // Dropped at the end.
    sortOrder = (siblings.at(-1)?.sort_order ?? 0) + 1
  } else {
    const index = siblings.findIndex((s) => s.id === target.beforeId)
    const after = siblings[index]?.sort_order ?? 1
    const before = index > 0 ? (siblings[index - 1]?.sort_order ?? after - 1) : after - 1
    sortOrder = (before + after) / 2
  }

  return updateTask(db, id, { status: target.status, projectId: target.projectId, sortOrder })
}

/** Tasks due on or before `date`, across all projects — for the dashboard. */
export function listDueTasks(db: Database, date: string): TaskWithContext[] {
  return db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT}
        WHERE t.archived = 0 AND t.status != 'done'
          AND t.due_at IS NOT NULL AND t.due_at <= ?
        ORDER BY t.due_at`,
      [date]
    )
    .map(toTaskWithContext)
}

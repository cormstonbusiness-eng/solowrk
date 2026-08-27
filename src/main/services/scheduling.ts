import type { Database, Row } from '../db'
import type { CalendarBlockWithContext, DerivedMarker, TaskWithContext } from '@shared/types'
import { addMinutes, minutesBetween } from '@shared/calendar'
import { createBlock, getBlock } from './blocks'
import { getCalendarSettings } from './calendarSettings'
import { getTask } from './tasks'

/**
 * Putting work in the diary, and the dates that are already there.
 *
 * Two halves of the same question — what is on a day — that answer it very
 * differently. Scheduling writes a block. Markers write nothing at all: a
 * project deadline is already a fact about the project, and copying it into
 * the calendar as a row would mean two places to change it and one of them
 * silently wrong. They are computed on the way out and cannot be dragged,
 * because dragging one would mean moving a deadline by accident.
 */

/* ------------------------------------------------------------------ *
 * Scheduling a task
 * ------------------------------------------------------------------ */

/**
 * Give a task a time.
 *
 * The block carries the task's title rather than referring to it, so the grid
 * reads as a diary rather than as a list of foreign keys — and so renaming the
 * task later does not silently rewrite what your Tuesday said you were doing.
 *
 * `tasks.scheduled_at` is not written here. A trigger keeps it in step with
 * whatever blocks point at the task, which is the only way it stays true
 * across drags, restores and the assistant.
 */
export function scheduleTask(
  db: Database,
  input: { taskId: number; startsAt: string; endsAt?: string }
): CalendarBlockWithContext {
  const task = getTask(db, input.taskId)
  const settings = getCalendarSettings(db)

  // The estimate decides the length, and where there is no estimate the
  // default does. Neither invents an estimate: a task scheduled for an hour
  // because an hour is the default has still not been estimated.
  const minutes = task.estimateMinutes ?? settings.defaultBlockMinutes

  return createBlock(db, {
    title: task.title,
    blockType: 'task',
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? addMinutes(input.startsAt, minutes),
    taskId: task.id,
    projectId: task.projectId,
    colour: task.colour
  })
}

/**
 * Adopt an existing block's length as the task's estimate.
 *
 * Explicit, and never a side effect of resizing. Somebody who drags a block
 * out to three hours because that is the slot they have free has not revised
 * their estimate, and an app that decided they had would quietly corrupt
 * every figure built on estimates.
 */
export function adoptEstimate(db: Database, blockId: number): TaskWithContext {
  const block = getBlock(db, blockId)
  if (block.taskId === null) throw new Error('That block is not scheduling a task')

  const minutes = Math.max(0, minutesBetween(block.startsAt, block.endsAt))

  db.run(`UPDATE tasks SET estimate_minutes = ?, updated_at = datetime('now') WHERE id = ?`, [
    minutes,
    block.taskId
  ])

  return getTask(db, block.taskId)
}

/* ------------------------------------------------------------------ *
 * The unscheduled rail
 * ------------------------------------------------------------------ */

interface RailRow extends Row {
  id: number
  title: string
  project_id: number | null
  project_name: string | null
  project_colour: string | null
  colour: string
  due_at: string | null
  estimate_minutes: number | null
  priority: number
}

/**
 * Everything with no time on it, for the rail beside the grid.
 *
 * Done and archived tasks are out, obviously. So are tasks that already have
 * a block: the rail is a list of decisions not yet made, and a task that is
 * on the grid has had its decision made.
 */
export function unscheduledTasks(
  db: Database,
  filter: { search?: string; projectId?: number } = {}
): TaskWithContext[] {
  const conditions = [
    't.scheduled_at IS NULL',
    "t.status != 'done'",
    't.archived = 0',
    // Subtasks belong to their parent's row on the board. Listing them here
    // too would put a checklist of six on the rail beside the one thing that
    // actually needs a slot.
    't.parent_id IS NULL'
  ]
  const params: (string | number)[] = []

  if (filter.projectId !== undefined) {
    conditions.push('t.project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.search) {
    conditions.push('t.title LIKE ?')
    params.push(`%${filter.search}%`)
  }

  const rows = db.all<RailRow>(
    `SELECT t.id, t.title, t.project_id, t.colour, t.due_at, t.estimate_minutes, t.priority,
            p.name AS project_name, p.colour AS project_colour
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${conditions.join(' AND ')}
      -- Anything with a deadline first, soonest first, then by priority. What
      -- is late is what needs a slot.
      ORDER BY (t.due_at IS NULL), t.due_at, t.priority DESC, t.sort_order`,
    params
  )

  return rows.map((row) => getTask(db, row.id))
}

/* ------------------------------------------------------------------ *
 * Derived markers
 * ------------------------------------------------------------------ */

/**
 * The dates already in the app, shown on the calendar without being copied
 * into it.
 *
 * Everything here is read from where it actually lives — a project's due
 * date, a task's, an invoice's, a milestone. None of it becomes a row in
 * `calendar_blocks`, so none of it can drift from the record, and none of it
 * can be dragged: moving a deadline is a decision, and a decision made by
 * accident with a mouse is not one.
 */
export function derivedMarkers(
  db: Database,
  range: { from: string; to: string }
): DerivedMarker[] {
  const markers: DerivedMarker[] = []
  const span: [string, string] = [range.from, range.to]

  for (const row of db.all<Row & { id: number; name: string; due_on: string; colour: string }>(
    `SELECT id, name, due_on, colour FROM projects
      WHERE archived = 0 AND status NOT IN ('completed', 'cancelled')
        AND due_on IS NOT NULL AND due_on BETWEEN ? AND ?`,
    span
  )) {
    markers.push({
      kind: 'project',
      id: row.id,
      day: row.due_on,
      label: row.name,
      detail: 'Project deadline',
      colour: row.colour
    })
  }

  for (const row of db.all<
    Row & { id: number; title: string; due_on: string; project_name: string; colour: string }
  >(
    `SELECT m.id, m.title, m.due_on, p.name AS project_name, p.colour AS colour
       FROM project_milestones m
       JOIN projects p ON p.id = m.project_id
      WHERE m.reached_at IS NULL AND p.archived = 0
        AND m.due_on BETWEEN ? AND ?`,
    span
  )) {
    markers.push({
      kind: 'milestone',
      id: row.id,
      day: row.due_on,
      label: row.title,
      detail: row.project_name,
      colour: row.colour
    })
  }

  for (const row of db.all<
    Row & { id: number; title: string; due_at: string; project_colour: string | null }
  >(
    `SELECT t.id, t.title, t.due_at, p.colour AS project_colour
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status != 'done' AND t.archived = 0
        AND t.due_at IS NOT NULL AND substr(t.due_at, 1, 10) BETWEEN ? AND ?`,
    span
  )) {
    markers.push({
      kind: 'task',
      id: row.id,
      day: row.due_at.slice(0, 10),
      label: row.title,
      detail: 'Due',
      colour: row.project_colour ?? ''
    })
  }

  for (const row of db.all<Row & { id: number; number: string; due_date: string; gross: number }>(
    // 'overdue' is not a status — it is derived from due_date and the clock,
    // which is exactly what this query is doing. 'sent' is what is owed.
    `SELECT id, number, due_date, gross FROM invoices
      WHERE status = 'sent' AND due_date BETWEEN ? AND ?`,
    span
  )) {
    markers.push({
      kind: 'invoice',
      id: row.id,
      day: row.due_date,
      label: row.number || 'Draft invoice',
      detail: `£${(row.gross / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })} due`,
      colour: ''
    })
  }

  return markers.sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label))
}

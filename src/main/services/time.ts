import type { Database, Row } from '../db'
import type { Pence, RunningTimer, TimeEntry, TimeEntryWithContext } from '@shared/types'
import { effectiveRate, timeValue } from '@shared/money'
import { getSettings } from './settings'

interface TimeRow extends Row {
  id: number
  project_id: number | null
  task_id: number | null
  started_at: string
  ended_at: string | null
  duration: number
  rate: number
  billable: number
  notes: string
  invoice_line_id: number | null
  created_at: string
  updated_at: string
}

type ContextRow = TimeRow & {
  project_name: string | null
  project_colour: string | null
  client_name: string | null
  task_title: string | null
}

const SELECT = `
  SELECT t.*,
         p.name   AS project_name,
         p.colour AS project_colour,
         c.name   AS client_name,
         k.title  AS task_title
    FROM time_entries t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN clients  c ON c.id = p.client_id
    LEFT JOIN tasks    k ON k.id = t.task_id
`

function toEntry(row: ContextRow): TimeEntryWithContext {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    duration: row.duration,
    rate: row.rate,
    billable: row.billable === 1,
    notes: row.notes,
    invoiceLineId: row.invoice_line_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectName: row.project_name,
    projectColour: row.project_colour,
    clientName: row.client_name,
    taskTitle: row.task_title
  }
}

/**
 * The rate to record against a new entry: project, then client, then the
 * business default. Snapshotted onto the entry so changing your rate later
 * does not rewrite the value of work already done.
 */
export function rateForProject(db: Database, projectId: number | null): Pence {
  const settings = getSettings(db)
  if (projectId === null) return settings.defaultHourlyRate

  const row = db.get<Row & { rate: number | null; client_rate: number | null }>(
    `SELECT p.rate AS rate, c.default_rate AS client_rate
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?`,
    [projectId]
  )

  return effectiveRate(row?.rate ?? null, row?.client_rate ?? null, settings.defaultHourlyRate)
}

/** The single running entry, if any. */
export function getRunning(db: Database): RunningTimer | null {
  const row = db.get<ContextRow>(`${SELECT} WHERE t.ended_at IS NULL ORDER BY t.started_at DESC`)
  if (!row) return null

  const entry = toEntry(row)
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(entry.startedAt).getTime()) / 1000)
  )
  return { entry, elapsed }
}

/**
 * Start a timer. Only one runs at a time — starting a second stops the first
 * rather than silently double-counting the same minutes across two projects.
 */
export function startTimer(
  db: Database,
  input: { projectId: number | null; taskId?: number | null; notes?: string }
): RunningTimer {
  const running = getRunning(db)
  if (running) stopTimer(db, running.entry.id)

  db.run(
    `INSERT INTO time_entries (project_id, task_id, started_at, rate, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.projectId,
      input.taskId ?? null,
      new Date().toISOString(),
      rateForProject(db, input.projectId),
      input.notes ?? ''
    ]
  )

  const started = getRunning(db)
  if (!started) throw new Error('Timer did not start')
  return started
}

/**
 * Stop a running entry, recording its duration.
 *
 * Duration is stored rather than recomputed from the timestamps so that later
 * manual edits to the hours are possible without rewriting history.
 */
export function stopTimer(db: Database, id: number): TimeEntryWithContext {
  const row = db.get<TimeRow>('SELECT * FROM time_entries WHERE id = ?', [id])
  if (!row) throw new Error(`No time entry with id ${id}`)
  if (row.ended_at !== null) return getEntry(db, id)

  const endedAt = new Date()
  const duration = Math.max(
    0,
    Math.floor((endedAt.getTime() - new Date(row.started_at).getTime()) / 1000)
  )

  db.run(
    `UPDATE time_entries SET ended_at = ?, duration = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [endedAt.toISOString(), duration, id]
  )

  return getEntry(db, id)
}

export function getEntry(db: Database, id: number): TimeEntryWithContext {
  const row = db.get<ContextRow>(`${SELECT} WHERE t.id = ?`, [id])
  if (!row) throw new Error(`No time entry with id ${id}`)
  return toEntry(row)
}

/** Log time that was not tracked live. */
export function createEntry(
  db: Database,
  input: {
    projectId: number | null
    taskId?: number | null
    startedAt: string
    duration: number
    notes?: string
    billable?: boolean
    rate?: Pence
  }
): TimeEntryWithContext {
  const endedAt = new Date(
    new Date(input.startedAt).getTime() + input.duration * 1000
  ).toISOString()

  db.run(
    `INSERT INTO time_entries
       (project_id, task_id, started_at, ended_at, duration, rate, billable, notes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.projectId,
      input.taskId ?? null,
      input.startedAt,
      endedAt,
      input.duration,
      input.rate ?? rateForProject(db, input.projectId),
      input.billable === false ? 0 : 1,
      input.notes ?? ''
    ]
  )

  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  return getEntry(db, row!.id)
}

const UPDATABLE: Record<string, string> = {
  projectId: 'project_id',
  taskId: 'task_id',
  startedAt: 'started_at',
  duration: 'duration',
  notes: 'notes',
  rate: 'rate'
}

export function updateEntry(
  db: Database,
  id: number,
  patch: Partial<TimeEntry>
): TimeEntryWithContext {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (patch.billable !== undefined) {
    assignments.push('billable = ?')
    values.push(patch.billable ? 1 : 0)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE time_entries SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getEntry(db, id)
}

export function deleteEntry(db: Database, id: number): void {
  db.run('DELETE FROM time_entries WHERE id = ?', [id])
}

export function listEntries(
  db: Database,
  filter: { from?: string; to?: string; projectId?: number; unbilledOnly?: boolean } = {}
): TimeEntryWithContext[] {
  const conditions = ['t.ended_at IS NOT NULL']
  const params: (string | number)[] = []

  if (filter.from) {
    conditions.push('date(t.started_at) >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    conditions.push('date(t.started_at) <= ?')
    params.push(filter.to)
  }
  if (filter.projectId !== undefined) {
    conditions.push('t.project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.unbilledOnly) {
    conditions.push('t.invoice_line_id IS NULL AND t.billable = 1')
  }

  return db
    .all<ContextRow>(
      `${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY t.started_at DESC`,
      params
    )
    .map(toEntry)
}

/** Billable, un-invoiced time for a project, with what it is worth. */
export function unbilledFor(
  db: Database,
  projectId: number
): { entries: TimeEntryWithContext[]; seconds: number; value: Pence } {
  const entries = listEntries(db, { projectId, unbilledOnly: true })
  const seconds = entries.reduce((sum, entry) => sum + entry.duration, 0)
  const value = entries.reduce((sum, entry) => sum + timeValue(entry.duration, entry.rate), 0)
  return { entries, seconds, value }
}

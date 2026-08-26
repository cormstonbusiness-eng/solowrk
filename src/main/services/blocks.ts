import type { Database, Row } from '../db'
import type {
  BlockInput,
  BlockSource,
  BlockType,
  CalendarBlock,
  CalendarBlockWithContext
} from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import { dayOf, minutesBetween } from '@shared/calendar'

/**
 * Calendar blocks.
 *
 * What used to be `events`, rebuilt around what a block *is* rather than where
 * it came from — see migration 23. The two questions are now separate columns,
 * because "a meeting pulled from a client's feed" and "an hour of focus work"
 * differ in both, and the old `kind` column could only answer one of them.
 */

interface BlockRow extends Row {
  id: number
  title: string
  description: string
  location: string
  block_type: string
  starts_at: string
  ends_at: string
  all_day: number
  timezone: string
  project_id: number | null
  client_id: number | null
  task_id: number | null
  colour: string
  billable: number
  recurrence_rule: string | null
  recurrence_parent_id: number | null
  recurrence_exdates: string
  source: string
  source_uid: string | null
  source_calendar_id: number | null
  locked: number
  meeting_url: string
  reminder_minutes: number | null
  reminded_at: string | null
  archived: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

type ContextRow = BlockRow & {
  project_name: string | null
  project_colour: string | null
  client_name: string | null
  task_title: string | null
}

function toBlock(row: BlockRow): CalendarBlock {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    blockType: row.block_type as BlockType,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day === 1,
    timezone: row.timezone,
    projectId: row.project_id,
    clientId: row.client_id,
    taskId: row.task_id,
    colour: row.colour,
    billable: row.billable === 1,
    recurrenceRule: row.recurrence_rule,
    recurrenceParentId: row.recurrence_parent_id,
    recurrenceExdates: row.recurrence_exdates === '' ? [] : row.recurrence_exdates.split(','),
    source: row.source as BlockSource,
    sourceUid: row.source_uid,
    sourceCalendarId: row.source_calendar_id,
    locked: row.locked === 1,
    meetingUrl: row.meeting_url,
    reminderMinutes: row.reminder_minutes,
    remindedAt: row.reminded_at,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toBlockWithContext(row: ContextRow): CalendarBlockWithContext {
  const block = toBlock(row)
  return {
    ...block,
    projectName: row.project_name,
    projectColour: row.project_colour,
    clientName: row.client_name,
    taskTitle: row.task_title,
    // Resolved here rather than in the renderer so the month, week, day and
    // agenda views cannot disagree about what colour a block is. The type is
    // the last resort, which is what gives an unassigned holiday its green.
    displayColour: row.colour || row.project_colour || blockTypeMeta(block.blockType).colour
  }
}

const SELECT_WITH_CONTEXT = `
  SELECT b.*,
         p.name   AS project_name,
         p.colour AS project_colour,
         c.name   AS client_name,
         t.title  AS task_title
    FROM calendar_blocks b
    LEFT JOIN projects p ON p.id = b.project_id
    LEFT JOIN clients  c ON c.id = b.client_id
    LEFT JOIN tasks    t ON t.id = b.task_id
`

/**
 * Blocks overlapping the day range `from`..`to`, both inclusive.
 *
 * The comparison is on the date half of each stamp, so a block that starts at
 * 23:00 on the last day of the range is included whole rather than clipped out
 * by a `'2026-08-31' < '2026-08-31T23:00'` string comparison.
 */
export function listBlocks(
  db: Database,
  range: { from: string; to: string; projectId?: number }
): CalendarBlockWithContext[] {
  const conditions = [
    'substr(b.ends_at, 1, 10) >= ?',
    'substr(b.starts_at, 1, 10) <= ?',
    'b.archived = 0'
  ]
  const params: (string | number)[] = [range.from, range.to]

  if (range.projectId !== undefined) {
    conditions.push('b.project_id = ?')
    params.push(range.projectId)
  }

  return db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT} WHERE ${conditions.join(' AND ')} ORDER BY b.starts_at, b.id`,
      params
    )
    .map(toBlockWithContext)
}

export function getBlock(db: Database, id: number): CalendarBlockWithContext {
  const row = db.get<ContextRow>(`${SELECT_WITH_CONTEXT} WHERE b.id = ?`, [id])
  if (!row) throw new Error(`No calendar block with id ${id}`)
  return toBlockWithContext(row)
}

/**
 * A block that ends before it starts is a data error, not a display quirk —
 * it would render as negative height and vanish. Fixed at the boundary so no
 * view has to defend against it.
 */
function normaliseSpan(startsAt: string, endsAt: string): { startsAt: string; endsAt: string } {
  return minutesBetween(startsAt, endsAt) < 0
    ? { startsAt, endsAt: startsAt }
    : { startsAt, endsAt }
}

export function createBlock(db: Database, input: BlockInput): CalendarBlockWithContext {
  const span = normaliseSpan(input.startsAt, input.endsAt)
  const blockType = input.blockType ?? 'meeting'

  db.run(
    `INSERT INTO calendar_blocks
       (title, description, location, block_type, starts_at, ends_at, all_day, timezone,
        project_id, client_id, task_id, colour, billable, recurrence_rule, source,
        source_uid, source_calendar_id, locked, meeting_url, reminder_minutes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             datetime('now'), datetime('now'))`,
    [
      input.title,
      input.description ?? '',
      input.location ?? '',
      blockType,
      span.startsAt,
      span.endsAt,
      input.allDay ? 1 : 0,
      input.timezone ?? 'Europe/London',
      input.projectId ?? null,
      input.clientId ?? null,
      input.taskId ?? null,
      input.colour ?? '',
      // Falls back to what the type usually means, so a focus block is
      // billable and an admin block is not without anybody saying so.
      (input.billable ?? blockTypeMeta(blockType).billable) ? 1 : 0,
      input.recurrenceRule ?? null,
      input.source ?? 'local',
      input.sourceUid ?? null,
      input.sourceCalendarId ?? null,
      input.locked ? 1 : 0,
      input.meetingUrl ?? '',
      input.reminderMinutes ?? null
    ]
  )

  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Calendar block was not created')
  return getBlock(db, row.id)
}

const UPDATABLE: Record<string, string> = {
  title: 'title',
  description: 'description',
  location: 'location',
  blockType: 'block_type',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  allDay: 'all_day',
  timezone: 'timezone',
  projectId: 'project_id',
  clientId: 'client_id',
  taskId: 'task_id',
  colour: 'colour',
  billable: 'billable',
  recurrenceRule: 'recurrence_rule',
  meetingUrl: 'meeting_url',
  reminderMinutes: 'reminder_minutes'
}

export function updateBlock(
  db: Database,
  id: number,
  patch: Partial<BlockInput>
): CalendarBlockWithContext {
  const current = getBlock(db, id)

  // Nothing from a feed is editable. Refused here rather than only in the UI,
  // because the assistant and the IPC layer reach this too.
  if (current.locked) {
    throw new Error('That comes from a calendar you subscribe to, so it cannot be changed here.')
  }

  const span = normaliseSpan(patch.startsAt ?? current.startsAt, patch.endsAt ?? current.endsAt)
  const merged: Partial<BlockInput> = { ...patch, ...span }

  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(merged)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }

  // Moving a block re-arms its reminder: a meeting pushed to tomorrow should
  // warn you again, and one dragged into the past should not fire retroactively.
  if (patch.startsAt !== undefined || patch.reminderMinutes !== undefined) {
    assignments.push('reminded_at = NULL')
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE calendar_blocks SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getBlock(db, id)
}

/** The next blocks starting on or after `from`, for the dashboard and agenda. */
export function upcomingBlocks(
  db: Database,
  from: string,
  limit = 5
): CalendarBlockWithContext[] {
  return db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT}
        WHERE b.ends_at >= ? AND b.archived = 0
        ORDER BY b.starts_at, b.id LIMIT ?`,
      [from, limit]
    )
    .map(toBlockWithContext)
}

/* ------------------------------------------------------------------ *
 * Reminders
 * ------------------------------------------------------------------ */

/** How stale a reminder can be before it is dropped rather than shown. */
export const REMINDER_GRACE_MINUTES = 5

/**
 * Reminders that have come due and not yet fired.
 *
 * Anything whose moment passed more than a few minutes ago is swept up and
 * marked as reminded without a notification: being told about a meeting that
 * started an hour ago, because the app happened to be closed, is noise rather
 * than a reminder. `due` is what to show; `stale` is what to silently retire.
 */
export function dueReminders(
  db: Database,
  now: string
): { due: CalendarBlockWithContext[]; stale: CalendarBlockWithContext[] } {
  const candidates = db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT}
        WHERE b.reminder_minutes IS NOT NULL
          AND b.reminded_at IS NULL
          AND b.archived = 0
          AND b.starts_at >= ?
        ORDER BY b.starts_at`,
      // A day back is plenty of history to consider; anything older is stale by
      // definition and would be swept on the next tick anyway.
      [`${dayOf(now)}T00:00`]
    )
    .map(toBlockWithContext)

  const due: CalendarBlockWithContext[] = []
  const stale: CalendarBlockWithContext[] = []

  for (const block of candidates) {
    const untilStart = minutesBetween(now, block.startsAt)
    const untilReminder = untilStart - (block.reminderMinutes ?? 0)
    if (untilReminder > 0) continue
    if (untilStart < -REMINDER_GRACE_MINUTES) stale.push(block)
    else due.push(block)
  }

  return { due, stale }
}

export function markReminded(db: Database, ids: number[], at: string): void {
  if (ids.length === 0) return
  db.run(
    `UPDATE calendar_blocks SET reminded_at = ? WHERE id IN (${ids.map(() => '?').join(', ')})`,
    [at, ...ids]
  )
}
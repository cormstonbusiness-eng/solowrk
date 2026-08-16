import type { Database, Row } from '../db'
import type {
  CalendarEvent,
  CalendarEventWithContext,
  EventInput,
  EventKind
} from '@shared/types'
import { DEFAULT_EVENT_COLOUR } from '@shared/types'
import { dayOf, minutesBetween } from '@shared/calendar'

interface EventRow extends Row {
  id: number
  title: string
  description: string
  location: string
  starts_at: string
  ends_at: string
  all_day: number
  kind: string
  external_id: string | null
  meeting_url: string
  project_id: number | null
  client_id: number | null
  colour: string
  reminder_minutes: number | null
  reminded_at: string | null
  created_at: string
  updated_at: string
}

type ContextRow = EventRow & {
  project_name: string | null
  project_colour: string | null
  client_name: string | null
}

function toEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day === 1,
    kind: row.kind as EventKind,
    externalId: row.external_id,
    meetingUrl: row.meeting_url,
    projectId: row.project_id,
    clientId: row.client_id,
    colour: row.colour,
    reminderMinutes: row.reminder_minutes,
    remindedAt: row.reminded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toEventWithContext(row: ContextRow): CalendarEventWithContext {
  return {
    ...toEvent(row),
    projectName: row.project_name,
    projectColour: row.project_colour,
    clientName: row.client_name,
    // Resolved here rather than in the renderer so the month, week, day and
    // agenda views cannot disagree about what colour an event is.
    displayColour: row.colour || row.project_colour || DEFAULT_EVENT_COLOUR
  }
}

const SELECT_WITH_CONTEXT = `
  SELECT e.*,
         p.name   AS project_name,
         p.colour AS project_colour,
         c.name   AS client_name
    FROM events e
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN clients  c ON c.id = e.client_id
`

/**
 * Events overlapping the day range `from`..`to`, both inclusive.
 *
 * The comparison is on the date half of each stamp, so an event that starts
 * at 23:00 on the last day of the range is included whole rather than clipped
 * out by a `'2026-08-31' < '2026-08-31T23:00'` string comparison.
 */
export function listEvents(
  db: Database,
  range: { from: string; to: string; projectId?: number }
): CalendarEventWithContext[] {
  const conditions = ['substr(e.ends_at, 1, 10) >= ?', 'substr(e.starts_at, 1, 10) <= ?']
  const params: (string | number)[] = [range.from, range.to]

  if (range.projectId !== undefined) {
    conditions.push('e.project_id = ?')
    params.push(range.projectId)
  }

  return db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT} WHERE ${conditions.join(' AND ')} ORDER BY e.starts_at, e.id`,
      params
    )
    .map(toEventWithContext)
}

export function getEvent(db: Database, id: number): CalendarEventWithContext {
  const row = db.get<ContextRow>(`${SELECT_WITH_CONTEXT} WHERE e.id = ?`, [id])
  if (!row) throw new Error(`No event with id ${id}`)
  return toEventWithContext(row)
}

/**
 * An event that ends before it starts is a data error, not a display quirk —
 * it would render as negative height and vanish. Fixed at the boundary so no
 * view has to defend against it.
 */
function normaliseSpan(startsAt: string, endsAt: string): { startsAt: string; endsAt: string } {
  return minutesBetween(startsAt, endsAt) < 0
    ? { startsAt, endsAt: startsAt }
    : { startsAt, endsAt }
}

export function createEvent(db: Database, input: EventInput): CalendarEventWithContext {
  const span = normaliseSpan(input.startsAt, input.endsAt)

  db.run(
    `INSERT INTO events (title, description, location, starts_at, ends_at, all_day, kind,
                         external_id, meeting_url, project_id, client_id, colour,
                         reminder_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.title,
      input.description ?? '',
      input.location ?? '',
      span.startsAt,
      span.endsAt,
      input.allDay ? 1 : 0,
      input.kind ?? 'local',
      input.externalId ?? null,
      input.meetingUrl ?? '',
      input.projectId ?? null,
      input.clientId ?? null,
      input.colour ?? '',
      input.reminderMinutes ?? null
    ]
  )

  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Event was not created')
  return getEvent(db, row.id)
}

const UPDATABLE: Record<string, string> = {
  title: 'title',
  description: 'description',
  location: 'location',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  allDay: 'all_day',
  kind: 'kind',
  externalId: 'external_id',
  meetingUrl: 'meeting_url',
  projectId: 'project_id',
  clientId: 'client_id',
  colour: 'colour',
  reminderMinutes: 'reminder_minutes'
}

export function updateEvent(
  db: Database,
  id: number,
  patch: Partial<EventInput>
): CalendarEventWithContext {
  const current = getEvent(db, id)
  const span = normaliseSpan(patch.startsAt ?? current.startsAt, patch.endsAt ?? current.endsAt)
  const merged: Partial<EventInput> = { ...patch, ...span }

  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(merged)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }

  // Moving an event re-arms its reminder: a meeting pushed to tomorrow should
  // warn you again, and one dragged into the past should not fire retroactively.
  if (patch.startsAt !== undefined || patch.reminderMinutes !== undefined) {
    assignments.push('reminded_at = NULL')
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE events SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  return getEvent(db, id)
}

export function deleteEvent(db: Database, id: number): void {
  db.run('DELETE FROM events WHERE id = ?', [id])
}

/** The next events starting on or after `from`, for the dashboard and agenda. */
export function upcomingEvents(
  db: Database,
  from: string,
  limit = 5
): CalendarEventWithContext[] {
  return db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT} WHERE e.ends_at >= ? ORDER BY e.starts_at, e.id LIMIT ?`,
      [from, limit]
    )
    .map(toEventWithContext)
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
): { due: CalendarEventWithContext[]; stale: CalendarEventWithContext[] } {
  const candidates = db
    .all<ContextRow>(
      `${SELECT_WITH_CONTEXT}
        WHERE e.reminder_minutes IS NOT NULL
          AND e.reminded_at IS NULL
          AND e.starts_at >= ?
        ORDER BY e.starts_at`,
      // A day back is plenty of history to consider; anything older is stale by
      // definition and would be swept on the next tick anyway.
      [`${dayOf(now)}T00:00`]
    )
    .map(toEventWithContext)

  const due: CalendarEventWithContext[] = []
  const stale: CalendarEventWithContext[] = []

  for (const event of candidates) {
    const untilStart = minutesBetween(now, event.startsAt)
    const untilReminder = untilStart - (event.reminderMinutes ?? 0)
    if (untilReminder > 0) continue
    if (untilStart < -REMINDER_GRACE_MINUTES) stale.push(event)
    else due.push(event)
  }

  return { due, stale }
}

export function markReminded(db: Database, ids: number[], at: string): void {
  if (ids.length === 0) return
  db.run(
    `UPDATE events SET reminded_at = ? WHERE id IN (${ids.map(() => '?').join(', ')})`,
    [at, ...ids]
  )
}

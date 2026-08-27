import type { Database, Row } from '../db'
import type { CalendarSubscription } from '@shared/types'
import { parseIcs, writeIcs, type IcsEvent } from '@shared/ics'
import { listBlocks } from './blocks'

/**
 * Calendars somebody else owns.
 *
 * The only outward-facing thing in the module, and the whole of what it does
 * is an HTTP GET. No account is connected, nothing is written back, and no
 * workspace data leaves the machine — which is why the settings panel says so
 * in `SUBSCRIPTION_PROMISE` rather than in a help article somebody will never
 * read. A local-first app that goes near a network has to explain itself where
 * the feature lives.
 */

/** Shown verbatim in the subscription panel. Required by the specification. */
export const SUBSCRIPTION_PROMISE =
  'SoloWrk downloads this calendar. It never uploads your SoloWrk data.'

/** A feed that answers slowly is a feed that is broken, for our purposes. */
const FETCH_TIMEOUT_MS = 15_000

/** Enough for a busy shared calendar; small enough that nothing runs away. */
const MAX_FEED_BYTES = 8 * 1024 * 1024

interface SubscriptionRow extends Row {
  id: number
  name: string
  url: string
  colour: string
  visible: number
  last_synced_at: string | null
  last_status: string
  sync_error: string
  refresh_minutes: number
  created_at: string
  updated_at: string
}

function toSubscription(row: SubscriptionRow): CalendarSubscription {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    colour: row.colour,
    visible: row.visible === 1,
    lastSyncedAt: row.last_synced_at,
    lastStatus: row.last_status,
    syncError: row.sync_error,
    refreshMinutes: row.refresh_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listSubscriptions(db: Database): CalendarSubscription[] {
  return db
    .all<SubscriptionRow>('SELECT * FROM calendar_subscriptions ORDER BY name, id')
    .map(toSubscription)
}

export function getSubscription(db: Database, id: number): CalendarSubscription {
  const row = db.get<SubscriptionRow>('SELECT * FROM calendar_subscriptions WHERE id = ?', [id])
  if (!row) throw new Error(`No subscription with id ${id}`)
  return toSubscription(row)
}

/**
 * Only http and https, and never a local file.
 *
 * `file:` would turn a subscription URL into a way to read anything on the
 * disk, and the whole point of a subscription is that it is somebody else's
 * calendar on the web.
 */
function checkUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim().replace(/^webcal:/i, 'https:'))
  } catch {
    throw new Error('That does not look like a calendar address.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('A calendar address has to start with http:// or https://')
  }
  return parsed.toString()
}

export function createSubscription(
  db: Database,
  input: { name: string; url: string; colour?: string; refreshMinutes?: number }
): CalendarSubscription {
  const url = checkUrl(input.url)
  db.run(
    `INSERT INTO calendar_subscriptions (name, url, colour, refresh_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [input.name.trim() || 'Calendar', url, input.colour ?? '#8a8a93', input.refreshMinutes ?? 60]
  )
  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Subscription was not created')
  return getSubscription(db, row.id)
}

const UPDATABLE: Record<string, string> = {
  name: 'name',
  colour: 'colour',
  visible: 'visible',
  refreshMinutes: 'refresh_minutes'
}

export function updateSubscription(
  db: Database,
  id: number,
  patch: Partial<CalendarSubscription>
): CalendarSubscription {
  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number))
  }

  // The URL is deliberately not updatable. Pointing an existing subscription
  // at a different feed would strand every block it had already pulled in,
  // since reconciliation is by UID and the new feed's UIDs are all different.
  // Removing it and adding another says what is actually happening.
  if (assignments.length > 0) {
    db.run(
      `UPDATE calendar_subscriptions SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getSubscription(db, id)
}

/**
 * Removing a subscription takes its blocks with it.
 *
 * They are not the user's — they are a cached copy of somebody else's
 * calendar, and leaving them behind would be leaving unowned, uneditable rows
 * in a diary with nothing to explain them. Anything copied to the user's own
 * calendar is a separate block and stays.
 */
export function deleteSubscription(db: Database, id: number): void {
  db.run('DELETE FROM calendar_subscriptions WHERE id = ?', [id])
}

/* ------------------------------------------------------------------ *
 * Syncing
 * ------------------------------------------------------------------ */

export interface SyncResult {
  added: number
  updated: number
  removed: number
  /** Set when the feed could not be read. Never thrown at the UI. */
  error: string | null
}

/**
 * Fetch a feed and reconcile it.
 *
 * Failure comes back in the result rather than as an exception, because a
 * broken feed must not interrupt anybody's work. The UI shows a dot on the
 * subscription in settings and nothing else — never a modal.
 */
export async function syncSubscription(
  db: Database,
  id: number,
  fetchImpl: typeof fetch = fetch
): Promise<SyncResult> {
  const subscription = getSubscription(db, id)

  let text: string
  try {
    text = await download(subscription.url, fetchImpl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the calendar'
    db.run(
      `UPDATE calendar_subscriptions
          SET last_status = 'error', sync_error = ?, last_synced_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
      [message, id]
    )
    return { added: 0, updated: 0, removed: 0, error: message }
  }

  const events = parseIcs(text)
  const result = reconcile(db, subscription, events)

  db.run(
    `UPDATE calendar_subscriptions
        SET last_status = 'ok', sync_error = '', last_synced_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ?`,
    [id]
  )

  return result
}

async function download(url: string, fetchImpl: typeof fetch): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      // Nothing identifying, and nothing from the workspace. The request is
      // the URL and that is all.
      headers: { Accept: 'text/calendar, text/plain' },
      redirect: 'follow'
    })

    if (!response.ok) throw new Error(`The calendar returned ${response.status}`)

    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_FEED_BYTES) throw new Error('That calendar is too large to read')

    const text = await response.text()
    if (text.length > MAX_FEED_BYTES) throw new Error('That calendar is too large to read')
    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The calendar took too long to answer')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Make the stored blocks match the feed.
 *
 * By UID, in one transaction: update what changed, add what is new, remove
 * what has gone. Never a delete-then-insert — that would burn a fresh id on
 * every unchanged event every hour, and anything the user had linked or
 * tagged against one would be pointing at nothing by lunchtime.
 */
function reconcile(
  db: Database,
  subscription: CalendarSubscription,
  events: IcsEvent[]
): SyncResult {
  return db.transaction(() => {
    const existing = new Map(
      db
        .all<Row & { id: number; source_uid: string }>(
          'SELECT id, source_uid FROM calendar_blocks WHERE source_calendar_id = ?',
          [subscription.id]
        )
        .map((row) => [row.source_uid, row.id])
    )

    let added = 0
    let updated = 0
    const seen = new Set<string>()

    for (const event of events) {
      seen.add(event.uid)
      const id = existing.get(event.uid)

      if (id === undefined) {
        db.run(
          `INSERT INTO calendar_blocks
             (title, description, location, block_type, starts_at, ends_at, all_day,
              colour, billable, recurrence_rule, recurrence_exdates, source, source_uid,
              source_calendar_id, locked, meeting_url, created_at, updated_at)
           VALUES (?, ?, ?, 'external', ?, ?, ?, ?, 0, ?, ?, 'ics_subscription', ?, ?, 1, ?,
                   datetime('now'), datetime('now'))`,
          [
            event.summary,
            event.description,
            event.location,
            event.startsAt,
            event.endsAt,
            event.allDay ? 1 : 0,
            subscription.colour,
            event.rrule,
            event.exdates.join(','),
            event.uid,
            subscription.id,
            event.url
          ]
        )
        added += 1
      } else {
        db.run(
          `UPDATE calendar_blocks
              SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?,
                  all_day = ?, recurrence_rule = ?, recurrence_exdates = ?, meeting_url = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
          [
            event.summary,
            event.description,
            event.location,
            event.startsAt,
            event.endsAt,
            event.allDay ? 1 : 0,
            event.rrule,
            event.exdates.join(','),
            event.url,
            id
          ]
        )
        updated += 1
      }
    }

    let removed = 0
    for (const [uid, id] of existing) {
      if (seen.has(uid)) continue
      db.run('DELETE FROM calendar_blocks WHERE id = ?', [id])
      removed += 1
    }

    return { added, updated, removed, error: null }
  })
}

/**
 * Which subscriptions are due a refresh.
 *
 * Asked on launch and on the reminder tick. A feed with no successful sync
 * behind it is always due, so a subscription added while offline picks
 * itself up as soon as there is a connection.
 */
export function dueSubscriptions(db: Database, now: Date = new Date()): CalendarSubscription[] {
  return listSubscriptions(db).filter((one) => {
    if (!one.lastSyncedAt) return true
    const last = Date.parse(`${one.lastSyncedAt.replace(' ', 'T')}Z`)
    if (Number.isNaN(last)) return true
    return now.getTime() - last >= one.refreshMinutes * 60_000
  })
}

/* ------------------------------------------------------------------ *
 * Copying out
 * ------------------------------------------------------------------ */

/**
 * Take a locked block into the user's own calendar.
 *
 * The correct answer to "a client sent me a meeting invite and I need to plan
 * around it": the original stays as the record of what they said, and the copy
 * is yours to move, colour and bill against.
 */
export function copyToMyCalendar(db: Database, blockId: number): number {
  const row = db.get<Row & Record<string, never>>(
    'SELECT * FROM calendar_blocks WHERE id = ?',
    [blockId]
  )
  if (!row) throw new Error(`No calendar block with id ${blockId}`)

  db.run(
    `INSERT INTO calendar_blocks
       (title, description, location, block_type, starts_at, ends_at, all_day, timezone,
        colour, billable, recurrence_rule, recurrence_exdates, source, locked,
        meeting_url, reminder_minutes, created_at, updated_at)
     SELECT title, description, location, 'meeting', starts_at, ends_at, all_day, timezone,
            '', 0, recurrence_rule, recurrence_exdates, 'ics_import', 0,
            meeting_url, reminder_minutes, datetime('now'), datetime('now')
       FROM calendar_blocks WHERE id = ?`,
    [blockId]
  )

  const created = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!created) throw new Error('The copy was not made')
  return created.id
}

/* ------------------------------------------------------------------ *
 * Import and export
 * ------------------------------------------------------------------ */

/**
 * Read an .ics file into the user's own calendar.
 *
 * Unlocked and editable, unlike a subscription: a file somebody sent you is
 * yours once it is in, and there is nothing to keep it in step with.
 */
export function importIcs(db: Database, text: string): number {
  const events = parseIcs(text)

  return db.transaction(() => {
    let added = 0
    for (const event of events) {
      // By UID, so importing the same file twice does not double everything.
      const already = db.get<Row & { id: number }>(
        `SELECT id FROM calendar_blocks WHERE source = 'ics_import' AND source_uid = ?`,
        [event.uid]
      )
      if (already) continue

      db.run(
        `INSERT INTO calendar_blocks
           (title, description, location, block_type, starts_at, ends_at, all_day,
            recurrence_rule, recurrence_exdates, source, source_uid, meeting_url,
            created_at, updated_at)
         VALUES (?, ?, ?, 'meeting', ?, ?, ?, ?, ?, 'ics_import', ?, ?,
                 datetime('now'), datetime('now'))`,
        [
          event.summary,
          event.description,
          event.location,
          event.startsAt,
          event.endsAt,
          event.allDay ? 1 : 0,
          event.rrule,
          event.exdates.join(','),
          event.uid,
          event.url
        ]
      )
      added += 1
    }
    return added
  })
}

/** The user's own blocks in a range, as an .ics file. Never anybody else's. */
export function exportIcs(
  db: Database,
  range: { from: string; to: string; blockTypes?: string[] }
): string {
  const blocks = listBlocks(db, { from: range.from, to: range.to })
    .filter((block) => block.source === 'local')
    .filter((block) => !range.blockTypes || range.blockTypes.includes(block.blockType))
    // A generated occurrence is not a row, and its series is already in the
    // list carrying the rule that produces it.
    .filter((block) => block.occurrenceOf === null)

  return writeIcs(
    blocks.map((block) => ({
      id: block.id,
      title: block.title,
      description: block.description,
      location: block.location,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      allDay: block.allDay,
      recurrenceRule: block.recurrenceRule,
      updatedAt: block.updatedAt
    }))
  )
}

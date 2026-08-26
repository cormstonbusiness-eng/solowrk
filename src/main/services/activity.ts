import type { Database, Row } from '../db'
import { ENTITY_SOURCES } from '../db/entities'
import type { ActivityAction, ActivityEntry, EntityRef, EntityType } from '@shared/types'

/**
 * What happened to a thing, and when.
 *
 * Nothing in this file writes. The `activity` table is filled by SQLite
 * triggers (migration 18), which is what makes the history complete rather than
 * merely well-intentioned: the assistant's tools, the automation actions, the
 * recurring-invoice run and the seed script all go through SQL, and none of
 * them has to remember to call anything.
 *
 * The one thing a reader has to know: edits are coalesced by the trigger into
 * one entry per ten minutes. An 'edited' line means a sitting, not a keystroke.
 */

interface ActivityRow extends Row {
  id: number
  entity_type: string
  entity_id: number
  action: string
  detail: string
  at: string
}

function toEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    action: row.action as ActivityAction,
    detail: row.detail,
    at: row.at
  }
}

/** How much history one panel asks for. */
export const ACTIVITY_LIMIT = 100

/** One thing's history, newest first. */
export function activityFor(db: Database, ref: EntityRef, limit = ACTIVITY_LIMIT): ActivityEntry[] {
  return db
    .all<ActivityRow>(
      `SELECT * FROM activity
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY at DESC, id DESC
        LIMIT ?`,
      [ref.type, ref.id, limit]
    )
    .map(toEntry)
}

/**
 * Everything that has happened lately, across the whole workspace.
 *
 * The 'what did I do this week' view. Ordered by id after time because several
 * rows can share a second — creating a project writes the project and its
 * scaffolding in one transaction — and id is the only tiebreak that keeps the
 * order they actually happened in.
 */
export function recentActivity(db: Database, limit = ACTIVITY_LIMIT): ActivityEntry[] {
  return db
    .all<ActivityRow>('SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT ?', [limit])
    .map(toEntry)
}

/**
 * Turn one entry into the line that gets rendered.
 *
 * Here rather than in the renderer because the assistant and the weekly review
 * want the same sentence, and two copies of this would drift.
 */
export function describeActivity(entry: ActivityEntry): string {
  const noun = NOUNS[entry.entityType]
  if (entry.action === 'created') {
    return entry.detail ? `Created ${noun} ${entry.detail}` : `Created a ${noun}`
  }
  if (entry.action === 'status') {
    return entry.detail ? `Moved from ${entry.detail}` : `Status changed`
  }
  return `Edited`
}

const NOUNS: Record<EntityType, string> = {
  client: 'client',
  project: 'project',
  task: 'task',
  invoice: 'invoice',
  quote: 'quote',
  note: 'note',
  document: 'document',
  expense: 'expense',
  block: 'block'
}

/**
 * Forget the history of things that no longer exist.
 *
 * The table is polymorphic, so no foreign key can cascade. Deleting a client
 * takes their projects and invoices with it and leaves their timelines behind,
 * which is a slow leak rather than a bug — but a workspace open for three years
 * should not be carrying the history of everything ever deleted.
 *
 * Run from the daily sweep, beside `pruneLinks`.
 */
export function pruneActivity(db: Database): number {
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity')!.n
  // Rows of a type this build does not recognise are left alone, for the same
  // reason pruneLinks leaves them: a newer version sharing the workspace.
  const where = Object.entries(ENTITY_SOURCES)
    .map(
      ([type, source]) =>
        `(entity_type = '${type}' AND entity_id NOT IN (SELECT id FROM ${source.table}))`
    )
    .join(' OR ')
  db.run(`DELETE FROM activity WHERE ${where}`)
  return before - db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity')!.n
}

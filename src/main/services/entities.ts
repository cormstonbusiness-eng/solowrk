import type { Database } from '../db'
import { ENTITY_SOURCES } from '../db/entities'
import { ENTITY_TYPES } from '@shared/types'
import type { EntityRef, EntityType, LinkedEntity } from '@shared/types'

/**
 * Looking a row up by nothing but its type and id.
 *
 * The detail drawer opens on a ref out of the URL and has to draw a heading
 * before it knows anything else, and the link picker has to offer rows across
 * eight tables. Both are the same question — "what is this, and what is it
 * called" — and both answer it from `ENTITY_SOURCES` rather than from eight
 * bespoke queries that would each need maintaining.
 *
 * This is not global search. That comes later, ranks across types, and looks at
 * more than the name; this looks at exactly the label the app already shows, in
 * one type at a time, because that is what a picker needs.
 */

/** What one row is called, or null when it has gone. */
export function labelFor(db: Database, ref: EntityRef): string | null {
  const source = ENTITY_SOURCES[ref.type]
  const row = db.get<{ label: string }>(
    `SELECT ${source.label('e')} AS label FROM ${source.table} e WHERE e.id = ?`,
    [ref.id]
  )
  return row?.label ?? null
}

/** How many candidates one picker query returns. */
export const FIND_LIMIT = 20

/**
 * Rows of one type whose name contains `query`.
 *
 * Contains rather than starts-with: somebody looking for the Acme rebrand
 * types "rebrand", not "Acme". Empty query returns the most recent, so opening
 * the picker shows something to pick rather than a blank box.
 */
export function findEntities(
  db: Database,
  type: EntityType,
  query: string,
  limit = FIND_LIMIT
): LinkedEntity[] {
  const source = ENTITY_SOURCES[type]
  const label = source.label('e')
  const trimmed = query.trim()

  // LIKE with the pattern as a parameter, so a name containing % or _ is
  // matched literally rather than as a wildcard.
  const rows = trimmed
    ? db.all<{ id: number; label: string }>(
        `SELECT e.id AS id, ${label} AS label FROM ${source.table} e
          WHERE ${label} LIKE '%' || ? || '%' ESCAPE '\\'
          ORDER BY e.id DESC LIMIT ?`,
        [escapeLike(trimmed), limit]
      )
    : db.all<{ id: number; label: string }>(
        `SELECT e.id AS id, ${label} AS label FROM ${source.table} e
          ORDER BY e.id DESC LIMIT ?`,
        [limit]
      )

  return rows.map((row) => ({
    type,
    id: row.id,
    label: row.label,
    relationship: 'related',
    structural: false
  }))
}

/** Everything of every type matching, for a picker that has not been narrowed. */
export function findAcrossTypes(db: Database, query: string, limit = FIND_LIMIT): LinkedEntity[] {
  const perType = Math.max(3, Math.ceil(limit / ENTITY_TYPES.length))
  return ENTITY_TYPES.flatMap((type) => findEntities(db, type, query, perType)).slice(0, limit)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

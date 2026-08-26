import type { Database } from '../db'
import { ENTITY_SOURCES } from '../db/entities'
import { canArchive } from '@shared/types'
import type { EntityRef } from '@shared/types'

/**
 * Putting something away without deleting it.
 *
 * One function for every type that has the column, rather than an `archive`
 * beside every `update`. Projects and tasks had this and their own buttons for
 * it; notes and documents grew the column in migration 20 and reach it through
 * the same door.
 *
 * Invoices and quotes are deliberately left out. An invoice already has a
 * status that says where it is in its life, and a second axis for "put this
 * away" would mean two answers to the question of where an invoice went. A
 * paid invoice is filed by being paid.
 */

/**
 * File something away, or bring it back.
 *
 * `archived_at` is written from the flag rather than trusted from a caller,
 * for the same reason `completed_at` is derived from status: "when was this
 * filed away" must not be able to drift from "is this filed away".
 */
export function setArchived(db: Database, ref: EntityRef, archived: boolean): void {
  if (!canArchive(ref.type)) {
    throw new Error(`A ${ref.type} cannot be archived.`)
  }

  const table = ENTITY_SOURCES[ref.type].table
  const found = db.get('SELECT 1 AS found FROM ' + table + ' WHERE id = ?', [ref.id])
  if (!found) throw new Error('That has gone.')

  db.run(
    `UPDATE ${table}
        SET archived = ?, archived_at = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [archived ? 1 : 0, archived ? new Date().toISOString() : null, ref.id]
  )
}

export function isArchived(db: Database, ref: EntityRef): boolean {
  if (!canArchive(ref.type)) return false
  const table = ENTITY_SOURCES[ref.type].table
  const row = db.get<{ archived: number }>(`SELECT archived FROM ${table} WHERE id = ?`, [ref.id])
  return row?.archived === 1
}

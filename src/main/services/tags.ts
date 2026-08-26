import type { Database, Row, SqlValue } from '../db'
import { ENTITY_SOURCES } from '../db/entities'
import { ENTITY_TYPES } from '@shared/types'
import type { EntityRef, EntityType, Tag, TagWithCount } from '@shared/types'

/**
 * One vocabulary of tags, shared by everything.
 *
 * The point of a single vocabulary is that "urgent" means the same on a task,
 * an invoice and a document, so it can be renamed once, coloured once and
 * counted across all of them. That is what free text on each table could never
 * do — see migration 22 for what it replaced.
 */

interface TagRow extends Row {
  id: number
  name: string
  colour: string
  created_at: string
}

function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, colour: row.colour }
}

/** The default colour, matching the neutral pill used elsewhere. */
export const DEFAULT_TAG_COLOUR = '#8a8a93'

export function listTags(db: Database): TagWithCount[] {
  return db
    .all<TagRow & { uses: number }>(
      `SELECT t.*, COUNT(e.tag_id) AS uses
         FROM tags t
         LEFT JOIN entity_tags e ON e.tag_id = t.id
        GROUP BY t.id
        ORDER BY t.name COLLATE NOCASE`
    )
    .map((row) => ({ ...toTag(row), uses: row.uses }))
}

/**
 * Find a tag by name, or make it.
 *
 * Case-insensitive, and returns the existing one rather than a second copy:
 * typing "Urgent" when "urgent" exists must not produce two tags that look
 * identical in a filter list.
 */
export function ensureTag(db: Database, name: string, colour?: string): Tag {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A tag needs a name.')

  const existing = db.get<TagRow>('SELECT * FROM tags WHERE name = ? COLLATE NOCASE', [trimmed])
  if (existing) return toTag(existing)

  db.run(`INSERT INTO tags (name, colour, created_at) VALUES (?, ?, datetime('now'))`, [
    trimmed,
    colour ?? DEFAULT_TAG_COLOUR
  ])
  const id = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  return toTag(db.get<TagRow>('SELECT * FROM tags WHERE id = ?', [id])!)
}

export function renameTag(db: Database, id: number, name: string): Tag {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A tag needs a name.')

  const clash = db.get<TagRow>('SELECT * FROM tags WHERE name = ? COLLATE NOCASE AND id != ?', [
    trimmed,
    id
  ])
  if (clash) throw new Error(`There is already a tag called “${clash.name}”.`)

  db.run('UPDATE tags SET name = ? WHERE id = ?', [trimmed, id])
  return toTag(db.get<TagRow>('SELECT * FROM tags WHERE id = ?', [id])!)
}

export function recolourTag(db: Database, id: number, colour: string): void {
  db.run('UPDATE tags SET colour = ? WHERE id = ?', [colour, id])
}

/** Remove a tag from the vocabulary, and from everything carrying it. */
export function deleteTag(db: Database, id: number): void {
  db.run('DELETE FROM tags WHERE id = ?', [id])
}

export function tagsFor(db: Database, ref: EntityRef): Tag[] {
  return db
    .all<TagRow>(
      `SELECT t.* FROM tags t
         JOIN entity_tags e ON e.tag_id = t.id
        WHERE e.entity_type = ? AND e.entity_id = ?
        ORDER BY t.name COLLATE NOCASE`,
      [ref.type, ref.id]
    )
    .map(toTag)
}

/** Every tag on a set of records at once, so a list draws in one query. */
export function tagsForMany(
  db: Database,
  type: EntityType,
  ids: number[]
): Record<number, Tag[]> {
  if (ids.length === 0) return {}

  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.all<TagRow & { entity_id: number }>(
    `SELECT t.*, e.entity_id FROM tags t
       JOIN entity_tags e ON e.tag_id = t.id
      WHERE e.entity_type = ? AND e.entity_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE`,
    [type, ...(ids as SqlValue[])]
  )

  const byId: Record<number, Tag[]> = {}
  for (const row of rows) {
    ;(byId[row.entity_id] ??= []).push(toTag(row))
  }
  return byId
}

/** Put a tag on something. Silent when it is already there. */
export function tag(db: Database, ref: EntityRef, tagId: number): void {
  db.run(
    `INSERT OR IGNORE INTO entity_tags (tag_id, entity_type, entity_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [tagId, ref.type, ref.id]
  )
}

export function untag(db: Database, ref: EntityRef, tagId: number): void {
  db.run('DELETE FROM entity_tags WHERE tag_id = ? AND entity_type = ? AND entity_id = ?', [
    tagId,
    ref.type,
    ref.id
  ])
}

/**
 * The records of one type carrying every one of these tags.
 *
 * Every, not any. Two tags in a filter narrows — "urgent" and "design" means
 * the things that are both, which is what a second chip is for. Any-of would
 * make each extra chip widen the list, and nobody adds a filter hoping for
 * more results.
 */
export function taggedIds(db: Database, type: EntityType, tagIds: number[]): number[] {
  if (tagIds.length === 0) return []

  const placeholders = tagIds.map(() => '?').join(', ')
  return db
    .all<{ entity_id: number }>(
      `SELECT entity_id FROM entity_tags
        WHERE entity_type = ? AND tag_id IN (${placeholders})
        GROUP BY entity_id
       HAVING COUNT(DISTINCT tag_id) = ?`,
      [type, ...(tagIds as SqlValue[]), tagIds.length]
    )
    .map((row) => row.entity_id)
}

/**
 * Drop tag rows whose record has gone.
 *
 * The same housekeeping as `pruneLinks`, and for the same reason: the table is
 * polymorphic, so nothing cascades when a tagged record is deleted. A type this
 * build does not recognise is left alone, in case a newer version is sharing
 * the workspace.
 */
export function pruneTags(db: Database): number {
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entity_tags')!.n
  const where = ENTITY_TYPES.map(
    (type) =>
      `(entity_type = '${type}' AND entity_id NOT IN (SELECT id FROM ${ENTITY_SOURCES[type].table}))`
  ).join(' OR ')
  db.run(`DELETE FROM entity_tags WHERE ${where}`)
  return before - db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entity_tags')!.n
}

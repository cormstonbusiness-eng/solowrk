import type { Database, Row, SqlValue } from '../db'
import { ENTITY_SOURCES } from '../db/entities'
import { ENTITY_TYPES } from '@shared/types'
import type { EntityRef, EntityType, TrashEntry } from '@shared/types'
import { labelFor } from './entities'
import { RETENTION_DAYS } from '@shared/retention'

/**
 * Deleting something without losing it.
 *
 * The row really is removed from its own table. A `deleted_at` column on all
 * eight tables would mean every query in the app carrying `AND deleted_at IS
 * NULL`, and the day somebody writes a report and forgets, a deleted invoice
 * appears in a tax year. Here the delete is a real delete and what it takes
 * with it is captured first.
 *
 * The dependency graph comes from `PRAGMA foreign_key_list`, which is to say
 * from the schema itself. A hand-written list of "what a project owns" would
 * be right today and wrong the first time somebody adds a table, and being
 * wrong here means silently failing to capture something.
 */

// Shared with the trash page, which says the number out loud.
export { RETENTION_DAYS } from '@shared/retention'

interface ForeignKey {
  /** The table holding the column. */
  child: string
  column: string
  parent: string
  /** 'CASCADE' takes the child with it; 'SET NULL' merely detaches it. */
  onDelete: string
}

interface CapturedRows {
  table: string
  rows: Row[]
}

interface Detached {
  table: string
  column: string
  ids: number[]
}

interface Payload {
  /** Parent first, so re-inserting in order never violates a key. */
  captured: CapturedRows[]
  detached: Detached[]
  /** Links and activity, which no foreign key covers. */
  links: Row[]
  activity: Row[]
  /**
   * Workspace-relative files that go when the entry is finally purged.
   *
   * Note bodies only. A note's .md is scaffolding the app wrote, and leaving
   * one behind for every deleted note litters a project folder the user looks
   * at. A document or a receipt is the opposite — the user's own file, which
   * they put there, and which the app has no business removing just because it
   * has stopped tracking it. That is already how deleting a document behaves,
   * and this keeps it that way.
   */
  files: string[]
}

/**
 * Every foreign key in the database, read from the database.
 *
 * Cached per connection: the schema does not change while the app is running,
 * and reading twenty tables' worth of pragma on every delete would be silly.
 */
const keysByConnection = new WeakMap<Database, ForeignKey[]>()

function foreignKeys(db: Database): ForeignKey[] {
  const cached = keysByConnection.get(db)
  if (cached) return cached

  const tables = db
    .all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    .map((row) => row.name)

  const keys: ForeignKey[] = []
  for (const table of tables) {
    for (const key of db.all<{ table: string; from: string; on_delete: string }>(
      `PRAGMA foreign_key_list(${table})`
    )) {
      keys.push({
        child: table,
        column: key.from,
        parent: key.table,
        onDelete: key.on_delete.toUpperCase()
      })
    }
  }

  keysByConnection.set(db, keys)
  return keys
}

/** The type a table belongs to, for the tables that have one. */
function typeOfTable(table: string): EntityType | null {
  return ENTITY_TYPES.find((type) => ENTITY_SOURCES[type].table === table) ?? null
}

/**
 * Walk everything the delete is about to take.
 *
 * Depth-first through the cascades, parent recorded before its children, so
 * the list can be re-inserted top to bottom without a key ever pointing at
 * something that is not there yet.
 */
function collect(
  db: Database,
  table: string,
  ids: number[],
  captured: CapturedRows[],
  detached: Detached[],
  seen: Set<string>
): void {
  if (ids.length === 0) return

  const fresh = ids.filter((id) => !seen.has(`${table}:${id}`))
  if (fresh.length === 0) return
  for (const id of fresh) seen.add(`${table}:${id}`)

  const placeholders = fresh.map(() => '?').join(', ')
  const rows = db.all<Row>(
    `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
    fresh as SqlValue[]
  )
  if (rows.length === 0) return

  const existing = captured.find((entry) => entry.table === table)
  if (existing) existing.rows.push(...rows)
  else captured.push({ table, rows })

  for (const key of foreignKeys(db)) {
    if (key.parent !== table) continue

    const children = db.all<{ id: number }>(
      `SELECT id FROM ${key.child} WHERE ${key.column} IN (${placeholders})`,
      fresh as SqlValue[]
    )
    if (children.length === 0) continue

    if (key.onDelete === 'CASCADE') {
      collect(
        db,
        key.child,
        children.map((row) => row.id),
        captured,
        detached,
        seen
      )
    } else if (key.onDelete === 'SET NULL') {
      // Not taken, only cut loose. Restoring has to tie it back on, or a
      // restored client comes back with none of their projects.
      detached.push({
        table: key.child,
        column: key.column,
        ids: children.map((row) => row.id)
      })
    }
  }
}

/**
 * Delete something, keeping everything needed to put it back.
 *
 * Returns the trash entry, whose id is what an undo needs.
 */
export function trashEntity(db: Database, ref: EntityRef): TrashEntry {
  const source = ENTITY_SOURCES[ref.type]
  const label = labelFor(db, ref)
  if (label === null) throw new Error('That has already gone.')

  return db.transaction(() => {
    const captured: CapturedRows[] = []
    const detached: Detached[] = []
    collect(db, source.table, [ref.id], captured, detached, new Set())

    // Links and activity are polymorphic, so no foreign key reaches them and
    // the cascade walk above cannot see them. Without this a restored client
    // comes back with no history and none of the connections somebody drew.
    const links: Row[] = []
    const activity: Row[] = []
    for (const entry of captured) {
      const type = typeOfTable(entry.table)
      if (!type) continue
      for (const row of entry.rows) {
        const id = row.id as number
        links.push(
          ...db.all<Row>(
            `SELECT * FROM links
              WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)`,
            [type, id, type, id]
          )
        )
        activity.push(
          ...db.all<Row>('SELECT * FROM activity WHERE entity_type = ? AND entity_id = ?', [
            type,
            id
          ])
        )
      }
    }

    const files = (captured.find((entry) => entry.table === 'notes')?.rows ?? [])
      .map((row) => row.file)
      .filter((file): file is string => typeof file === 'string' && file !== '')

    const payload: Payload = { captured, detached, links, activity, files }

    db.run(
      `INSERT INTO trash (entity_type, entity_id, label, summary, payload, deleted_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [ref.type, ref.id, label, summarise(captured, source.table), JSON.stringify(payload)]
    )
    const trashId = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id

    // The real delete. SQLite does the cascading; everything above was only
    // watching.
    db.run(`DELETE FROM ${source.table} WHERE id = ?`, [ref.id])

    return getTrash(db, trashId)!
  })
}

/** 'and 3 tasks, 2 notes' — what else is going. */
function summarise(captured: CapturedRows[], own: string): string {
  const parts = captured
    .filter((entry) => entry.table !== own && entry.rows.length > 0)
    .map((entry) => `${entry.rows.length} ${noun(entry.table, entry.rows.length)}`)
  return parts.join(', ')
}

/** Table names are plural already; this only has to handle the singular. */
function noun(table: string, count: number): string {
  const singular = table.endsWith('ies')
    ? `${table.slice(0, -3)}y`
    : table.endsWith('s')
      ? table.slice(0, -1)
      : table
  return count === 1 ? singular.replace(/_/g, ' ') : table.replace(/_/g, ' ')
}

interface TrashRow extends Row {
  id: number
  entity_type: string
  entity_id: number
  label: string
  summary: string
  payload: string
  deleted_at: string
}

function toEntry(row: TrashRow): TrashEntry {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    label: row.label,
    summary: row.summary,
    deletedAt: row.deleted_at
  }
}

export function getTrash(db: Database, id: number): TrashEntry | null {
  const row = db.get<TrashRow>('SELECT * FROM trash WHERE id = ?', [id])
  return row ? toEntry(row) : null
}

export function listTrash(db: Database): TrashEntry[] {
  return db
    .all<TrashRow>('SELECT * FROM trash ORDER BY deleted_at DESC, id DESC')
    .map(toEntry)
}

/**
 * Put something back.
 *
 * Two things can have changed since the delete, and both are reported rather
 * than guessed at. A parent may itself have gone, in which case the column is
 * restored as null where the schema allows it — a task with no project is
 * recoverable, and refusing the whole restore over it is not. And a unique
 * value may have been taken since, most plausibly an invoice number, which
 * nothing can do anything about except say so.
 */
export function restoreTrash(db: Database, id: number): { restored: string; orphaned: string[] } {
  const row = db.get<TrashRow>('SELECT * FROM trash WHERE id = ?', [id])
  if (!row) throw new Error('That is no longer in the trash.')

  const payload = JSON.parse(row.payload) as Payload
  const orphaned: string[] = []

  db.transaction(() => {
    for (const entry of payload.captured) {
      for (const original of entry.rows) {
        const values = { ...original }

        // Any key pointing at something that has since gone is dropped, so
        // the row comes back rather than the restore failing outright.
        for (const key of foreignKeys(db)) {
          if (key.child !== entry.table) continue
          const value = values[key.column]
          if (value === null || value === undefined) continue
          const parent = db.get(`SELECT 1 AS found FROM ${key.parent} WHERE id = ?`, [
            value as SqlValue
          ])
          if (parent) continue
          // Defensive today: all eight types key to their parent nullably,
          // and a captured child is always re-inserted after the parent it
          // belongs to. It is here for the schema change that gives an entity
          // a parent it cannot live without, where the alternative is a
          // constraint error nobody can act on.
          if (isNotNull(db, entry.table, key.column)) {
            throw new Error(
              `That cannot come back on its own — the ${key.parent.replace(/_/g, ' ')} it belonged to has gone too. Restore that first.`
            )
          }
          values[key.column] = null
          orphaned.push(key.parent.replace(/_/g, ' '))
        }

        insertRow(db, entry.table, values)
      }
    }

    for (const entry of payload.detached) {
      const placeholders = entry.ids.map(() => '?').join(', ')
      db.run(
        `UPDATE ${entry.table} SET ${entry.column} = ? WHERE id IN (${placeholders})`,
        [row.entity_id, ...(entry.ids as SqlValue[])]
      )
    }

    // Putting the rows back fires the creation triggers, so every restored row
    // has just written itself a fresh 'created' entry claiming it was made
    // moments ago. That is a lie about the record's history, and it also holds
    // the ids the captured entries want. Clear it, then reinstate what was
    // really there.
    for (const captured of payload.captured) {
      const type = typeOfTable(captured.table)
      if (!type) continue
      for (const restored of captured.rows) {
        db.run('DELETE FROM activity WHERE entity_type = ? AND entity_id = ?', [
          type,
          restored.id as number
        ])
      }
    }

    // Both go back without their ids: those sequences have moved on, and
    // neither row is referred to by anything, so the number was never the
    // point. Links are OR IGNORE because the same pair may have been drawn
    // again while this was in the trash.
    for (const one of payload.links) insertRow(db, 'links', withoutId(one), true)
    for (const one of payload.activity) insertRow(db, 'activity', withoutId(one))

    db.run('DELETE FROM trash WHERE id = ?', [id])
  })

  return { restored: row.label, orphaned: [...new Set(orphaned)] }
}

/**
 * Written by hand rather than with a helper, because `INSERT OR REPLACE` would
 * be wrong here: if something has taken this id — impossible with AUTOINCREMENT
 * but not worth betting the user's data on — the restore should fail loudly.
 */
function insertRow(db: Database, table: string, values: Row, ignoreDuplicate = false): void {
  const columns = Object.keys(values)
  db.run(
    `INSERT ${ignoreDuplicate ? 'OR IGNORE ' : ''}INTO ${table} (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((column) => values[column] as SqlValue)
  )
}

function withoutId(row: Row): Row {
  const { id: _id, ...rest } = row
  return rest
}

function isNotNull(db: Database, table: string, column: string): boolean {
  const info = db.get<{ notnull: number }>(
    `SELECT "notnull" FROM pragma_table_info(?) WHERE name = ?`,
    [table, column]
  )
  return info?.notnull === 1
}

/**
 * Empty one entry, permanently.
 *
 * Returns the workspace-relative files that should now go, rather than
 * removing them: this is synchronous and file removal is not, and a purge that
 * had already emptied the row would have nothing to retry from if the unlink
 * failed. The caller does the removal and can be relaxed about failing.
 */
export function purgeTrash(db: Database, id: number): string[] {
  const files = filesIn(db, 'SELECT payload FROM trash WHERE id = ?', [id])
  db.run('DELETE FROM trash WHERE id = ?', [id])
  return files
}

/** Empty all of it. */
export function emptyTrash(db: Database): { count: number; files: string[] } {
  const files = filesIn(db, 'SELECT payload FROM trash')
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trash')!.n
  db.run('DELETE FROM trash')
  return { count, files }
}

function filesIn(db: Database, sql: string, params: SqlValue[] = []): string[] {
  return db.all<{ payload: string }>(sql, params).flatMap((row) => {
    try {
      return (JSON.parse(row.payload) as Payload).files ?? []
    } catch {
      // A payload that will not parse is a payload nothing can be done with.
      // Losing the file cleanup is better than refusing to empty the trash.
      return []
    }
  })
}

/**
 * Drop what has been in the trash long enough.
 *
 * Run from the daily sweep. Thirty days is the span over which somebody
 * notices a mistake — a quarter's invoicing, the next VAT return — and past it
 * the trash is only a second copy of things nobody wanted.
 */
export function expireTrash(db: Database): { count: number; files: string[] } {
  const cutoff = `-${RETENTION_DAYS} days`
  const files = filesIn(db, `SELECT payload FROM trash WHERE deleted_at < datetime('now', ?)`, [
    cutoff
  ])
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trash')!.n
  db.run(`DELETE FROM trash WHERE deleted_at < datetime('now', ?)`, [cutoff])
  const count = before - db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trash')!.n
  return { count, files }
}

import type { Database, Row } from '../db'
import { ENTITY_SOURCES as SOURCES } from '../db/entities'
import { ENTITY_TYPES } from '@shared/types'
import type { BacklinkGroup, EntityRef, EntityType, LinkedEntity } from '@shared/types'

/**
 * What a thing is connected to.
 *
 * Two sources, one answer. The foreign keys already model *ownership* — an
 * invoice belongs to a client, a task belongs to a project — and they carry
 * cascades and constraints that a polymorphic table cannot. The `links` table
 * carries the rest: a note about a client rather than a project, a document
 * that belongs to two projects, a task that came out of a quote.
 *
 * `relatedTo` reads both and returns one list, which is what makes a client
 * record show their projects, invoices and notes without every caller knowing
 * which of those is a key and which is a link.
 *
 * Every table and column name below comes from `ENTITY_SOURCES` or from the
 * edge list, never from a caller. Ids are always parameters.
 */

interface FkEdge {
  /** The type holding the column. */
  child: EntityType
  parent: EntityType
  column: string
  /** How the connection reads on screen. */
  relationship: string
  /**
   * Set when the child reaches the parent through another table. A client's
   * tasks and notes only exist through their projects, and §1.1 asks for them
   * on the client record — so this is one hop, and only one.
   */
  through?: { table: string; column: string }
}

const PROJECTS_OF_CLIENT = { table: 'projects', column: 'client_id' } as const

const FK_EDGES: FkEdge[] = [
  { child: 'project', parent: 'client', column: 'client_id', relationship: 'for' },
  { child: 'task', parent: 'project', column: 'project_id', relationship: 'in' },
  { child: 'note', parent: 'project', column: 'project_id', relationship: 'about' },
  { child: 'invoice', parent: 'client', column: 'client_id', relationship: 'billed to' },
  { child: 'invoice', parent: 'project', column: 'project_id', relationship: 'billed for' },
  { child: 'quote', parent: 'client', column: 'client_id', relationship: 'quoted to' },
  { child: 'quote', parent: 'project', column: 'project_id', relationship: 'quoted for' },
  { child: 'document', parent: 'client', column: 'client_id', relationship: 'filed under' },
  { child: 'expense', parent: 'project', column: 'project_id', relationship: 'charged to' },

  // The one hop. Reachable from the client only; a task already reaches its
  // client through its project, so these are not followed in reverse.
  {
    child: 'task',
    parent: 'client',
    column: 'project_id',
    relationship: 'in',
    through: PROJECTS_OF_CLIENT
  },
  {
    child: 'note',
    parent: 'client',
    column: 'project_id',
    relationship: 'about',
    through: PROJECTS_OF_CLIENT
  }
]

/**
 * How many of each group are returned.
 *
 * A client with four hundred invoices should not ship four hundred rows to the
 * renderer to draw a panel that shows six. The group's `count` is the real
 * total, so "and 394 more" stays truthful.
 */
export const GROUP_LIMIT = 50

function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value)
}

/**
 * Order the two ends of a link.
 *
 * A link has no direction — connecting A to B is the same fact as connecting B
 * to A. Sorting the ends before writing means the unique index catches the
 * second attempt, rather than storing two rows that render as a duplicate.
 */
function ordered(a: EntityRef, b: EntityRef): [EntityRef, EntityRef] {
  if (a.type !== b.type) return a.type < b.type ? [a, b] : [b, a]
  return a.id <= b.id ? [a, b] : [b, a]
}

function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.type === b.type && a.id === b.id
}

/** True when the row still exists. Nothing may link to something deleted. */
function exists(db: Database, ref: EntityRef): boolean {
  const source = SOURCES[ref.type]
  return db.get(`SELECT 1 AS found FROM ${source.table} WHERE id = ?`, [ref.id]) !== undefined
}

/**
 * Connect two things.
 *
 * Idempotent: linking the same pair twice, from either end, leaves one row.
 */
export function link(db: Database, a: EntityRef, b: EntityRef): void {
  if (sameRef(a, b)) throw new Error('A thing cannot be linked to itself.')
  if (!exists(db, a) || !exists(db, b)) throw new Error('One of those no longer exists.')

  const [from, to] = ordered(a, b)
  db.run(
    `INSERT OR IGNORE INTO links
       (source_type, source_id, target_type, target_id, relationship, created_at)
     VALUES (?, ?, ?, ?, 'related', datetime('now'))`,
    [from.type, from.id, to.type, to.id]
  )
}

/** Disconnect two things. Silent when they were not connected. */
export function unlink(db: Database, a: EntityRef, b: EntityRef): void {
  const [from, to] = ordered(a, b)
  db.run(
    `DELETE FROM links
      WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ?`,
    [from.type, from.id, to.type, to.id]
  )
}

interface EndRow extends Row {
  other_type: string
  other_id: number
  relationship: string
}

interface LabelRow extends Row {
  id: number
  label: string
}

/** The hand-made links on a thing, in both directions, resolved to labels. */
function handMade(db: Database, ref: EntityRef): LinkedEntity[] {
  const rows = db.all<EndRow>(
    `SELECT target_type AS other_type, target_id AS other_id, relationship
       FROM links WHERE source_type = ? AND source_id = ?
     UNION ALL
     SELECT source_type AS other_type, source_id AS other_id, relationship
       FROM links WHERE target_type = ? AND target_id = ?`,
    [ref.type, ref.id, ref.type, ref.id]
  )

  const found: LinkedEntity[] = []
  for (const row of rows) {
    if (!isEntityType(row.other_type)) continue
    const source = SOURCES[row.other_type]
    // Resolved one row at a time rather than batched, because this also does
    // the work of dropping links whose other end has been deleted. The table
    // is polymorphic, so no foreign key can do it for us.
    const hit = db.get<LabelRow>(
      `SELECT e.id AS id, ${source.label('e')} AS label FROM ${source.table} e WHERE e.id = ?`,
      [row.other_id]
    )
    if (!hit) continue
    found.push({
      type: row.other_type,
      id: hit.id,
      label: hit.label,
      relationship: row.relationship,
      structural: false
    })
  }
  return found
}

/** The things a foreign key already connects to this one, in both directions. */
function structural(db: Database, ref: EntityRef): LinkedEntity[] {
  const found: LinkedEntity[] = []

  // Downward: rows that point at this one.
  for (const edge of FK_EDGES) {
    if (edge.parent !== ref.type) continue
    const child = SOURCES[edge.child]
    const sql = edge.through
      ? `SELECT c.id AS id, ${child.label('c')} AS label
           FROM ${child.table} c
           JOIN ${edge.through.table} h ON h.id = c.${edge.column}
          WHERE h.${edge.through.column} = ?
          ORDER BY c.id DESC`
      : `SELECT c.id AS id, ${child.label('c')} AS label
           FROM ${child.table} c
          WHERE c.${edge.column} = ?
          ORDER BY c.id DESC`

    for (const row of db.all<LabelRow>(sql, [ref.id])) {
      found.push({
        type: edge.child,
        id: row.id,
        label: row.label,
        relationship: edge.relationship,
        structural: true
      })
    }
  }

  // Upward: what this row's own keys point at. Never through a hop — a task
  // reaches its client via its project, and listing both would double it up.
  for (const edge of FK_EDGES) {
    if (edge.child !== ref.type || edge.through) continue
    const child = SOURCES[ref.type]
    const parent = SOURCES[edge.parent]
    const hit = db.get<LabelRow>(
      `SELECT p.id AS id, ${parent.label('p')} AS label
         FROM ${child.table} c JOIN ${parent.table} p ON p.id = c.${edge.column}
        WHERE c.id = ?`,
      [ref.id]
    )
    if (!hit) continue
    found.push({
      type: edge.parent,
      id: hit.id,
      label: hit.label,
      relationship: edge.relationship,
      structural: true
    })
  }

  return found
}

/**
 * Everything connected to one thing, grouped by what it is.
 *
 * Structural connections win over hand-made ones for the same row: a link
 * somebody drew between an invoice and its own client says less than the key
 * that already puts it there.
 */
export function relatedTo(db: Database, ref: EntityRef): BacklinkGroup[] {
  const seen = new Map<string, LinkedEntity>()

  for (const item of [...structural(db, ref), ...handMade(db, ref)]) {
    if (sameRef(item, ref)) continue
    const key = `${item.type}:${item.id}`
    if (!seen.has(key)) seen.set(key, item)
  }

  const groups: BacklinkGroup[] = []
  for (const type of ENTITY_TYPES) {
    const items = [...seen.values()].filter((item) => item.type === type)
    if (items.length === 0) continue
    groups.push({ type, items: items.slice(0, GROUP_LIMIT), count: items.length })
  }
  return groups
}

/**
 * Drop link rows whose other end has gone.
 *
 * `relatedTo` already hides them, so this is housekeeping rather than
 * correctness — it stops a workspace accumulating rows for things deleted years
 * ago, and it is why the unique index will not eventually refuse a link that
 * looks new. Run from the daily sweep.
 */
export function pruneLinks(db: Database): number {
  const dangling = (side: 'source' | 'target'): string =>
    ENTITY_TYPES.map(
      (type) =>
        `(${side}_type = '${type}' AND ${side}_id NOT IN (SELECT id FROM ${SOURCES[type].table}))`
    ).join(' OR ')

  // A type this build does not recognise is left alone. It is far more likely
  // to be a newer version writing to the same workspace — Dropbox, two
  // machines — than it is to be rubbish, and deleting somebody's links because
  // this copy is a version behind is not a trade worth making.
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM links')!.n
  db.run(`DELETE FROM links WHERE ${dangling('source')} OR ${dangling('target')}`)
  return before - db.get<{ n: number }>('SELECT COUNT(*) AS n FROM links')!.n
}

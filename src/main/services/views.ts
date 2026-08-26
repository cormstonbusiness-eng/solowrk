import type { Database, Row } from '../db'
import type { SavedView } from '@shared/types'

/**
 * Named sets of filters, one list at a time.
 *
 * The whole filter state travels as the page's own query string, so this
 * service never has to know what an invoice filter is or what a task filter
 * is. See the note on the table in migration 19 for why that is the right
 * shape rather than a column per filter.
 */

interface ViewRow extends Row {
  id: number
  page: string
  name: string
  query: string
  sort_order: number
  created_at: string
  updated_at: string
}

function toView(row: ViewRow): SavedView {
  return {
    id: row.id,
    page: row.page,
    name: row.name,
    query: row.query,
    sortOrder: row.sort_order
  }
}

export function listViews(db: Database, page: string): SavedView[] {
  return db
    .all<ViewRow>('SELECT * FROM saved_views WHERE page = ? ORDER BY sort_order, id', [page])
    .map(toView)
}

/**
 * Save a view, or replace the one that already has that name.
 *
 * Replacing is deliberate and the UI asks first. The alternative — refusing,
 * or quietly making "Overdue (2)" — turns "I've adjusted this, save it again"
 * into a chore, and that is the commonest thing anybody does with a saved
 * filter.
 */
export function saveView(db: Database, page: string, name: string, query: string): SavedView {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A view needs a name.')

  const existing = db.get<ViewRow>('SELECT * FROM saved_views WHERE page = ? AND name = ?', [
    page,
    trimmed
  ])

  if (existing) {
    db.run(
      `UPDATE saved_views SET query = ?, updated_at = datetime('now') WHERE id = ?`,
      [query, existing.id]
    )
    return toView({ ...existing, query })
  }

  // Appended, so a new view lands at the end rather than jumping the order
  // somebody has already arranged.
  const last = db.get<{ next: number | null }>(
    'SELECT MAX(sort_order) AS next FROM saved_views WHERE page = ?',
    [page]
  )

  db.run(
    `INSERT INTO saved_views (page, name, query, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [page, trimmed, query, (last?.next ?? 0) + 1]
  )

  const id = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  return toView(db.get<ViewRow>('SELECT * FROM saved_views WHERE id = ?', [id])!)
}

export function deleteView(db: Database, id: number): void {
  db.run('DELETE FROM saved_views WHERE id = ?', [id])
}

/** Whether saving under this name would replace something. */
export function viewExists(db: Database, page: string, name: string): boolean {
  return (
    db.get('SELECT 1 AS found FROM saved_views WHERE page = ? AND name = ?', [
      page,
      name.trim()
    ]) !== undefined
  )
}

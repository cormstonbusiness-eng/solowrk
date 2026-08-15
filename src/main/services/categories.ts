import type { Database, Row } from '../db'
import type { Category } from '@shared/types'

interface CategoryRow extends Row {
  id: number
  name: string
  colour: string
  sort_order: number
}

function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, colour: row.colour, sortOrder: row.sort_order }
}

export function listCategories(db: Database): Category[] {
  return db
    .all<CategoryRow>('SELECT id, name, colour, sort_order FROM categories ORDER BY sort_order, id')
    .map(toCategory)
}

export function createCategory(db: Database, name: string, colour: string): Category {
  const next = db.get<Row & { max_order: number | null }>(
    'SELECT MAX(sort_order) AS max_order FROM categories'
  )

  db.run(
    `INSERT INTO categories (name, colour, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [name, colour, (next?.max_order ?? 0) + 1]
  )

  const row = db.get<CategoryRow>(
    'SELECT id, name, colour, sort_order FROM categories WHERE id = last_insert_rowid()'
  )
  if (!row) throw new Error('Category was not created')
  return toCategory(row)
}

export function updateCategory(
  db: Database,
  id: number,
  patch: { name?: string; colour?: string }
): Category {
  const assignments: string[] = []
  const values: string[] = []

  if (patch.name !== undefined) {
    assignments.push('name = ?')
    values.push(patch.name)
  }
  if (patch.colour !== undefined) {
    assignments.push('colour = ?')
    values.push(patch.colour)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE categories SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  const row = db.get<CategoryRow>(
    'SELECT id, name, colour, sort_order FROM categories WHERE id = ?',
    [id]
  )
  if (!row) throw new Error(`No category with id ${id}`)
  return toCategory(row)
}

/** Tasks keep their place; the schema sets their category_id to NULL. */
export function deleteCategory(db: Database, id: number): void {
  db.run('DELETE FROM categories WHERE id = ?', [id])
}

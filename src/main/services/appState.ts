import type { Database, Row } from '../db'

/**
 * Workspace-scoped UI state. Values are strings — callers parse them — because
 * this store exists for small flags and preferences, not structured data. If
 * something needs a schema, it needs a table.
 */
export function getState(db: Database, key: string): string | null {
  const row = db.get<Row & { value: string }>('SELECT value FROM app_state WHERE key = ?', [key])
  return row?.value ?? null
}

export function setState(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  )
}

/** Keys in use, so they are greppable rather than scattered as string literals. */
export const STATE_KEYS = {
  tourCompleted: 'tour.completed'
} as const
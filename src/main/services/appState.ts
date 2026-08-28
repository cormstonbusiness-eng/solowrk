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
  tourCompleted: 'tour.completed',
  /**
   * When this installation first ran, mirroring the same field in the config.
   *
   * Here as well as there because the config lives in `userData` and the trial
   * is anchored to it — deleting one file would otherwise hand out a fresh
   * fortnight of Pro. Whichever copy is older wins, so restoring an old
   * workspace cannot extend a trial either.
   */
  installedAt: 'licence.installedAt'
} as const
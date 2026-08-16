import type { BrowserWindow } from 'electron'
import type { Database, Row } from '../db'
import type { AppNotification, NotificationKind, NotificationInput } from '@shared/types'

/**
 * In-app notifications.
 *
 * These live in the workspace rather than the Windows tray, because a desktop
 * toast that appears while you are in another window is gone forever — which is
 * no way to be told an invoice is late. Here they queue up, get read when you
 * are ready, and archive rather than vanish.
 *
 * `dedupeKey` is what stops a daily job from nagging: the same overdue invoice
 * produces one notification, not one per morning.
 */

interface NotificationRow extends Row {
  id: number
  kind: string
  title: string
  body: string
  link: string
  dedupe_key: string | null
  read_at: string | null
  archived: number
  created_at: string
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.read_at,
    archived: row.archived === 1,
    createdAt: row.created_at
  }
}

export function listNotifications(
  db: Database,
  options: { archived?: boolean } = {}
): AppNotification[] {
  return db
    .all<NotificationRow>(
      `SELECT * FROM notifications WHERE archived = ? ORDER BY id DESC LIMIT 200`,
      [options.archived ? 1 : 0]
    )
    .map(toNotification)
}

export function unreadCount(db: Database): number {
  const row = db.get<Row & { n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE archived = 0 AND read_at IS NULL'
  )
  return row?.n ?? 0
}

/**
 * Raise a notification, or do nothing if one with the same key already exists.
 *
 * Returns the new notification so the caller can push it to the window, and
 * null when it was a duplicate — which is the signal not to pop a toast.
 */
export function notify(db: Database, input: NotificationInput): AppNotification | null {
  if (input.dedupeKey) {
    const existing = db.get<Row & { id: number }>(
      'SELECT id FROM notifications WHERE dedupe_key = ?',
      [input.dedupeKey]
    )
    if (existing) return null
  }

  db.run(
    `INSERT INTO notifications (kind, title, body, link, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.kind ?? 'info',
      input.title,
      input.body ?? '',
      input.link ?? '',
      input.dedupeKey ?? null
    ]
  )

  const row = db.get<NotificationRow>('SELECT * FROM notifications WHERE id = last_insert_rowid()')
  return row ? toNotification(row) : null
}

/** Raise a notification and slide it into the window, in one call. */
export function push(
  db: Database,
  getWindow: () => BrowserWindow | null,
  input: NotificationInput
): void {
  const notification = notify(db, input)
  if (!notification) return
  getWindow()?.webContents.send('notifications:new', notification)
}

export function markRead(db: Database, id: number): void {
  db.run("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL", [
    id
  ])
}

export function markAllRead(db: Database): void {
  db.run("UPDATE notifications SET read_at = datetime('now') WHERE archived = 0 AND read_at IS NULL")
}

/**
 * Archiving marks it read on the way past.
 *
 * An archived notification you never opened is read by any sensible definition,
 * and leaving it unread would keep the badge lit over something already dealt
 * with.
 */
export function archiveNotification(db: Database, id: number): void {
  db.run(
    `UPDATE notifications
        SET archived = 1, read_at = COALESCE(read_at, datetime('now'))
      WHERE id = ?`,
    [id]
  )
}

export function archiveRead(db: Database): void {
  db.run('UPDATE notifications SET archived = 1 WHERE archived = 0 AND read_at IS NOT NULL')
}

export function restoreNotification(db: Database, id: number): void {
  db.run('UPDATE notifications SET archived = 0 WHERE id = ?', [id])
}

export function deleteNotification(db: Database, id: number): void {
  db.run('DELETE FROM notifications WHERE id = ?', [id])
}

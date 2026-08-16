import { Notification, type BrowserWindow } from 'electron'
import { nowStamp, timeOf } from '@shared/calendar'
import { dueReminders, markReminded } from './events'
import { session } from './session'

/**
 * Fires native Windows notifications for events whose reminder has come due.
 *
 * A poll rather than a timer per event: a `setTimeout` scheduled hours ahead is
 * unreliable across sleep and suspend, and would have to be cancelled and
 * rebuilt every time an event moved. Polling a single indexed query every
 * half-minute costs nothing and is correct after the machine wakes up.
 */
const TICK_MS = 30_000

let timer: NodeJS.Timeout | null = null

/** How close to the start we still call it a reminder. */
function bodyFor(event: { startsAt: string; reminderMinutes: number | null }): string {
  const minutes = event.reminderMinutes ?? 0
  if (minutes === 0) return `Starting now, at ${timeOf(event.startsAt)}`
  if (minutes >= 1440) return `Tomorrow at ${timeOf(event.startsAt)}`
  if (minutes >= 60) return `In ${minutes / 60} hour${minutes === 60 ? '' : 's'}, at ${timeOf(event.startsAt)}`
  return `In ${minutes} minutes, at ${timeOf(event.startsAt)}`
}

function tick(getWindow: () => BrowserWindow | null): void {
  // The workspace opens lazily, and can be closed and reopened. Checking here
  // rather than coupling this to the session's lifecycle keeps the dependency
  // one-way: reminders know about the session, the session knows nothing here.
  if (!session.isOpen) return

  const db = session.requireDb()
  const now = nowStamp()
  const { due, stale } = dueReminders(db, now)

  for (const event of due) {
    if (!Notification.isSupported()) break

    const notification = new Notification({
      title: event.title,
      body: [bodyFor(event), event.location].filter(Boolean).join(' · '),
      silent: false
    })

    // Clicking a reminder should land you in the app, not just dismiss it.
    notification.on('click', () => {
      const window = getWindow()
      if (!window) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      window.webContents.send('calendar:focusEvent', { id: event.id })
    })

    notification.show()
  }

  markReminded(db, [...due, ...stale].map((event) => event.id), now)
}

export function startReminders(getWindow: () => BrowserWindow | null): void {
  if (timer) return
  timer = setInterval(() => {
    try {
      tick(getWindow)
    } catch (error) {
      // A reminder failing must never take the app down, and must not stop the
      // next tick from trying again.
      console.error('Reminder check failed:', error)
    }
  }, TICK_MS)
}

export function stopReminders(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

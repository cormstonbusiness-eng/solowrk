import type { BrowserWindow } from 'electron'
import { addDays, dayOf, nowStamp, timeOf } from '@shared/calendar'
import { dueReminders, markReminded } from './events'
import { listDueTasks } from './tasks'
import { session } from './session'
import { push } from './notifications'

/**
 * Raises in-app notifications for events whose reminder has come due.
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
    push(db, getWindow, {
      kind: 'due',
      title: event.title,
      body: [bodyFor(event), event.location].filter(Boolean).join(' · '),
      link: '/calendar',
      // One per event, so a reminder cannot be raised twice even if the poll
      // and the reminded_at write ever disagree.
      dedupeKey: `event-${event.id}`
    })
  }

  markReminded(db, [...due, ...stale].map((event) => event.id), now)

  runDigest(getWindow, new Date())
}

/**
 * The once-a-day nudge about deadlines, as opposed to the per-event reminders
 * above.
 *
 * Deadlines are a different kind of thing from a meeting: nobody wants a
 * notification at the exact minute a task is due, but everybody wants to know
 * on the morning that three things are due today and one is late. So this fires
 * once per day, on the first tick after the run hour, and says the whole
 * position in one notification rather than one per item.
 */
const DIGEST_HOUR = 9

let lastDigestDay: string | null = null

function runDigest(getWindow: () => BrowserWindow | null, now: Date): void {
  const day = dayOf(nowStamp())
  if (lastDigestDay === day || now.getHours() < DIGEST_HOUR) return
  lastDigestDay = day

  const db = session.requireDb()

  const tasks = listDueTasks(db, day)
  const overdueTasks = tasks.filter((task) => (task.dueAt ?? '') < day)
  const projects = db.all<{ name: string; due_on: string }>(
    `SELECT name, due_on FROM projects
      WHERE archived = 0 AND status NOT IN ('completed', 'cancelled')
        AND due_on IS NOT NULL AND due_on <= ?`,
    [addDays(day, 7)]
  )

  const lines: string[] = []
  if (overdueTasks.length > 0) {
    lines.push(`${overdueTasks.length} task${overdueTasks.length === 1 ? '' : 's'} overdue`)
  }
  const dueToday = tasks.length - overdueTasks.length
  if (dueToday > 0) lines.push(`${dueToday} due today`)
  if (projects.length > 0) {
    lines.push(
      `${projects.length} project deadline${projects.length === 1 ? '' : 's'} within a week`
    )
  }

  // Nothing to say is a perfectly good outcome; say nothing.
  if (lines.length === 0) return

  push(db, getWindow, {
    kind: overdueTasks.length > 0 ? 'late' : 'due',
    title: overdueTasks.length > 0 ? 'Some things are late' : 'Today’s deadlines',
    body: lines.join(' · '),
    link: '/tasks',
    // One digest per day, whatever else happens.
    dedupeKey: `digest-${day}`
  })
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

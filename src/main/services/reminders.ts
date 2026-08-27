import { rm } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import { addDays, dayOf, nowStamp, timeOf } from '@shared/calendar'
import { hasFeature } from './auth'
import { chaseDedupeKey, dueChasers } from './chasers'
import { runChasers } from './chaseRun'
import { runAutomations } from './automations'
import { dueReminders, markReminded } from './blocks'
import { dueSubscriptions, syncSubscription } from './subscriptions'
import { listDueTasks } from './tasks'
import { pruneActivity } from './activity'
import { expireTrash } from './trash'
import { pruneLinks } from './links'
import { pruneTags } from './tags'
import { session } from './session'
import { resolveInWorkspace } from './workspace'
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

  refreshSubscriptions(db)
  runDigest(getWindow, new Date())
}

/**
 * Pull any subscribed calendar whose interval has come round.
 *
 * On the same tick as the reminders rather than a timer of its own, so there
 * is one clock in the app rather than two. Nothing here is awaited and nothing
 * here reports: a feed that will not load is a dot in Settings, never a
 * notification and never a modal. Somebody working must not be interrupted
 * because a shared calendar is down.
 */
let syncing = false

function refreshSubscriptions(db: ReturnType<typeof session.requireDb>): void {
  if (syncing) return
  const due = dueSubscriptions(db)
  if (due.length === 0) return

  syncing = true
  void Promise.allSettled(due.map((one) => syncSubscription(db, one.id))).finally(() => {
    syncing = false
  })
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
  if (lines.length > 0) {
    push(db, getWindow, {
      kind: overdueTasks.length > 0 ? 'late' : 'due',
      title: overdueTasks.length > 0 ? 'Some things are late' : 'Today’s deadlines',
      body: lines.join(' · '),
      link: '/tasks',
      // One digest per day, whatever else happens.
      dedupeKey: `digest-${day}`
    })
  }

  // Asynchronous because it has a licence to check, and nothing above it needs
  // to wait. Its own catch: the try/catch around `tick` cannot see a rejected
  // promise, and a failed sweep must not take the reminder loop down with it.
  void runChaseSweep(getWindow, db, day).catch((error) => {
    console.error('Chase sweep failed:', error)
  })

  runRules(getWindow, db, day)

  // Housekeeping. Both tables are polymorphic, so no foreign key can cascade
  // when the other end is deleted — `relatedTo` and `activityFor` already hide
  // what has gone, and this is what stops a workspace open for three years
  // carrying the connections and the history of everything ever deleted.
  //
  // Silent on failure: it is tidying, and a workspace that will not tidy is
  // still a workspace that works.
  try {
    pruneLinks(db)
    pruneActivity(db)
    pruneTags(db)
    // And let go of what has been in the trash long enough. The files it
    // hands back are note bodies; removing them is the caller's job because
    // this is synchronous and unlinking is not.
    const { files } = expireTrash(db)
    if (files.length > 0) removeExpired(files)
  } catch (error) {
    console.error('Pruning failed:', error)
  }
}

/**
 * The user's own rules, once a day.
 *
 * Here rather than on a timer of its own because a rule is a thing that
 * happens *on a day*, and the digest is already the once-a-day moment. Running
 * it more often would not make an invoice overdue any sooner.
 *
 * Only `notify` rules raise anything: a rule that created a task has already
 * put its result somewhere the user will see it, and announcing that as well
 * would mean two notifications for one thing. A drafted invoice says so,
 * because an invoice appearing that nobody wrote is otherwise unexplained.
 */
function runRules(
  getWindow: () => BrowserWindow | null,
  db: ReturnType<typeof session.requireDb>,
  day: string
): void {
  let outcomes: ReturnType<typeof runAutomations>
  try {
    outcomes = runAutomations(db, day)
  } catch (error) {
    // A broken rule must not stop the reminders that have nothing to do with it.
    console.error('Automations failed:', error)
    return
  }

  for (const result of outcomes) {
    if (result.action === 'create_task') continue

    push(db, getWindow, {
      kind: result.action === 'draft_invoice' ? 'money' : 'info',
      title: result.ruleName,
      body: result.outcome,
      link: result.action === 'draft_invoice' ? '/invoices' : '/tasks',
      // A rule acts on a thing once, so this is already unique — and it stays
      // unique if the sweep runs twice in a morning.
      dedupeKey: `rule-${result.ruleId}-${result.subject}`
    })
  }
}

/**
 * The morning look at what is owed.
 *
 * Separate from the deadline digest above because it is a different kind of
 * news and goes to a different page — a task being late and three thousand
 * pounds being late should not share a sentence.
 *
 * Raises one notification for the batch, not one per invoice. Nine separate
 * alerts about money is a bad morning, and the point is to prompt one sitting
 * of chasing rather than to be a running commentary on being owed.
 *
 * Whether anything is actually sent is decided in `runChasers`, and the answer
 * is no unless the user has set up their own mail account and then explicitly
 * switched chasing from 'hold' to 'auto'. The notification is worded from what
 * came back rather than assumed, so it never claims to have sent something it
 * only wrote.
 */
async function runChaseSweep(
  getWindow: () => BrowserWindow | null,
  db: ReturnType<typeof session.requireDb>,
  day: string
): Promise<void> {
  /**
   * The automatic schedule is Pro.
   *
   * Checked here as well as at the IPC gate because this runs on a timer and
   * never crosses the bridge — a lapsed or downgraded licence would otherwise
   * keep drafting notes nothing could open. `hasFeature` returns true when no
   * account server is configured, so an ungated install is unaffected, and the
   * setting is off by default in any case.
   */
  if (!(await hasFeature('chasing'))) return

  const due = dueChasers(db, day)
  if (due.length === 0) return

  const total = due.reduce((sum, chase) => sum + chase.invoice.gross, 0)
  const amount = `£${(total / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`

  // Write the notes — and, if the user has asked for it, send them. The
  // dedupe key is taken before this runs, because sending changes chase_step
  // and would otherwise change the key for the very notification describing it.
  const key = chaseDedupeKey(due)
  const result = await runChasers(db, day)

  const waiting = result.drafted - result.queued
  const verb = result.queued > 0 && waiting === 0 ? 'sent' : 'drafted'

  push(db, getWindow, {
    kind: 'late',
    title: due.length === 1 ? 'An invoice needs chasing' : `${due.length} invoices need chasing`,
    body:
      due.length === 1
        ? `${due[0]!.invoice.number} · ${amount} · ${due[0]!.daysLate} days late. A note has been ${verb}.`
        : `${amount} outstanding. The notes have been ${verb}.`,
    link: '/invoices',
    dedupeKey: key
  })

  // Anything that failed to send is worth its own notification. A chaser that
  // did not go is invisible otherwise, and invisible is exactly how an unpaid
  // invoice stays unpaid.
  if (result.drained.failed > 0) {
    push(db, getWindow, {
      kind: 'late',
      title: 'A chaser could not be sent',
      body: `${result.drained.failed} message${result.drained.failed === 1 ? '' : 's'} failed. Check your mail settings.`,
      link: '/settings',
      dedupeKey: `chase-failed-${day}`
    })
  }
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

/**
 * Delete note bodies whose trash entry has expired.
 *
 * Best effort. The database row has already gone, so a file that will not
 * delete is litter rather than a failure, and it must not take the sweep down.
 */
function removeExpired(files: string[]): void {
  const workspacePath = session.path
  if (!workspacePath) return
  for (const file of files) {
    void rm(resolveInWorkspace(workspacePath, file), { force: true }).catch(() => {
      // Nothing useful to do about it, and nothing depends on it.
    })
  }
}

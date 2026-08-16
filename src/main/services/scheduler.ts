import { Notification, type BrowserWindow } from 'electron'
import { dayFromDate, nowStamp, timeOf } from '@shared/calendar'
import { PLATFORMS } from '@shared/social'
import type { PostWithContext } from '@shared/types'
import { duePosts, markNeedsAttention, runEvergreen } from './marketing'
import { session } from './session'

/**
 * Drives scheduled posts.
 *
 * A poll rather than a timer per post, for the same reasons as event reminders:
 * a `setTimeout` scheduled hours ahead does not survive sleep, and would have to
 * be rebuilt every time a post moved.
 *
 * Until stage 10.3 connects real accounts, "publishing" means telling the user
 * it is time and putting the caption on their clipboard. That is deliberately
 * the same code path the connected version will fall back to when an
 * auto-post fails, so the manual route is never the untested one.
 */
const TICK_MS = 60_000

let timer: NodeJS.Timeout | null = null
let lastEvergreenRun: string | null = null

function notifyDue(getWindow: () => BrowserWindow | null, post: PostWithContext): void {
  if (!Notification.isSupported()) return

  const platforms = post.targets
    .map((target) => PLATFORMS[target.platform]?.label ?? target.platform)
    .join(', ')

  const notification = new Notification({
    title: post.title || 'Time to post',
    body: platforms === '' ? 'Scheduled now' : `Due now on ${platforms}`
  })

  notification.on('click', () => {
    const window = getWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('marketing:focusPost', { id: post.id })
  })

  notification.show()
}

function notifyLate(getWindow: () => BrowserWindow | null, posts: PostWithContext[]): void {
  if (!Notification.isSupported() || posts.length === 0) return

  // One notification for the batch. Opening the laptop after a week away and
  // being handed nine separate alerts is not a reminder, it is a telling-off.
  const notification = new Notification({
    title: posts.length === 1 ? 'A post missed its slot' : `${posts.length} posts missed their slot`,
    body:
      posts.length === 1
        ? `“${posts[0]!.title || 'Untitled'}” was due at ${timeOf(posts[0]!.scheduledAt ?? '')}. Reschedule or send it now.`
        : 'SoloWrk was closed when they were due. They are waiting in Marketing.'
  })

  notification.on('click', () => {
    const window = getWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('marketing:focusPost', { id: posts[0]!.id })
  })

  notification.show()
}

async function tick(getWindow: () => BrowserWindow | null): Promise<void> {
  // The workspace opens lazily and can be closed and reopened, so this checks
  // rather than being wired into the session's lifecycle. One-way dependency.
  if (!session.isOpen) return

  const db = session.requireDb()
  const now = nowStamp()

  const { due, late } = duePosts(db, now)

  for (const post of due) notifyDue(getWindow, post)

  if (late.length > 0) {
    // Flagged first, notified second: if the notification throws, the posts are
    // still off the due list rather than being announced again every minute.
    markNeedsAttention(db, late.map((post) => post.id))
    notifyLate(getWindow, late)
  }

  // Evergreen is a daily job, not a per-minute one.
  const day = dayFromDate(new Date())
  if (lastEvergreenRun !== day) {
    lastEvergreenRun = day
    await runEvergreen(db, session.requirePath(), day)
  }
}

export function startScheduler(getWindow: () => BrowserWindow | null): void {
  if (timer) return
  timer = setInterval(() => {
    void tick(getWindow).catch((error: unknown) => {
      // A scheduling failure must never take the app down, and must not stop
      // the next tick from trying again.
      console.error('Post scheduler failed:', error)
    })
  }, TICK_MS)
}

export function stopScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
  lastEvergreenRun = null
}

import type { BrowserWindow } from 'electron'
import type { AuthState } from '@shared/types'
import { authState, verify } from './auth'
import { readConfig } from './config'

/**
 * Keeping the licence confirmed in the background.
 *
 * `verify()` has always worked, but until now nothing called it on its own. The
 * only two callers were the **Check licence** button in Settings and the **check
 * again** button on the read-only bar, which made `verifiedAt` a record of the
 * last time somebody happened to click something. The fourteen-day grace window
 * is measured from that timestamp, so a signed-in user dropped into read-only a
 * fortnight after signing in — paid up, online, and locked out of their own
 * writing by a clock nothing was winding.
 *
 * So the check runs on a timer. It keeps the same manners as the rest of this
 * area: being offline is not an error, a failure changes nothing, and the user
 * is only told when the answer actually moved.
 */

/** Often enough to notice a lapse the same day, rarely enough to cost nothing. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Let the window paint and the workspace open before touching the network. */
const FIRST_CHECK_DELAY_MS = 15_000

let interval: NodeJS.Timeout | null = null
let first: NodeJS.Timeout | null = null
let getWindow: (() => BrowserWindow | null) | null = null
let inFlight = false

/**
 * The parts of the state a change to which the user would actually notice.
 *
 * Compared as a string so an unchanged answer — which is the overwhelmingly
 * common case, four times a day forever — does not re-render the app or flicker
 * anything on screen.
 */
function signature(state: AuthState): string {
  return [
    state.signedIn,
    // The tier rather than a lapsed flag: it is the thing the whole app reads
    // off this state, so a change in it is exactly when the renderer must hear.
    state.tier,
    state.trial.daysLeft,
    state.paymentFailed,
    state.updatesEndedOn,
    state.account?.plan ?? '',
    state.account?.expiresOn ?? ''
  ].join('|')
}

/**
 * Re-confirm the licence, and tell the renderer only if the answer moved.
 *
 * Deliberately returns nothing and throws nothing. `verify()` already swallows
 * being offline, treats a 402 as read-only rather than a rejection, and only
 * ends the session when the server actively disowns the licence — so there is
 * no failure here worth reporting to a caller that is a timer.
 */
export async function checkLicence(): Promise<void> {
  // Two checks overlapping would be pointless rather than harmful, but a slow
  // server plus a short interval should not queue up requests.
  if (inFlight) return

  const config = await readConfig()

  /**
   * The server is asked only when there is one to ask.
   *
   * The comparison, though, happens either way — and that is the whole point
   * of this shape. **Not every tier change comes from a server.** A trial
   * expiring is decided entirely locally, from a date in the config, so an
   * early return here would mean the main process quietly started refusing
   * while the renderer carried on showing Pro: padlocks missing, Marketing
   * still in the sidebar, and a raw IPC error the moment anybody clicked it.
   *
   * It also covers the countdown, which moves a day at a time and needs no
   * network to do it.
   */
  if (config.apiBaseUrl.trim() !== '' && config.authToken) {
    inFlight = true
    try {
      await verify()
    } catch {
      // `verify()` does not throw, but a timer callback that can reject would
      // take the process down with it. Not worth the risk for a licence check.
    } finally {
      inFlight = false
    }
  }

  /**
   * Compared against the *previous* check, not against a reading taken moments
   * ago in this same call.
   *
   * The first version of this took `before` at the top of the function and
   * `after` at the bottom, which works only when something in between changes
   * it — a server call. With no server the two readings were identical by
   * construction and it could never fire, which is the exact case it was added
   * for. Holding the last answer across calls is what makes a purely local
   * change, like a trial expiring, visible at all.
   */
  const now = await authState()
  const current = signature(now)

  // Null on the very first check: the renderer has just fetched this itself,
  // so there is nothing to tell it.
  if (last !== null && current !== last) {
    getWindow?.()?.webContents.send('auth:changed', now)
  }

  last = current
}

/** The answer at the last check, for comparison. */
let last: string | null = null

/**
 * Start confirming the licence in the background.
 *
 * Safe to call when no account server is set. It no longer *no-ops* in that
 * case, though — the network call is skipped, but the answer is still
 * recomputed and compared, because a trial expiring changes the tier with no
 * server involved at all.
 */
export function startLicenceChecks(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  last = null

  first = setTimeout(() => void checkLicence(), FIRST_CHECK_DELAY_MS)
  interval = setInterval(() => void checkLicence(), CHECK_INTERVAL_MS)
}

/**
 * Re-check when the window comes back to the front (§3.3).
 *
 * The six-hourly timer is the right cadence for a licence and the wrong one
 * for the two moments that actually matter: somebody upgrading on the website
 * and alt-tabbing back, and a trial expiring overnight with the app left open.
 * Both leave the UI showing a tier the main process has already stopped
 * honouring, which reads as broken software at the exact moment it must not.
 *
 * Throttled, because focus fires on every alt-tab and most of them have
 * nothing to report.
 */
export function checkLicenceOnFocus(): void {
  const now = Date.now()
  if (now - lastFocusCheck < FOCUS_THROTTLE_MS) return

  lastFocusCheck = now
  void checkLicence()
}

let lastFocusCheck = 0

/** §3.3's "more than 60s since the last check". */
const FOCUS_THROTTLE_MS = 60_000

export function stopLicenceChecks(): void {
  if (first) clearTimeout(first)
  if (interval) clearInterval(interval)
  first = null
  interval = null
}
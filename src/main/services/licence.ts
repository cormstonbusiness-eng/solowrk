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
    state.readOnly,
    state.lapsedReason,
    state.account?.plan ?? '',
    (state.account?.features ?? []).join(','),
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
  // Nothing to confirm: no server configured, or nobody signed in. `verify()`
  // returns early on both, but there is no reason to wake anything up.
  if (config.apiBaseUrl.trim() === '' || !config.authToken) return

  inFlight = true
  try {
    const before = signature(await authState())
    const after = await verify()

    if (signature(after) !== before) {
      getWindow?.()?.webContents.send('auth:changed', after)
    }
  } catch {
    // `verify()` does not throw, but a timer callback that can reject would
    // take the process down with it. Not worth the risk for a licence check.
  } finally {
    inFlight = false
  }
}

/**
 * Start confirming the licence in the background.
 *
 * Safe to call when no account server is set — every check no-ops until one is,
 * which is how every install behaves today.
 */
export function startLicenceChecks(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  first = setTimeout(() => void checkLicence(), FIRST_CHECK_DELAY_MS)
  interval = setInterval(() => void checkLicence(), CHECK_INTERVAL_MS)
}

export function stopLicenceChecks(): void {
  if (first) clearTimeout(first)
  if (interval) clearInterval(interval)
  first = null
  interval = null
}
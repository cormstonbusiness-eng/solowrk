import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { AuthAccount, AuthState } from '@shared/types'
import { readConfig, updateConfig } from './config'
import { entitlement } from './entitlements'

/**
 * The account a licence belongs to.
 *
 * Two things shape everything here.
 *
 * **The account is not the data.** SoloWrk's whole pitch is that your work
 * lives in a folder you control, and signing in must not quietly walk that
 * back. Nothing about a client, an invoice or an hour is ever sent anywhere.
 * The account exists to answer one question — is this copy licensed — and the
 * screen says so plainly rather than hoping nobody wonders.
 *
 * **It fails open, not closed.** A licence check that locks someone out of
 * their own invoices because a train went into a tunnel has done more damage
 * than piracy ever would. An unreachable server means "carry on", and the grace
 * window is generous.
 *
 * What a licence is *worth* is no longer decided here. `entitlements.ts` owns
 * that, and this file owns talking to the server — the split matters because
 * the entitlement has to be answerable with no server at all, for a trial, a
 * Free user, or a lifetime licence that will never call home again.
 */


/** Long enough for a slow connection, short enough not to hang the sign-in. */
const TIMEOUT_MS = 20_000

interface SignInResult {
  token: string
  // `features` is optional so a server that predates tiers still works, and so
  // an early one can be built without it.
  account: Omit<AuthAccount, 'features'> & { features?: string[] }
  /**
   * The signed licence (§3.2), which is what actually grants anything.
   *
   * Optional for the same reason `features` is: the server issues it from the
   * tier rework onwards, and a build that meets an older server should fall
   * back to Free rather than fail to sign in. An absent licence is not an
   * error — it is simply nothing granted.
   */
  licence?: string
}

/**
 * Whether an account server is configured.
 *
 * Empty means no backend exists yet, and the app runs completely ungated. That
 * is the honest state today: gating the app against a server that does not
 * exist would lock everyone out, including the person who wrote it.
 */
export async function isConfigured(): Promise<boolean> {
  return (await readConfig()).apiBaseUrl.trim() !== ''
}

/** Stable per installation, so seats can be counted without a fingerprint. */
async function deviceId(): Promise<string> {
  const config = await readConfig()
  if (config.deviceId) return config.deviceId

  const id = randomUUID()
  await updateConfig({ deviceId: id })
  return id
}

/**
 * What this device is, and what to call it.
 *
 * `platform` is sent because a licence allows a different number of computers
 * than phones — two desktops and, later, one mobile. A server that only counts
 * devices cannot tell those apart, and retrofitting the distinction means
 * changing both sides at once. It costs one field now.
 *
 * `name` is the machine's own name, so the account page can offer "release
 * this seat" against something recognisable. A list of four UUIDs is not a
 * list anyone can choose from.
 */
async function device(): Promise<{ deviceId: string; platform: string; deviceName: string }> {
  return {
    deviceId: await deviceId(),
    platform: process.platform === 'win32' ? 'windows' : process.platform,
    deviceName: hostname()
  }
}

async function call<T>(
  path: string,
  body: Record<string, unknown>,
  token?: string
): Promise<T> {
  const { apiBaseUrl } = await readConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (cause) {
    // Distinguished from a rejection so the caller can decide to carry on.
    const offline = new Error(
      cause instanceof Error && cause.name === 'AbortError'
        ? 'The account server did not respond.'
        : 'Could not reach the account server.'
    )
    offline.name = 'OfflineError'
    throw offline
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    // The server's own words when it bothered to give any — it knows why it
    // said no, and "Request failed with status 401" helps nobody.
    const detail = (await response.json().catch(() => null)) as { message?: string } | null

    // 402 is the payment case, and it is the one status that does not end the
    // session: the account is real, the subscription simply is not paid. It
    // drops the app into read-only instead of shutting the door.
    if (response.status === 402) {
      const lapsed = new Error(detail?.message ?? 'This account does not have an active licence.')
      lapsed.name = 'LapsedError'
      throw lapsed
    }

    if (detail?.message) throw new Error(detail.message)
    if (response.status === 401) throw new Error('That email and password do not match.')
    if (response.status === 409) {
      throw new Error('That licence is already in use on the maximum number of computers.')
    }
    throw new Error(`The account server returned ${response.status}.`)
  }

  return (await response.json()) as T
}

function accountFrom(config: Awaited<ReturnType<typeof readConfig>>): AuthAccount | null {
  if (!config.accountEmail) return null
  return {
    email: config.accountEmail,
    name: config.accountName ?? '',
    plan: config.accountPlan ?? '',
    features: (config.accountFeatures ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    expiresOn: config.accountExpiresOn ?? ''
  }
}

async function store(result: SignInResult): Promise<void> {
  await updateConfig({
    authToken: result.token,
    accountEmail: result.account.email,
    accountName: result.account.name,
    accountPlan: result.account.plan,
    accountFeatures: (result.account.features ?? []).join(','),
    accountExpiresOn: result.account.expiresOn,
    // Only overwritten when the server sent one. A response without a licence
    // must not silently revoke the one already held — that is how a server
    // hiccup would downgrade a paying customer.
    ...(result.licence ? { licenceToken: result.licence } : {}),
    // Paying again clears the banner on the very next check.
    paymentFailedAt: null,
    // Any successful answer means the licence is good again, so a lapse that
    // has since been paid clears itself on the next check.
    lapsedReason: null,
    verifiedAt: new Date().toISOString()
  })
}

export async function authState(extra: Partial<AuthState> = {}): Promise<AuthState> {
  const config = await readConfig()
  const { tier, trial, updates } = await entitlement()

  return {
    signedIn: config.authToken !== null,
    account: accountFrom(config),
    configured: config.apiBaseUrl.trim() !== '',
    verifiedAt: config.verifiedAt,
    offline: false,
    // What they may do, rather than whether they may do anything. There is no
    // read-only state to report any more — an unconfirmed licence degrades to
    // Free once its grace window closes, and never to a wall.
    tier,
    trial,
    paymentFailed: config.paymentFailedAt !== null,
    updatesEndedOn: updates ? '' : (config.updatesEndedOn ?? ''),
    error: '',
    ...extra
  }
}

export async function signIn(email: string, password: string): Promise<AuthState> {
  const result = await call<SignInResult>('/licence/activate', {
    email: email.trim().toLowerCase(),
    password,
    ...(await device())
  })

  await store(result)
  return authState()
}

export async function signUp(
  name: string,
  email: string,
  password: string
): Promise<AuthState> {
  const result = await call<SignInResult>('/account/register', {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    ...(await device())
  })

  await store(result)
  return authState()
}

/**
 * Sign out and release the seat.
 *
 * The seat is released on a best effort — if the server cannot be reached the
 * local session still ends, because a sign-out that refuses to sign you out is
 * not a sign-out. The seat is reclaimed on the server's own schedule instead.
 */
export async function signOut(): Promise<AuthState> {
  const config = await readConfig()

  if (config.authToken && config.apiBaseUrl.trim() !== '') {
    try {
      await call('/licence/deactivate', await device(), config.authToken)
    } catch {
      // Nothing to do about it, and nothing that should stop the sign-out.
    }
  }

  await updateConfig({
    authToken: null,
    accountEmail: null,
    accountName: null,
    accountPlan: null,
    accountFeatures: null,
    accountExpiresOn: null,
    lapsedReason: null,
    verifiedAt: null,
    // The licence goes too. It is what actually grants anything now, so
    // leaving it behind would mean a signed-out machine kept Pro — and on a
    // shared or handed-on computer that is the entitlement given away.
    licenceToken: null,
    paymentFailedAt: null,
    updatesEndedOn: null,
    foundingNumber: null,
    referralCode: null
  })

  return authState()
}

/**
 * Re-confirm the licence with the server.
 *
 * Being unreachable is reported as `offline`, not as an error, and the app
 * carries on until the grace window runs out. Only the server actively saying
 * the licence is no longer valid ends the session.
 */
export async function verify(): Promise<AuthState> {
  const config = await readConfig()
  if (!config.authToken || config.apiBaseUrl.trim() === '') return authState()

  try {
    const result = await call<SignInResult>(
      '/licence/status',
      await device(),
      config.authToken
    )
    await store(result)
    return authState()
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'OfflineError') {
      return authState({ offline: true })
    }

    /**
     * Unpaid, not unwelcome.
     *
     * §3.4 holds the tier open through Stripe's retry window plus five days
     * rather than downgrading somebody whose card simply expired, so the
     * licence token is deliberately **not** cleared here — it carries its own
     * expiry, and letting that run out is what eventually drops them to Free.
     * What this records is the banner.
     *
     * `verifiedAt` is no longer stamped on this path. It used to be, which
     * meant a lapsed account refreshed its own grace clock on every check and
     * the window never actually closed.
     */
    if (cause instanceof Error && cause.name === 'LapsedError') {
      const now = await readConfig()
      await updateConfig({
        lapsedReason: cause.message,
        paymentFailedAt: now.paymentFailedAt ?? new Date().toISOString()
      })
      return authState()
    }

    // A definite no — revoked, refunded, or a token that is no longer good.
    // End the session so the next launch asks again, and take the licence with
    // it: a refund that left the entitlement behind would be a licence given
    // away for nothing.
    await updateConfig({
      authToken: null,
      verifiedAt: null,
      lapsedReason: null,
      licenceToken: null,
      paymentFailedAt: null
    })
    return authState({ error: cause instanceof Error ? cause.message : 'Licence check failed.' })
  }
}

/**
 * Whether the app should open at all.
 *
 * Deliberately generous, and deliberately not the same question as what the
 * licence is worth — that is `entitlement()`. An unpaid or unconfirmed licence
 * still opens, at Free if it has to, because the alternative is a person
 * locked out of files they own, on a machine they own, by an app that promised
 * the opposite. Only signing out, or a licence the server actively disowns,
 * closes the door.
 */
export async function isEntitled(): Promise<boolean> {
  const config = await readConfig()

  // No server configured: nothing to be entitled against.
  if (config.apiBaseUrl.trim() === '') return true
  return config.authToken !== null
}

/** Points the app at an account server. Empty turns licensing off again. */
export async function setApiBaseUrl(url: string): Promise<AuthState> {
  await updateConfig({ apiBaseUrl: url.trim() })
  return authState()
}

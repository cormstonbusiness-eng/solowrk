import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { AuthAccount, AuthState } from '@shared/types'
import { readConfig, updateConfig } from './config'

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
 */

/** How long a licence stays good without being re-confirmed. */
const GRACE_DAYS = 14

/** Long enough for a slow connection, short enough not to hang the sign-in. */
const TIMEOUT_MS = 20_000

interface SignInResult {
  token: string
  // `features` is optional so a server that predates tiers still works, and so
  // an early one can be built without it.
  account: Omit<AuthAccount, 'features'> & { features?: string[] }
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
    // Any successful answer means the licence is good again, so a lapse that
    // has since been paid clears itself on the next check.
    lapsedReason: null,
    verifiedAt: new Date().toISOString()
  })
}

/** Whether the grace window since the last successful check has run out. */
function graceExpired(verifiedAt: string | null): boolean {
  if (!verifiedAt) return false
  return Date.now() - new Date(verifiedAt).getTime() >= GRACE_DAYS * 24 * 60 * 60 * 1000
}

export async function authState(extra: Partial<AuthState> = {}): Promise<AuthState> {
  const config = await readConfig()
  const signedIn = config.authToken !== null
  const stale = graceExpired(config.verifiedAt)

  return {
    signedIn,
    account: accountFrom(config),
    configured: config.apiBaseUrl.trim() !== '',
    verifiedAt: config.verifiedAt,
    offline: false,
    // Both routes into read-only: the server said the licence has lapsed, or
    // it has not been reachable long enough that we stop taking its silence
    // as a yes. Neither is a reason to withhold someone's own work.
    readOnly: signedIn && (config.lapsedReason !== null || stale),
    lapsedReason:
      config.lapsedReason ??
      (signedIn && stale
        ? 'SoloWrk has not been able to confirm your licence for two weeks.'
        : ''),
    error: '',
    ...extra
  }
}

/** Whether the current plan unlocks something. Ungated when no server is set. */
export async function hasFeature(name: string): Promise<boolean> {
  const config = await readConfig()
  if (config.apiBaseUrl.trim() === '') return true
  return (config.accountFeatures ?? '').split(',').includes(name)
}

/** Whether writing is currently allowed. Cheap enough to ask on every call. */
export async function isReadOnly(): Promise<boolean> {
  const config = await readConfig()
  if (config.apiBaseUrl.trim() === '' || !config.authToken) return false
  return config.lapsedReason !== null || graceExpired(config.verifiedAt)
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
    verifiedAt: null
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

    // Unpaid, not unwelcome. The session stays, the app goes read-only, and
    // paying restores it on the next check without signing in again.
    if (cause instanceof Error && cause.name === 'LapsedError') {
      await updateConfig({ lapsedReason: cause.message, verifiedAt: new Date().toISOString() })
      return authState()
    }

    // A definite no — revoked, refunded, or a token that is no longer good.
    // End the session so the next launch asks again.
    await updateConfig({ authToken: null, verifiedAt: null, lapsedReason: null })
    return authState({ error: cause instanceof Error ? cause.message : 'Licence check failed.' })
  }
}

/**
 * Whether the app should open at all.
 *
 * Deliberately generous, and deliberately not the same question as whether it
 * can be written to. An unpaid or unconfirmed licence still opens — read-only,
 * see `isReadOnly` — because the alternative is a person locked out of files
 * they own, on a machine they own, by an app that promised the opposite.
 * Only signing out, or a licence the server actively disowns, closes the door.
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

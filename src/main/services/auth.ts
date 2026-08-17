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
  account: AuthAccount
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

    if (detail?.message) throw new Error(detail.message)
    if (response.status === 401) throw new Error('That email and password do not match.')
    if (response.status === 402) throw new Error('This account does not have an active licence.')
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
    expiresOn: config.accountExpiresOn ?? ''
  }
}

async function store(result: SignInResult): Promise<void> {
  await updateConfig({
    authToken: result.token,
    accountEmail: result.account.email,
    accountName: result.account.name,
    accountPlan: result.account.plan,
    accountExpiresOn: result.account.expiresOn,
    verifiedAt: new Date().toISOString()
  })
}

export async function authState(extra: Partial<AuthState> = {}): Promise<AuthState> {
  const config = await readConfig()

  return {
    signedIn: config.authToken !== null,
    account: accountFrom(config),
    configured: config.apiBaseUrl.trim() !== '',
    verifiedAt: config.verifiedAt,
    offline: false,
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
    accountExpiresOn: null,
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

    // A definite no. End the session so the next launch asks again.
    await updateConfig({ authToken: null, verifiedAt: null })
    return authState({ error: cause instanceof Error ? cause.message : 'Licence check failed.' })
  }
}

/** Whether the app should let someone in right now. */
export async function isEntitled(): Promise<boolean> {
  const config = await readConfig()

  // No server configured: nothing to be entitled against.
  if (config.apiBaseUrl.trim() === '') return true
  if (!config.authToken) return false
  if (!config.verifiedAt) return true

  const age = Date.now() - new Date(config.verifiedAt).getTime()
  return age < GRACE_DAYS * 24 * 60 * 60 * 1000
}

/** Points the app at an account server. Empty turns licensing off again. */
export async function setApiBaseUrl(url: string): Promise<AuthState> {
  await updateConfig({ apiBaseUrl: url.trim() })
  return authState()
}

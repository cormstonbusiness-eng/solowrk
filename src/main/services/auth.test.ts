import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

const { readConfig, updateConfig } = await import('./config')
const { authState, isEntitled, setApiBaseUrl, signIn, signOut } = await import('./auth')

const SERVER = 'https://example.com/api'

/** A successful licence response, in the shape the contract promises. */
const licence = {
  token: 'tok_abc',
  account: { email: 'alex@example.com', name: 'Alex', plan: 'Solo', expiresOn: '2027-01-01' }
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )
}

/** Backdate the last successful check, to age out of the grace window. */
async function verifiedDaysAgo(days: number): Promise<void> {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  await updateConfig({ verifiedAt: when.toISOString() })
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'solo-auth-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(userData, { recursive: true, force: true })
})

describe('gating', () => {
  it('lets everyone in when no account server is set', async () => {
    // The state before a licence backend exists. Gating the app against a
    // server that is not there would lock out every user including the author.
    expect(await isEntitled()).toBe(true)
    expect((await authState()).configured).toBe(false)
  })

  it('asks for a sign-in once a server is set', async () => {
    await setApiBaseUrl(SERVER)
    expect(await isEntitled()).toBe(false)
    expect((await authState()).configured).toBe(true)
  })

  it('turns licensing back off when the server is cleared', async () => {
    await setApiBaseUrl(SERVER)
    await setApiBaseUrl('')
    expect(await isEntitled()).toBe(true)
  })
})

describe('signing in', () => {
  it('stores the account and entitles the app', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)

    const state = await signIn('alex@example.com', 'hunter2')

    expect(state.signedIn).toBe(true)
    expect(state.account?.email).toBe('alex@example.com')
    expect(state.account?.plan).toBe('Solo')
    expect(await isEntitled()).toBe(true)
  })

  it('lowercases and trims the email', async () => {
    // Otherwise " Alex@Example.com " and "alex@example.com" are two accounts
    // as far as the server is concerned, and one of them cannot sign in.
    await setApiBaseUrl(SERVER)
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(licence), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await signIn('  Alex@Example.COM  ', 'hunter2')

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.email).toBe('alex@example.com')
  })

  it('sends a device id, and the same one every time', async () => {
    await setApiBaseUrl(SERVER)
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(licence), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await signIn('alex@example.com', 'hunter2')
    await signIn('alex@example.com', 'hunter2')

    const first = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).deviceId
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1].body)).deviceId

    expect(first).toBeTruthy()
    // A device id that changes would burn a seat on every sign-in.
    expect(second).toBe(first)
  })

  it('sends the platform, so seats can be counted per device type', async () => {
    // A licence allows two computers AND a phone, not three devices. The
    // server cannot tell those apart without this, and adding it later means
    // changing both sides at once.
    await setApiBaseUrl(SERVER)
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(licence), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await signIn('alex@example.com', 'hunter2')

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.platform).toBe('windows')
    expect(body.deviceName).toBeTruthy()
  })

  it('identifies the device the same way on every endpoint', async () => {
    // The server matches a seat on deviceId, so a sign-out that described the
    // device differently from the sign-in would fail to release it.
    await setApiBaseUrl(SERVER)
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(licence), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await signIn('alex@example.com', 'hunter2')
    await signOut()

    const [activate, deactivate] = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1].body))
    )

    expect(deactivate.deviceId).toBe(activate.deviceId)
    expect(deactivate.platform).toBe(activate.platform)
  })

  it('surfaces the server’s own message rather than a status code', async () => {
    await setApiBaseUrl(SERVER)
    respondWith({ message: 'This licence was refunded.' }, 403)

    await expect(signIn('alex@example.com', 'hunter2')).rejects.toThrow('This licence was refunded.')
  })

  it('explains a seat limit in words', async () => {
    await setApiBaseUrl(SERVER)
    respondWith({}, 409)

    await expect(signIn('alex@example.com', 'x')).rejects.toThrow(/maximum number of computers/)
  })

  it('does not sign in when the server rejects the password', async () => {
    await setApiBaseUrl(SERVER)
    respondWith({}, 401)

    await expect(signIn('alex@example.com', 'wrong')).rejects.toThrow(/do not match/)
    expect((await authState()).signedIn).toBe(false)
  })
})

describe('the offline grace window', () => {
  beforeEach(async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')
  })

  it('keeps working for days without reaching the server', async () => {
    // The whole point. Someone on a train must not lose access to their own
    // invoices because a tunnel ate the licence check.
    await verifiedDaysAgo(13)
    expect(await isEntitled()).toBe(true)
  })

  it('stops once the window has run out', async () => {
    await verifiedDaysAgo(15)
    expect(await isEntitled()).toBe(false)
  })

  it('treats an unreachable server as offline, not as unlicensed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND example.com')
      })
    )

    const { verify } = await import('./auth')
    const state = await verify()

    expect(state.offline).toBe(true)
    // Still signed in — the session survives a failed check.
    expect(state.signedIn).toBe(true)
    expect(await isEntitled()).toBe(true)
  })

  it('ends the session when the server actively says no', async () => {
    respondWith({ message: 'Licence cancelled.' }, 403)

    const { verify } = await import('./auth')
    const state = await verify()

    expect(state.signedIn).toBe(false)
    expect(state.offline).toBe(false)
    expect(await isEntitled()).toBe(false)
  })
})

describe('signing out', () => {
  it('clears the session even when the server cannot be told', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )

    // A sign-out that refuses to sign you out is not a sign-out.
    const state = await signOut()
    expect(state.signedIn).toBe(false)
    expect(state.account).toBeNull()
  })

  it('leaves the workspace pointer alone', async () => {
    // Signing out must never look like losing your data.
    await updateConfig({ workspacePath: 'C:\\Users\\alex\\Documents\\SoloWrk' })
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')
    await signOut()

    expect((await readConfig()).workspacePath).toBe('C:\\Users\\alex\\Documents\\SoloWrk')
  })
})

describe('config round-trip', () => {
  it('keeps every account field across a read and write', async () => {
    // parseConfig reads field by field, so a field added to AppConfig without
    // a line there is silently dropped on the next write — which would sign
    // the user out on the next launch for no visible reason.
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    // Force a write, then a fresh read from disk.
    await updateConfig({ lastBackupAt: '2026-08-17T00:00:00.000Z' })
    const config = await readConfig()

    expect(config.apiBaseUrl).toBe(SERVER)
    expect(config.authToken).toBe('tok_abc')
    expect(config.accountEmail).toBe('alex@example.com')
    expect(config.accountName).toBe('Alex')
    expect(config.accountPlan).toBe('Solo')
    expect(config.accountExpiresOn).toBe('2027-01-01')
    expect(config.deviceId).toBeTruthy()
    expect(config.verifiedAt).toBeTruthy()
  })

  it('survives a config file that predates accounts', async () => {
    // Every existing install has one of these. It must not throw.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      join(userData, 'solo.config.json'),
      JSON.stringify({ workspacePath: 'C:\\old', lastBackupAt: null })
    )

    const config = await readConfig()
    expect(config.workspacePath).toBe('C:\\old')
    expect(config.apiBaseUrl).toBe('')
    expect(config.authToken).toBeNull()
    expect(await isEntitled()).toBe(true)
  })
})

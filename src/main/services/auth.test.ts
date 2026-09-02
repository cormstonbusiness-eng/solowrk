import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

import { API_BASE } from '@shared/site'
const { readConfig, updateConfig } = await import('./config')
const { authState, signIn, signOut } = await import('./auth')

const SERVER = 'https://example.com/api'

/**
 * Point the app at a fake server.
 *
 * The environment variable is the only way left: the account server is now a
 * fact about the build rather than something an install can be told, so there
 * is no setter to call. That is what the tests below are checking works.
 */
function useServer(url: string = SERVER): void {
  process.env.SOLOWRK_API_BASE = url
}

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
  delete process.env.SOLOWRK_API_BASE
  await rm(userData, { recursive: true, force: true })
})

describe('gating', () => {
  it('points at the real server unless told otherwise', async () => {
    /*
      The default that makes licensing possible at all. It used to be empty,
      which meant a fresh install never contacted a server — so every paying
      customer would have sat on Free until they found a text box in Settings
      and typed a URL into it.
    */
    expect((await readConfig()).apiBaseUrl).toBe(API_BASE)
    expect((await authState()).configured).toBe(true)
  })

  it('ignores an address left behind in the config file', async () => {
    /*
      The case this replaces: a value written once — during development, or by
      following a support instruction — used to outlive its reason and become
      the server that install talked to forever. No update could correct it,
      because an update does not rewrite the file.

      So the stored field is not read back. A release talks to the server it
      shipped for, and moving the server is a release rather than an
      instruction issued to every existing user.
    */
    await updateConfig({ apiBaseUrl: 'http://localhost:3000/api' })

    expect((await readConfig()).apiBaseUrl).toBe(API_BASE)
    expect((await authState()).configured).toBe(true)
  })

  it('asks for a sign-in once a server is set', async () => {
    useServer()
    expect((await authState()).configured).toBe(true)
  })
})

describe('signing in', () => {
  it('stores the account and entitles the app', async () => {
    useServer()
    respondWith(licence)

    const state = await signIn('alex@example.com', 'hunter2')

    expect(state.signedIn).toBe(true)
    expect(state.account?.email).toBe('alex@example.com')
    expect(state.account?.plan).toBe('Solo')
  })

  it('lowercases and trims the email', async () => {
    // Otherwise " Alex@Example.com " and "alex@example.com" are two accounts
    // as far as the server is concerned, and one of them cannot sign in.
    useServer()
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
    useServer()
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
    useServer()
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
    useServer()
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
    useServer()
    respondWith({ message: 'This licence was refunded.' }, 403)

    await expect(signIn('alex@example.com', 'hunter2')).rejects.toThrow('This licence was refunded.')
  })

  it('explains a seat limit in words', async () => {
    useServer()
    respondWith({}, 409)

    await expect(signIn('alex@example.com', 'x')).rejects.toThrow(/maximum number of computers/)
  })

  it('does not sign in when the server rejects the password', async () => {
    useServer()
    respondWith({}, 401)

    await expect(signIn('alex@example.com', 'wrong')).rejects.toThrow(/do not match/)
    expect((await authState()).signedIn).toBe(false)
  })
})

describe('the offline grace window', () => {
  beforeEach(async () => {
    useServer()
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')
  })

  it('still opens once the window has run out, rather than locking', async () => {
    // The app still opens, and everything in it stays editable. §3.4 replaced
    // read-only with degrading to Free: a licence that cannot be confirmed
    // stops granting paid features, but a locked door would be the app
    // breaking its own promise at the worst possible moment.
    await verifiedDaysAgo(15)

    expect((await authState()).signedIn).toBe(true)
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
  })

  /**
   * A status code is not always an answer.
   *
   * These all used to fall through to "the server said no", which ended the
   * session and deleted the licence on the machine. A deploy rolling, a
   * function hitting its host's time limit, or a rate limiter doing its job
   * would each have signed a paying customer out.
   */
  for (const status of [500, 502, 503, 504, 408, 429]) {
    it(`treats ${status} as offline, not as a rejection`, async () => {
      respondWith({}, status)

      const { verify } = await import('./auth')
      const state = await verify()

      expect(state.offline).toBe(true)
      expect(state.signedIn).toBe(true)
      // The session token stays on disk: nothing has disowned it. This is
      // the value the old behaviour cleared, which is what signed people out.
      expect((await readConfig()).authToken).not.toBeNull()
    })
  }

  it('ends the session when the server actively says no', async () => {
    respondWith({ message: 'Licence cancelled.' }, 403)

    const { verify } = await import('./auth')
    const state = await verify()

    expect(state.signedIn).toBe(false)
    expect(state.offline).toBe(false)
  })
})

describe('signing out', () => {
  it('clears the session even when the server cannot be told', async () => {
    useServer()
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
    useServer()
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')
    await signOut()

    expect((await readConfig()).workspacePath).toBe('C:\\Users\\alex\\Documents\\SoloWrk')
  })
})

describe('the signed licence', () => {
  /**
   * What a licence is *worth* is `entitlements.ts`, and is tested there. What
   * belongs here is only whether this file stores and clears the token
   * correctly, because both mistakes are expensive in opposite directions.
   */

  it('keeps the licence the server issued', async () => {
    useServer()
    respondWith({ ...licence, licence: 'signed.licence' })
    await signIn('alex@example.com', 'hunter2')

    expect((await readConfig()).licenceToken).toBe('signed.licence')
  })

  it('does not revoke a held licence when a response omits one', async () => {
    // A server hiccup, or an older deployment. Treating a missing licence as
    // "no licence" would downgrade a paying customer on a bad afternoon.
    useServer()
    respondWith({ ...licence, licence: 'signed.licence' })
    await signIn('alex@example.com', 'hunter2')

    respondWith(licence)
    const { verify } = await import('./auth')
    await verify()

    expect((await readConfig()).licenceToken).toBe('signed.licence')
  })

  it('forgets it on sign-out', async () => {
    useServer()
    respondWith({ ...licence, licence: 'signed.licence' })
    await signIn('alex@example.com', 'hunter2')
    await signOut()

    expect((await readConfig()).licenceToken).toBeNull()
  })
})

describe('a lapsed subscription', () => {
  beforeEach(async () => {
    useServer()
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')
  })

  it('raises a banner instead of signing the user out', async () => {
    // 402 means the account is real and the subscription is not paid. Ending
    // the session there would put someone's own files behind a login they
    // cannot pass, which is the one outcome this app must never produce.
    respondWith({ message: 'Your subscription payment failed.' }, 402)

    const { verify } = await import('./auth')
    const state = await verify()

    expect(state.signedIn).toBe(true)
    expect(state.paymentFailed).toBe(true)
  })

  it('does not throw the licence away over a failed payment', async () => {
    // §3.4 holds the tier open through Stripe's retry window plus five days.
    // Clearing the licence here would downgrade somebody whose card merely
    // expired, in the week they are most likely to be annoyed by it.
    await updateConfig({ licenceToken: 'signed.licence' })
    respondWith({ message: 'Your subscription payment failed.' }, 402)

    const { verify } = await import('./auth')
    await verify()

    expect((await readConfig()).licenceToken).toBe('signed.licence')
  })

  it('does not keep restarting its own grace clock', async () => {
    // Regression. `verifiedAt` used to be stamped on the 402 path, so a lapsed
    // account refreshed the grace window on every six-hourly check and it
    // never actually closed.
    await verifiedDaysAgo(10)
    const before = (await readConfig()).verifiedAt

    respondWith({ message: 'Your subscription payment failed.' }, 402)
    const { verify } = await import('./auth')
    await verify()

    expect((await readConfig()).verifiedAt).toBe(before)
  })

  it('lifts as soon as the licence is good again', async () => {
    respondWith({ message: 'Your subscription payment failed.' }, 402)
    const { verify } = await import('./auth')
    await verify()

    // They pay. No signing in again — the token was never thrown away.
    respondWith(licence)
    const state = await verify()

    expect(state.paymentFailed).toBe(false)
  })

  it('still ends the session when the licence is revoked outright', async () => {
    // A refund or a chargeback is not a missed payment, and 403 still closes
    // the door. The two cases have to stay distinguishable.
    await updateConfig({ licenceToken: 'signed.licence' })
    respondWith({ message: 'This licence was refunded.' }, 403)

    const { verify } = await import('./auth')
    const state = await verify()

    expect(state.signedIn).toBe(false)
    // And the licence goes with it, or a refund would leave the entitlement
    // behind and the app would have been given away for nothing.
    expect((await readConfig()).licenceToken).toBeNull()
  })

  it('holds on to the licence merely for being offline', async () => {
    await updateConfig({ licenceToken: 'signed.licence' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )

    const { verify } = await import('./auth')
    expect((await verify()).offline).toBe(true)
    expect((await readConfig()).licenceToken).toBe('signed.licence')
  })
})

describe('config round-trip', () => {
  it('keeps every account field across a read and write', async () => {
    // parseConfig reads field by field, so a field added to AppConfig without
    // a line there is silently dropped on the next write — which would sign
    // the user out on the next launch for no visible reason.
    useServer()
    respondWith({ ...licence, account: { ...licence.account, features: ['assistant'] } })
    await signIn('alex@example.com', 'hunter2')

    // Force a write, then a fresh read from disk.
    await updateConfig({ lastBackupAt: '2026-08-17T00:00:00.000Z' })
    const config = await readConfig()

    expect(config.apiBaseUrl).toBe(SERVER)
    expect(config.authToken).toBe('tok_abc')
    expect(config.accountEmail).toBe('alex@example.com')
    expect(config.accountName).toBe('Alex')
    expect(config.accountPlan).toBe('Solo')
    expect(config.accountFeatures).toBe('assistant')
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
    /*
      Lands on the real server rather than on nothing. An old config with no
      value must not leave an existing customer quietly unlicensed after an
      update — they would have no way of knowing why.
    */
    expect(config.apiBaseUrl).toBe(API_BASE)
    expect(config.authToken).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

const { readConfig, updateConfig } = await import('./config')
const { setApiBaseUrl, signIn } = await import('./auth')
const { checkLicence, startLicenceChecks, stopLicenceChecks } = await import('./licence')

const SERVER = 'https://example.com/api'

const licence = {
  token: 'tok_abc',
  account: {
    email: 'alex@example.com',
    name: 'Alex',
    plan: 'Pro',
    features: ['assistant'],
    expiresOn: '2027-01-01'
  }
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )
}

/** Backdate the last successful check, as if nothing had confirmed it since. */
async function verifiedDaysAgo(days: number): Promise<void> {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  await updateConfig({ verifiedAt: when.toISOString() })
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'solo-licence-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(userData, { recursive: true, force: true })
})

describe('the background licence check', () => {
  it('does nothing at all when no account server is set', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)

    await checkLicence()

    // The state of every install today. A check here would be a request to
    // nowhere, four times a day, forever.
    expect(fetched).not.toHaveBeenCalled()
  })

  it('does nothing when nobody is signed in', async () => {
    await setApiBaseUrl(SERVER)
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)

    await checkLicence()

    expect(fetched).not.toHaveBeenCalled()
  })

  it('winds the grace clock forward, which is the whole point', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    // Thirteen days of nobody pressing anything. One more and the app would
    // have gone read-only on a licence that was never in any doubt.
    await verifiedDaysAgo(13)
    const stale = (await readConfig()).verifiedAt

    await checkLicence()

    const fresh = (await readConfig()).verifiedAt
    expect(fresh).not.toBe(stale)
    expect(Date.now() - new Date(fresh ?? 0).getTime()).toBeLessThan(5000)
  })

  it('leaves the session alone when the server cannot be reached', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND example.com')
      })
    )

    await checkLicence()

    // Offline is not unlicensed. A train tunnel must not sign anyone out.
    expect((await readConfig()).authToken).toBe('tok_abc')
    expect((await readConfig()).lapsedReason).toBeNull()
  })

  it('records a lapse without ending the session', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    respondWith({ message: 'Your card was declined on 3 August.' }, 402)
    await checkLicence()

    const config = await readConfig()
    expect(config.authToken).toBe('tok_abc')
    expect(config.lapsedReason).toBe('Your card was declined on 3 August.')
  })

  it('clears a lapse once the licence is paid again', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    respondWith({ message: 'Your card was declined on 3 August.' }, 402)
    await checkLicence()
    expect((await readConfig()).lapsedReason).not.toBeNull()

    respondWith(licence)
    await checkLicence()
    expect((await readConfig()).lapsedReason).toBeNull()
  })

  it('ends the session when the licence is disowned', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    respondWith({ message: 'This licence was refunded on 3 August.' }, 403)
    await checkLicence()

    expect((await readConfig()).authToken).toBeNull()
  })

  it('never throws, whatever the server does', async () => {
    await setApiBaseUrl(SERVER)
    respondWith(licence)
    await signIn('alex@example.com', 'hunter2')

    // A timer callback that can reject takes the main process with it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    )

    await expect(checkLicence()).resolves.toBeUndefined()
  })
})
describe('a tier that changes with no server involved', () => {
  /**
   * The regression this exists for.
   *
   * `checkLicence` used to return early whenever no account server was
   * configured — reasonable when a licence could only ever come from one. But
   * a trial expires from a date in the config and needs no network at all, so
   * the early return meant the main process quietly began refusing while the
   * renderer carried on showing Pro: no padlocks, Marketing still in the
   * sidebar, and a raw IPC error the moment anybody clicked it.
   */
  function watchPushes(): { sent: unknown[] } {
    const sent: unknown[] = []
    startLicenceChecks(
      () => ({ webContents: { send: (_e: string, payload: unknown) => sent.push(payload) } }) as never
    )
    // The timers are not the thing under test, and a 15s first check would
    // outlive the test either way.
    stopLicenceChecks()
    return { sent }
  }

  it('tells the renderer when the trial runs out', async () => {
    const { sent } = watchPushes()

    // Mid-trial: the app has already told the renderer it is Pro.
    await updateConfig({ installedAt: new Date(Date.now() - 3 * 864e5).toISOString() })
    await checkLicence()
    sent.length = 0

    // The clock moves past day fourteen while the app is left open.
    await updateConfig({ installedAt: new Date(Date.now() - 20 * 864e5).toISOString() })
    await checkLicence()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ tier: 'free' })
  })

  it('says nothing when nothing moved', async () => {
    // It runs every six hours forever. Pushing on every tick would re-render
    // the app four times a day for no reason.
    const { sent } = watchPushes()

    await updateConfig({ installedAt: new Date(Date.now() - 3 * 864e5).toISOString() })
    await checkLicence()
    sent.length = 0

    await checkLicence()
    expect(sent).toHaveLength(0)
  })

  it('reports the countdown ticking down', async () => {
    // The trial bar reads `daysLeft`, so a day passing has to reach it.
    const { sent } = watchPushes()

    await updateConfig({ installedAt: new Date(Date.now() - 10 * 864e5).toISOString() })
    await checkLicence()
    sent.length = 0

    await updateConfig({ installedAt: new Date(Date.now() - 11 * 864e5).toISOString() })
    await checkLicence()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ trial: { daysLeft: 3, showCountdown: true } })
  })
})

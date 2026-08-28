import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { LicenceClaims } from '@shared/licence'
import { limitFactsFrom } from '@shared/limitError'
import { today } from '@shared/taxYear'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { readConfig, updateConfig } = await import('./config')
const { getState, STATE_KEYS } = await import('./appState')
const { currentTier, entitlement, exceeded, meters, remaining, requireCapacity, usage } =
  await import('./entitlements')

/**
 * Tier meets database.
 *
 * The costly mistakes here are asymmetric. Refusing somebody who paid is
 * visible and infuriating; giving Pro away is invisible and permanent. So the
 * tests below spend most of their time on the second kind — an unreadable
 * token, a missing config, a deleted file — where the answer must be Free.
 */

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const CLAIMS: LicenceClaims = {
  v: 1,
  account_id: 'acc_1',
  licence_id: 'lic_1',
  licence_type: 'subscription',
  tier: 'pro',
  billing_period: 'annual',
  expires_at: '2099-01-01T00:00:00Z',
  device_limit: 2,
  device_fingerprint: 'sha256:abc',
  referral_code: null,
  founding_number: null,
  issued_at: '2026-08-28T10:14:00Z',
  grandfathered_price_id: null,
  updates: true
}

function tokenFor(claims: Partial<LicenceClaims> = {}): string {
  const body = Buffer.from(JSON.stringify({ ...CLAIMS, ...claims }), 'utf8')
  return `${body.toString('base64url')}.${signBytes(null, body, privateKey).toString('base64url')}`
}

/** Signed in on a given tier, with the trial well behind them. */
async function licensedAs(tier: string): Promise<void> {
  await updateConfig({
    licenceToken: tokenFor({ tier }),
    installedAt: '2020-01-01T00:00:00Z'
  })
}

/** No licence, and the trial long gone — the plain Free case. */
async function free(): Promise<void> {
  await updateConfig({ licenceToken: null, installedAt: '2020-01-01T00:00:00Z' })
}

let db: InstanceType<typeof Database>

function addClients(n: number): void {
  for (let i = 0; i < n; i += 1) {
    db.run(
      `INSERT INTO clients (name, folder, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`,
      [`Client ${i}`, `client-${i}`]
    )
  }
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'solo-ent-'))
  process.env.SOLOWRK_LICENCE_PUBLIC_KEY = publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64')
  db = new Database(':memory:')
})

afterEach(async () => {
  db.close()
  delete process.env.SOLOWRK_LICENCE_PUBLIC_KEY
  await rm(userData, { recursive: true, force: true })
})

describe('which tier', () => {
  it('is Pro during the trial, with no licence and no account', async () => {
    await updateConfig({ installedAt: new Date().toISOString() })
    expect(await currentTier(db)).toBe('pro')
  })

  it('is Free once the trial has run out', async () => {
    await free()
    expect(await currentTier(db)).toBe('free')
  })

  it('is whatever a valid licence says', async () => {
    await licensedAs('basic_plus')
    expect(await currentTier(db)).toBe('basicPlus')
  })

  it('is Free for a licence signed by somebody else', async () => {
    // The forgery case, end to end: a token that does not verify is worth
    // exactly nothing, not "whatever it claims".
    const forger = generateKeyPairSync('ed25519')
    const body = Buffer.from(JSON.stringify(CLAIMS), 'utf8')
    await updateConfig({
      licenceToken: `${body.toString('base64url')}.${signBytes(null, body, forger.privateKey).toString('base64url')}`,
      installedAt: '2020-01-01T00:00:00Z'
    })

    expect(await currentTier(db)).toBe('free')
  })

  it('is Free when the config has been deleted outright', async () => {
    // The single most valuable assertion in this file. Before this change an
    // empty config meant "ungated", so deleting one JSON file was free Pro
    // forever. It must now read as a first run — trial at most, never Pro
    // in perpetuity.
    await rm(join(userData, 'solo.config.json'), { force: true })

    const now = await entitlement(db)
    expect(now.licence).toBeNull()
    expect(['free', 'pro']).toContain(now.tier)
    expect(now.trial.active || now.tier === 'free').toBe(true)
  })
})

describe('the trial anchor', () => {
  it('is written to the config and mirrored into the workspace', async () => {
    await entitlement(db)

    const config = await readConfig()
    expect(config.installedAt).not.toBeNull()
    expect(getState(db, STATE_KEYS.installedAt)).toBe(config.installedAt)
  })

  it('takes the older of the two, so neither copy can extend a trial', async () => {
    // Deleting the config would otherwise buy another fortnight of Pro, and
    // restoring an old workspace would do the same in the other direction.
    await updateConfig({ installedAt: '2026-08-20T00:00:00Z' })
    const { setState } = await import('./appState')
    setState(db, STATE_KEYS.installedAt, '2020-01-01T00:00:00Z')

    await entitlement(db)

    expect((await readConfig()).installedAt).toBe('2020-01-01T00:00:00Z')
  })
})

describe('counting against a limit', () => {
  it('lets a Free user create up to three clients', async () => {
    await free()
    addClients(2)

    expect(usage(db, 'clients')).toBe(2)
    expect(await remaining(db, 'clients')).toBe(1)
    await expect(requireCapacity(db, 'clients')).resolves.toBeUndefined()
  })

  it('refuses the fourth, and says enough to explain itself', async () => {
    await free()
    addClients(3)

    // §4.2: the create action never silently fails. The modal needs all of
    // this, and a bare throw would leave it with nothing to render.
    await expect(requireCapacity(db, 'clients')).rejects.toThrow()

    const facts = await requireCapacity(db, 'clients').catch((error) => limitFactsFrom(error))
    expect(facts).toEqual({ limit: 'clients', used: 3, cap: 3, tier: 'free', needs: 'basicPlus' })
  })

  it('does not count an archived client against the living ones', async () => {
    await free()
    addClients(3)
    db.run('UPDATE clients SET archived = 1 WHERE id = 1')

    expect(usage(db, 'clients')).toBe(2)
    await expect(requireCapacity(db, 'clients')).resolves.toBeUndefined()
  })

  it('never refuses a paid tier', async () => {
    await licensedAs('basic_plus')
    addClients(200)

    expect(await remaining(db, 'clients')).toBe(Infinity)
    await expect(requireCapacity(db, 'clients')).resolves.toBeUndefined()
  })
})

describe('the limits that reset with the month', () => {
  function addInvoice(issueDate: string, number: string): void {
    db.run(
      `INSERT INTO invoices (number, status, issue_date, due_date, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, datetime('now'), datetime('now'))`,
      [number, issueDate, issueDate]
    )
  }

  it('counts this month and ignores last', async () => {
    await free()
    const month = today().slice(0, 7)

    addInvoice(`${month}-05`, 'INV-1')
    addInvoice('2020-01-05', 'INV-OLD')

    expect(usage(db, 'invoicesPerMonth')).toBe(1)
  })

  it('counts a running timer, and only a running one', async () => {
    await free()
    db.run(
      `INSERT INTO time_entries (started_at, ended_at, created_at, updated_at)
       VALUES (datetime('now'), NULL, datetime('now'), datetime('now'))`
    )
    db.run(
      `INSERT INTO time_entries (started_at, ended_at, created_at, updated_at)
       VALUES (datetime('now'), datetime('now'), datetime('now'), datetime('now'))`
    )

    expect(usage(db, 'activeTimers')).toBe(1)
  })
})

describe('being over a limit', () => {
  it('reports it without hiding anything', async () => {
    // §4.3. Somebody who drops to Free with forty clients keeps all forty,
    // readable and editable; only the forty-first is refused. This is the
    // notice that says so out loud rather than letting them find out.
    await free()
    addClients(40)

    expect(await exceeded(db)).toEqual([{ limit: 'clients', used: 40, cap: 3 }])
    expect(usage(db, 'clients')).toBe(40)
  })

  it('reports nothing on a paid tier', async () => {
    await licensedAs('pro')
    addClients(40)

    expect(await exceeded(db)).toEqual([])
  })
})

describe('the meters', () => {
  it('send an absent cap as null rather than as Infinity', async () => {
    // JSON.stringify(Infinity) is null, so being explicit beats discovering
    // the coercion somewhere in the renderer.
    await licensedAs('pro')

    expect((await meters(db)).find((one) => one.limit === 'clients')?.cap).toBeNull()
  })

  it('gives a Free user a number for everything', async () => {
    await free()

    for (const meter of await meters(db)) {
      expect(typeof meter.used).toBe('number')
      expect(meter.cap).not.toBeUndefined()
    }
  })
})
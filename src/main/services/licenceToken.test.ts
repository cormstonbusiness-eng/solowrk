import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import type { LicenceClaims } from '@shared/licence'
import { peekClaims, verifyLicence } from './licenceToken'

/**
 * The signature, and what it refuses.
 *
 * This is the file standing between the product and somebody writing
 * `"tier": "pro"` into a JSON file, so the tests that matter are the negative
 * ones. A test that only proves a good token works would pass just as happily
 * against a function that returned Pro for everything.
 */

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_BASE64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

/** A second, unrelated key — the forger's. */
const other = generateKeyPairSync('ed25519')

const CLAIMS: LicenceClaims = {
  v: 1,
  account_id: 'acc_1',
  licence_id: 'lic_1',
  licence_type: 'subscription',
  tier: 'pro',
  billing_period: 'annual',
  expires_at: '2027-08-28T00:00:00Z',
  device_limit: 2,
  device_fingerprint: 'sha256:abc',
  referral_code: 'CRAIG-4K2P',
  founding_number: null,
  issued_at: '2026-08-28T10:14:00Z',
  grandfathered_price_id: null,
  updates: true
}

function tokenFor(claims: Partial<LicenceClaims>, key = privateKey): string {
  const body = Buffer.from(JSON.stringify({ ...CLAIMS, ...claims }), 'utf8')
  return `${body.toString('base64url')}.${signBytes(null, body, key).toString('base64url')}`
}

beforeEach(() => {
  process.env.SOLOWRK_LICENCE_PUBLIC_KEY = PUBLIC_BASE64
})

afterEach(() => {
  delete process.env.SOLOWRK_LICENCE_PUBLIC_KEY
})

describe('a good licence', () => {
  it('reads out as the app understands it', () => {
    const { licence } = verifyLicence(tokenFor({}))

    expect(licence).toMatchObject({
      accountId: 'acc_1',
      tier: 'pro',
      type: 'subscription',
      deviceLimit: 2,
      updates: true
    })
  })

  it('maps the tier out of the wire spelling', () => {
    // The server writes basic_plus; nothing inside the app should ever see it.
    expect(verifyLicence(tokenFor({ tier: 'basic_plus' })).licence?.tier).toBe('basicPlus')
  })

  it('needs no network to do any of it', () => {
    // The whole basis of §3.1's lifetime licence. If this ever needs a fetch,
    // a lifetime holder offline in 2034 stops being Pro.
    expect(verifyLicence(tokenFor({})).licence).not.toBeNull()
  })
})

describe('what it refuses', () => {
  it('refuses a licence signed by anyone else', () => {
    // The forgery this file exists to stop.
    expect(verifyLicence(tokenFor({ tier: 'pro' }, other.privateKey)).licence).toBeNull()
  })

  it('refuses claims edited after signing', () => {
    const good = tokenFor({ tier: 'free' })
    const [, signature] = good.split('.')
    const tampered = Buffer.from(JSON.stringify({ ...CLAIMS, tier: 'pro' }), 'utf8')

    const forged = `${tampered.toString('base64url')}.${signature}`

    expect(verifyLicence(forged).licence).toBeNull()
  })

  it('refuses a version it does not understand', () => {
    // Properly signed, but from a future the app cannot reason about. Better
    // Free than guessing at semantics that have changed.
    const result = verifyLicence(tokenFor({ v: 2 }))
    expect(result.licence).toBeNull()
    expect(result.reason).toContain('version 2')
  })

  it('refuses a lifetime licence that carries an expiry', () => {
    // §3.1's warning made a test: a distant expiry is still an expiry, and it
    // would fire on somebody years from now with no way to explain it.
    expect(
      verifyLicence(
        tokenFor({ licence_type: 'lifetime', expires_at: '2034-01-01T00:00:00Z' })
      ).licence
    ).toBeNull()
  })

  it('refuses a tier it has never heard of', () => {
    expect(verifyLicence(tokenFor({ tier: 'enterprise' })).licence).toBeNull()
  })

  it('never throws, whatever it is handed', () => {
    // Every caller is asking what the user is entitled to. The answer for a
    // corrupt file is Free, not a dialogue they cannot get past.
    for (const bad of [null, '', '   ', 'nonsense', 'a.b', '....', '%%%.%%%']) {
      expect(() => verifyLicence(bad)).not.toThrow()
      expect(verifyLicence(bad).licence).toBeNull()
    }
  })
})

describe('a lifetime licence', () => {
  it('carries its founding number through', () => {
    const { licence } = verifyLicence(
      tokenFor({ licence_type: 'lifetime', expires_at: null, founding_number: 47 })
    )

    expect(licence).toMatchObject({ type: 'lifetime', expiresAt: null, foundingNumber: 47 })
  })
})

describe('peeking', () => {
  it('reads claims without vouching for them', () => {
    // Support diagnostics only. It must not be mistaken for verification, so
    // it deliberately answers for a token signed by the wrong key.
    expect(peekClaims(tokenFor({ tier: 'pro' }, other.privateKey))?.tier).toBe('pro')
    expect(peekClaims('rubbish')).toBeNull()
  })
})
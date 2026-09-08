import { describe, expect, it } from 'vitest'
import {
  GRACE_DAYS,
  TRIAL_DAYS,
  daysPastExpiry,
  effectiveTier,
  hasExpired,
  licenceTrial,
  tierFor,
  toLicence,
  trialStatus,
  withinGrace,
  type Licence,
  type LicenceClaims
} from './licence'

/**
 * What a licence is worth on a given day.
 *
 * The arithmetic that decides whether somebody can carry on working, so the
 * cases here are the ones where getting it wrong is expensive: the paying
 * customer on a plane, and the lifetime holder in a decade's time.
 */

const SUBSCRIPTION: Licence = {
  accountId: 'acc_1',
  licenceId: 'lic_1',
  type: 'subscription',
  tier: 'pro',
  billingPeriod: 'annual',
  expiresAt: '2026-08-01T00:00:00Z',
  deviceLimit: 2,
  deviceFingerprint: 'sha256:abc',
  referralCode: null,
  foundingNumber: null,
  issuedAt: '2025-08-01T00:00:00Z',
  grandfatheredPriceId: null,
  updates: true,
  trial: false
}

const LIFETIME: Licence = {
  ...SUBSCRIPTION,
  type: 'lifetime',
  expiresAt: null,
  billingPeriod: null,
  foundingNumber: 47
}

const at = (iso: string): Date => new Date(iso)

describe('a live subscription', () => {
  it('is worth its tier', () => {
    expect(tierFor(SUBSCRIPTION, at('2026-07-31T00:00:00Z'))).toBe('pro')
    expect(hasExpired(SUBSCRIPTION, at('2026-07-31T00:00:00Z'))).toBe(false)
  })
})

describe('the grace window', () => {
  it('keeps a customer working the day after it expires', () => {
    // Somebody whose renewal is mid-flight has not stopped paying, and §3.4
    // forbids a hard cannot-verify wall in any case.
    expect(tierFor(SUBSCRIPTION, at('2026-08-02T00:00:00Z'))).toBe('pro')
  })

  it('keeps them working on the last day of it', () => {
    const lastDay = at('2026-08-14T12:00:00Z')

    expect(daysPastExpiry(SUBSCRIPTION, lastDay)).toBe(GRACE_DAYS - 1)
    expect(withinGrace(SUBSCRIPTION, lastDay)).toBe(true)
    expect(tierFor(SUBSCRIPTION, lastDay)).toBe('pro')
  })

  it('drops to Free once it is exhausted, and not before', () => {
    expect(tierFor(SUBSCRIPTION, at('2026-08-15T00:00:00Z'))).toBe('free')
  })

  it('measures against the day it is asked about, not today', () => {
    // Regression: `daysPastExpiry` dropped its `now` argument when asking
    // whether the licence had expired, so it silently consulted the real
    // clock. Every test above still passed, because the fixture expires in the
    // past either way. A licence that expires in the future is what catches it.
    const future: Licence = { ...SUBSCRIPTION, expiresAt: '2099-01-01T00:00:00Z' }

    expect(daysPastExpiry(future, at('2098-01-01T00:00:00Z'))).toBe(0)
    expect(withinGrace(future, at('2098-01-01T00:00:00Z'))).toBe(true)
  })

  it('drops to Free rather than to a locked state', () => {
    // The whole of §3.4. There is no third answer here on purpose — read-only
    // was removed as a state, so "expired" can only ever mean Free.
    const longGone = at('2030-01-01T00:00:00Z')
    expect(tierFor(SUBSCRIPTION, longGone)).toBe('free')
  })
})

describe('a lifetime licence', () => {
  it('never expires, however far ahead you look', () => {
    // §3.1: "a distant expiry is still an expiry, and it will eventually fire
    // on someone in 2034". This is that test.
    for (const when of ['2034-01-01T00:00:00Z', '2099-12-31T00:00:00Z']) {
      expect(hasExpired(LIFETIME, at(when))).toBe(false)
      expect(tierFor(LIFETIME, at(when))).toBe('pro')
    }
  })

  it('is never in a grace window, because it is never out of one', () => {
    expect(withinGrace(LIFETIME, at('2099-12-31T00:00:00Z'))).toBe(true)
    expect(daysPastExpiry(LIFETIME, at('2099-12-31T00:00:00Z'))).toBe(0)
  })
})

describe('no licence at all', () => {
  it('is Free, not an error', () => {
    expect(tierFor(null)).toBe('free')
  })
})

describe('reading the wire format', () => {
  const claims: LicenceClaims = {
    v: 1,
    account_id: 'acc_1',
    licence_id: 'lic_1',
    licence_type: 'subscription',
    tier: 'basic_plus',
    billing_period: 'monthly',
    expires_at: '2027-01-01T00:00:00Z',
    device_limit: 2,
    device_fingerprint: 'sha256:abc',
    referral_code: null,
    founding_number: null,
    issued_at: '2026-08-28T10:14:00Z',
    grandfathered_price_id: 'price_123',
    updates: true
  }

  it('converts snake_case to the names used inside the app', () => {
    expect(toLicence(claims)).toMatchObject({
      accountId: 'acc_1',
      tier: 'basicPlus',
      billingPeriod: 'monthly',
      grandfatheredPriceId: 'price_123'
    })
  })

  it('refuses rather than throwing, so the caller can fall back to Free', () => {
    expect(toLicence({ ...claims, v: 99 })).toBeNull()
    expect(toLicence({ ...claims, tier: 'platinum' })).toBeNull()
  })
})

describe('the trial', () => {
  const installed = '2026-08-01T09:00:00Z'

  it('is Pro from the moment the app is installed', () => {
    // No card, no account. §1.4 calls requiring one the single biggest
    // drop-off point in desktop onboarding.
    expect(effectiveTier(null, installed, at('2026-08-01T10:00:00Z'))).toBe('pro')
    expect(trialStatus(installed, at('2026-08-01T10:00:00Z')).active).toBe(true)
  })

  it('lasts a week and then becomes Free, not a wall', () => {
    // Installed on the 1st, so the 7th is the last day of Pro and the 8th is
    // the first day of Free. Free is a smaller app, never a locked one.
    expect(effectiveTier(null, installed, at('2026-08-07T09:00:00Z'))).toBe('pro')
    expect(effectiveTier(null, installed, at('2026-08-08T09:00:00Z'))).toBe('free')
  })

  it('shows the countdown from day 4 and not before', () => {
    // §5.4. Earlier than this and it is a nag rather than a reminder.
    //
    // The threshold moved with the trial length, and had to. Left at 10 against
    // a seven-day trial the bar could never appear at all — the trial is over
    // before the tenth day arrives — and nothing would have failed to say so.
    expect(trialStatus(installed, at('2026-08-04T09:00:00Z')).showCountdown).toBe(false)
    expect(trialStatus(installed, at('2026-08-05T09:00:00Z')).showCountdown).toBe(true)
  })

  it('stops showing the countdown once it has run out', () => {
    expect(trialStatus(installed, at('2026-08-09T09:00:00Z')).showCountdown).toBe(false)
  })

  it('does not cost anybody Pro when the anchor is missing', () => {
    // A config that has not recorded a first run yet is a new install, not an
    // expired one. Getting this backwards downgrades somebody on day one.
    expect(trialStatus(null).active).toBe(false)
    expect(trialStatus(null).daysLeft).toBe(TRIAL_DAYS)
  })

  it('lets a licence win over the trial, even a Free one', () => {
    // Somebody who signed in and chose Free has decided. Re-granting Pro
    // because the install is nine days old would be the app arguing with them.
    const free: Licence = { ...SUBSCRIPTION, tier: 'free', expiresAt: null }

    expect(effectiveTier(free, installed, at('2026-08-02T09:00:00Z'))).toBe('free')
  })
})

describe("the account server's trial", () => {
  /*
    The other trial, and the one a paying customer actually meets.

    The block above covers the local one, anchored to installation and running
    before anybody signs up. This is the seven days granted on sign-up, which
    arrives inside a licence — and which the app could not see at all until the
    token started carrying `trial`. The symptom was a customer shown "Pro" for
    a week and dropped to Free on day eight with no countdown ever displayed.
  */
  const trialLicence: Licence = {
    ...SUBSCRIPTION,
    trial: true,
    expiresAt: '2026-08-08T00:00:00Z'
  }

  it('is active while it runs, and counts down', () => {
    expect(licenceTrial(trialLicence, at('2026-08-02T09:00:00Z')).active).toBe(true)
    expect(licenceTrial(trialLicence, at('2026-08-02T09:00:00Z')).daysLeft).toBe(6)
  })

  it('shows the countdown for the last three days, matching the local trial', () => {
    expect(licenceTrial(trialLicence, at('2026-08-04T09:00:00Z')).showCountdown).toBe(false)
    expect(licenceTrial(trialLicence, at('2026-08-05T09:00:00Z')).showCountdown).toBe(true)
  })

  it('is over once the date passes', () => {
    const done = licenceTrial(trialLicence, at('2026-08-09T09:00:00Z'))
    expect(done.active).toBe(false)
    expect(done.showCountdown).toBe(false)
  })

  it('is not a trial once somebody has paid', () => {
    /*
      Buying mid-trial, which is the case this whole thing exists for.

      `onCheckoutCompleted` on the server sets the status to active and clears
      `trialEndsOn` in the same write that grants the tier, so the very next
      licence issued is an ordinary paid one. Nothing here has to detect the
      purchase or unwind anything: the countdown stops because the licence
      being counted is gone.
    */
    const paid: Licence = { ...trialLicence, trial: false }

    expect(licenceTrial(paid, at('2026-08-02T09:00:00Z')).active).toBe(false)
    expect(licenceTrial(paid, at('2026-08-02T09:00:00Z')).showCountdown).toBe(false)
    expect(effectiveTier(paid, null, at('2026-08-02T09:00:00Z'))).toBe('pro')
  })

  it('reads as not-a-trial from a server that predates the claim', () => {
    // The claim is optional on the wire, so an older token must not read as a
    // trial and start counting down somebody's paid subscription.
    const older: LicenceClaims = {
      v: 1,
      account_id: 'acc_1',
      licence_id: 'lic_1',
      licence_type: 'subscription',
      tier: 'pro',
      billing_period: 'annual',
      expires_at: '2027-01-01T00:00:00Z',
      device_limit: 2,
      device_fingerprint: 'sha256:abc',
      referral_code: null,
      founding_number: null,
      issued_at: '2026-08-28T10:14:00Z',
      grandfathered_price_id: null,
      updates: true
    }

    expect(toLicence(older)?.trial).toBe(false)
  })
})

describe('the perpetual fallback', () => {
  it('keeps a cancelled subscriber at their tier for good', () => {
    // §3.5's promise, which only holds because the server issues a final token
    // with no expiry. Features never lapse; `updates` is what turns off.
    const lapsed: Licence = { ...SUBSCRIPTION, expiresAt: null, updates: false }

    expect(tierFor(lapsed, at('2040-01-01T00:00:00Z'))).toBe('pro')
    expect(lapsed.updates).toBe(false)
  })
})
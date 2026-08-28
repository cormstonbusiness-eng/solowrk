import { TIERS, type Tier } from './entitlements'

/**
 * The licence, as it travels and as the app holds it.
 *
 * No crypto in here on purpose — verifying needs `node:crypto`, which the
 * renderer cannot bundle, and the renderer still has to reason about what a
 * licence *says*. So this file holds the shape and the arithmetic, and
 * `main/services/licenceToken.ts` holds the signature.
 *
 * The wire format is snake_case because it is a contract with the licence
 * server and §3.2 writes it that way. Everything inside the app is camelCase,
 * so `toLicence` converts once, at the boundary — the same shape as every
 * `toLead`/`toClient` row mapper in the services.
 */

/* ------------------------------------------------------------------ *
 * The wire
 * ------------------------------------------------------------------ */

/** Tier names as the server spells them. */
export const WIRE_TIERS: Record<string, Tier> = {
  free: 'free',
  basic_plus: 'basicPlus',
  pro: 'pro'
}

/** The reverse, for anything the app sends back. */
export const TIER_WIRE: Record<Tier, string> = {
  free: 'free',
  basicPlus: 'basic_plus',
  pro: 'pro'
}

export type LicenceType = 'subscription' | 'lifetime'
export type BillingPeriod = 'monthly' | 'annual'

/** Exactly §3.2, plus `updates`. Every field as the server writes it. */
export interface LicenceClaims {
  v: number
  account_id: string
  licence_id: string
  licence_type: LicenceType
  tier: string
  billing_period: BillingPeriod | null
  /** ISO instant, or null for a licence that never expires. */
  expires_at: string | null
  device_limit: number
  device_fingerprint: string
  referral_code: string | null
  founding_number: number | null
  issued_at: string
  grandfathered_price_id: string | null
  /**
   * Whether this licence still receives updates.
   *
   * Not in §3.2, and it has to be: §3.5 promises a lapsed subscriber keeps
   * working forever at the tier they paid for, but the token they hold carries
   * an `expires_at`, so that promise would quietly expire on its own. On
   * cancellation the server issues a final token with `expires_at: null` and
   * this set to false. Features never lapse; only the update feed refuses.
   */
  updates: boolean
}

/** The only version this app understands. A token from the future is refused. */
export const LICENCE_VERSION = 1

/* ------------------------------------------------------------------ *
 * Inside the app
 * ------------------------------------------------------------------ */

export interface Licence {
  accountId: string
  licenceId: string
  type: LicenceType
  tier: Tier
  billingPeriod: BillingPeriod | null
  /** ISO instant, or null for lifetime. */
  expiresAt: string | null
  deviceLimit: number
  deviceFingerprint: string
  referralCode: string | null
  /** 1–200 for a founding licence, null otherwise. Surfaced in About (§3.2). */
  foundingNumber: number | null
  issuedAt: string
  grandfatheredPriceId: string | null
  updates: boolean
}

/**
 * Claims to a licence, refusing anything it does not recognise.
 *
 * Returns null rather than throwing, and null means Free — every caller is
 * asking "what is this person entitled to", and the answer for an unreadable
 * token is the same as for no token at all. Throwing would make a corrupt file
 * an error dialogue on a screen the user cannot get past.
 */
export function toLicence(claims: LicenceClaims): Licence | null {
  if (claims.v !== LICENCE_VERSION) return null

  const tier = WIRE_TIERS[claims.tier]
  if (!tier || !TIERS.includes(tier)) return null

  if (claims.licence_type !== 'subscription' && claims.licence_type !== 'lifetime') return null

  // A lifetime licence with an expiry is a contradiction, and the dangerous
  // one: it would work for years and then quietly stop on somebody in 2034.
  if (claims.licence_type === 'lifetime' && claims.expires_at !== null) return null

  return {
    accountId: claims.account_id,
    licenceId: claims.licence_id,
    type: claims.licence_type,
    tier,
    billingPeriod: claims.billing_period,
    expiresAt: claims.expires_at,
    deviceLimit: claims.device_limit,
    deviceFingerprint: claims.device_fingerprint,
    referralCode: claims.referral_code,
    foundingNumber: claims.founding_number,
    issuedAt: claims.issued_at,
    grandfatheredPriceId: claims.grandfathered_price_id,
    updates: claims.updates
  }
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/** 14 days past expiry before a licence stops counting (§3.4). */
export const GRACE_DAYS = 14

/** The banner starts on day 3 of the grace window, not on day one (§3.4). */
export const GRACE_BANNER_AFTER_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A lifetime licence never expires, and that is checked first and separately.
 *
 * Treating it as "a subscription with a distant expiry" is precisely the bug
 * §3.1 warns about, so there is no arithmetic on this path at all.
 */
export function hasExpired(licence: Licence, now: Date = new Date()): boolean {
  if (licence.type === 'lifetime' || licence.expiresAt === null) return false
  return new Date(licence.expiresAt).getTime() < now.getTime()
}

/** Days since expiry. Zero while it is still good. */
export function daysPastExpiry(licence: Licence, now: Date = new Date()): number {
  if (!hasExpired(licence, now)) return 0
  const past = now.getTime() - new Date(licence.expiresAt!).getTime()
  return Math.floor(past / DAY_MS)
}

/**
 * Whether the licence still entitles anything.
 *
 * Expired but inside the grace window still counts — §3.4 is explicit that a
 * flat cannot-verify wall is never shown, and somebody on a plane for a
 * fortnight has not stopped paying.
 */
export function withinGrace(licence: Licence, now: Date = new Date()): boolean {
  return !hasExpired(licence, now) || daysPastExpiry(licence, now) < GRACE_DAYS
}

/**
 * What a licence is worth today.
 *
 * The one function that turns a licence into a tier, so nothing else has to
 * decide what an expired one means. Past grace it is Free — never a lock, and
 * never read-only; §3.4 removed that state entirely.
 */
export function tierFor(licence: Licence | null, now: Date = new Date()): Tier {
  if (!licence) return 'free'
  return withinGrace(licence, now) ? licence.tier : 'free'
}

/* ------------------------------------------------------------------ *
 * The trial
 * ------------------------------------------------------------------ */

/** 14 days of Pro on install, no card and no account (§1.4). */
export const TRIAL_DAYS = 14

/** The countdown bar appears from day 10, never before (§5.4). */
export const TRIAL_COUNTDOWN_FROM_DAY = 10

export interface Trial {
  active: boolean
  /** Whole days remaining. Zero on the day it ends, negative once it has. */
  daysLeft: number
  /** Whether §5.4's slim countdown bar should be showing. */
  showCountdown: boolean
}

/**
 * How the trial stands.
 *
 * Anchored to installation rather than to an account, because §1.4 is right
 * that requiring a sign-up before the trial is the biggest drop-off point in
 * desktop onboarding. `installedAt` being null means the app has not recorded
 * a first run yet, which is treated as the trial not having started rather
 * than as having expired — a missing anchor must never cost somebody Pro.
 */
export function trialStatus(installedAt: string | null, now: Date = new Date()): Trial {
  if (!installedAt) return { active: false, daysLeft: TRIAL_DAYS, showCountdown: false }

  const elapsed = Math.floor((now.getTime() - new Date(installedAt).getTime()) / DAY_MS)
  const daysLeft = TRIAL_DAYS - elapsed

  return {
    active: daysLeft > 0,
    daysLeft,
    showCountdown: daysLeft > 0 && elapsed >= TRIAL_COUNTDOWN_FROM_DAY
  }
}

/**
 * The tier in force, licence and trial together.
 *
 * A licence always wins, even a Free one — somebody who has signed in and
 * chosen Free has made a decision, and re-granting them Pro because the
 * install is nine days old would be the app arguing with them. The trial only
 * fills the gap before any licence exists.
 */
export function effectiveTier(
  licence: Licence | null,
  installedAt: string | null,
  now: Date = new Date()
): Tier {
  if (licence) return tierFor(licence, now)
  return trialStatus(installedAt, now).active ? 'pro' : 'free'
}
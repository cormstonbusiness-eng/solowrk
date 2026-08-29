import { TIER_WIRE } from './licence'
import type { Tier } from './entitlements'

/**
 * Where SoloWrk lives on the web.
 *
 * One place, because the domain appears in the sidebar menu, in every gate
 * message, on the upgrade panel and as the account server the app talks to —
 * and it has been written four different ways in the past. Mirrors `lib/site.ts`
 * in the website repo, which is the other half of the same fact.
 *
 * If the domain ever changes, it changes here.
 */
export const SITE = 'https://solo-wrk.com'

/** What the app appends its licence paths to. */
export const API_BASE = `${SITE}/api`

/** Bare host, for gate messages that read better without the scheme. */
export const SITE_HOST = 'solo-wrk.com'

export const ACCOUNT_URL = `${SITE}/account`
export const PRICING_URL = `${SITE}/pricing`
export const SUPPORT_EMAIL = 'support@solo-wrk.com'

export type BillingPeriod = 'monthly' | 'annual'

/**
 * Straight to Stripe Checkout, with the tier and period already chosen.
 *
 * §5.1 is specific that the upgrade button must not land on the generic
 * pricing page: somebody who has just been told they need Basic+ should not
 * then have to work out which card that is. Every field pre-filled is one
 * fewer chance to abandon.
 *
 * Annual is the default everywhere (§1.2), and callers have to pass a period
 * rather than relying on one, so the choice is always deliberate.
 */
export function checkoutUrl(
  tier: Tier,
  period: BillingPeriod,
  options: { referral?: string } = {}
): string {
  const query = new URLSearchParams({ tier: TIER_WIRE[tier], period })
  if (options.referral) query.set('ref', options.referral)

  return `${SITE}/api/checkout?${query.toString()}`
}

/** The one-off founding licence, which has no period to choose. */
export function foundingCheckoutUrl(options: { referral?: string } = {}): string {
  const query = new URLSearchParams({ tier: 'founding', period: 'once' })
  if (options.referral) query.set('ref', options.referral)

  return `${SITE}/api/checkout?${query.toString()}`
}

/**
 * The update manifest, which is ours rather than GitHub's.
 *
 * §3.5 needs the server to decide who still receives updates, and static
 * hosting cannot read a licence. The route checks the token and either serves
 * the manifest or answers 204; the installer bytes it points at still live on
 * GitHub, so installer bandwidth stays off Vercel.
 */
export const UPDATE_FEED = `${SITE}/api/updates/`

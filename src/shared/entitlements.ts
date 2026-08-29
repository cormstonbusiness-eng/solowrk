/**
 * What a tier includes, and what it does not.
 *
 * The single source of truth for pricing, per §4.1 of the Pricing spec. **No
 * tier comparison belongs anywhere else in the app.** Gating logic spread
 * across modules is the largest ongoing maintenance cost in tiered software
 * and the likeliest source of a bug that either gives a paid feature away or
 * locks out somebody who paid — so adding a gated capability means one entry
 * in `FEATURES` and one line in `ADDS`, not an edit in thirteen places.
 *
 * Pure data and pure functions. It is imported by the main process, which
 * counts against the limits, and by the renderer, which explains them — and it
 * touches neither the database nor the filesystem so that both can.
 *
 * Two rules that the rest of the app depends on:
 *
 * **Tiers are cumulative.** Pro is Basic+ plus its own list. `ADDS` holds only
 * what each tier introduces, so a feature cannot be granted to Pro and
 * forgotten for the tier above it — there isn't one — nor left off Pro by
 * being written only against Basic+.
 *
 * **A limit is never a lock.** Exceeding one blocks the *next* thing created,
 * never access to what already exists. §4.3 is not a nicety: holding somebody's
 * own business data hostage is the exact behaviour this product sells against.
 */

export const TIERS = ['free', 'basicPlus', 'pro'] as const
export type Tier = (typeof TIERS)[number]

/**
 * The only place a tier's display text lives.
 *
 * "Basic+" was "Basic" and may be something else again. Every message the user
 * reads is built from this, so a rename is this line and nothing else — which
 * is the difference between a pricing change and a week of grep.
 */
export const TIER_NAMES: Record<Tier, string> = {
  free: 'Free',
  basicPlus: 'Basic+',
  pro: 'Pro'
}

/**
 * What each tier costs, for the upgrade surfaces. Pence, like all money here.
 *
 * Display only — the authority is the Stripe price id, and these exist so the
 * limit modal can name a figure without a network call. Annual is preselected
 * everywhere (§1.2), so it is listed first.
 */
export const TIER_PRICES: Record<Tier, { annual: number; monthly: number } | null> = {
  free: null,
  basicPlus: { annual: 8900, monthly: 999 },
  pro: { annual: 16_900, monthly: 1999 }
}

/** £99 one-off, Pro permanently, first 200 only. A launch instrument (§1.3). */
export const FOUNDING_PRICE = 9900

/* ------------------------------------------------------------------ *
 * Features
 * ------------------------------------------------------------------ */

/**
 * Slugs are lower case with no spaces, commas or capitals, and that is a hard
 * requirement rather than a house style: the licence server issues these names
 * and they are compared literally. A stray capital would display perfectly and
 * fail every check in silence.
 *
 * `marketing`, `chasing`, `yearend` and `bank` are already issued by the live
 * server and must keep their spelling.
 */
export const FEATURES = [
  // Basic+ — automation.
  'branding',
  'recurring',
  'chasing',
  'paymentlinks',
  'rates',
  'calendardrag',
  'taskrail',
  'autobackup',
  'marketing',

  // Pro — the things that make a freelancer look like a bigger operation.
  'updatepack',
  'marketingresults',
  'businessplan',
  'proposals',
  'expenses',
  'profitability',
  'tax',
  'cashflow',
  'automations',
  'invoicedesigner',
  'multicurrency',
  'vault',
  'calendarlenses',
  'bank',
  'yearend',
  'aireview'
] as const

export type Feature = (typeof FEATURES)[number]

/**
 * How to name a feature in a sentence.
 *
 * Read as the object of "Pro includes ___", which is why they are lower case
 * and why the phrasing avoids a verb. The obvious template — "X is part of
 * Pro" — forces subject-verb agreement on a string, and half of these are
 * plural: "Recurring invoices is part of Pro" is the sort of sentence that
 * makes somebody trust the software slightly less for no reason they could
 * name. Making the feature the object sidesteps it entirely.
 */
export const FEATURE_LABELS: Record<Feature, string> = {
  branding: 'your own logo and colours on documents',
  recurring: 'recurring invoices',
  chasing: 'the automatic chaser schedule',
  paymentlinks: 'payment links on invoices',
  rates: 'per-client and per-project rates',
  calendardrag: 'dragging and resizing in the calendar',
  taskrail: 'scheduling from the task rail',
  autobackup: 'automatic versioned backups',
  marketing: 'the Marketing module',

  updatepack: 'client update packs',
  marketingresults: 'marketing attribution and spend tracking',
  businessplan: 'the business plan assistant',
  proposals: 'proposals and contracts',
  expenses: 'expenses and receipt capture',
  profitability: 'profitability per client and project',
  tax: 'tax set-aside',
  cashflow: 'cashflow forecasting',
  automations: 'automation rules',
  invoicedesigner: 'the invoice template designer',
  multicurrency: 'multi-currency',
  vault: 'the encrypted vault',
  calendarlenses: 'calendar lenses and scenario mode',
  bank: 'bank import',
  yearend: 'the year-end pack',
  aireview: 'the weekly business review'
}

/**
 * What each tier *introduces*. Read `TIER_FEATURES` for what it has.
 *
 * Free introduces nothing, which is the point of §2.1: Free gates volume, not
 * capability. It must be genuinely usable indefinitely, because it is both the
 * top of the funnel and the demo.
 *
 * Exported because "what you just unlocked" is exactly this list and nothing
 * else — the panel that appears after an upgrade (§9.4 of Document 1) would
 * otherwise maintain a second copy of it, which would drift.
 */
export const TIER_ADDS: Record<Tier, readonly Feature[]> = {
  free: [],
  basicPlus: [
    'branding',
    'recurring',
    'chasing',
    'paymentlinks',
    'rates',
    'calendardrag',
    'taskrail',
    'autobackup',
    /**
     * Marketing moved down from Pro, and deliberately.
     *
     * Content planning is the module a freelancer touches most often, and
     * habitual use is what makes a subscription feel worth renewing. Locking
     * the whole thing away gave Basic+ no daily reason to open the app. What
     * stays behind is the *measurement* layer — see `marketingresults` — which
     * is a cleaner boundary than an all-or-nothing module.
     */
    'marketing'
  ],
  pro: [
    'updatepack',
    'marketingresults',
    'businessplan',
    'proposals',
    'expenses',
    'profitability',
    'tax',
    'cashflow',
    'automations',
    'invoicedesigner',
    'multicurrency',
    'vault',
    'calendarlenses',
    'bank',
    'yearend',
    'aireview'
  ]
}

/** Everything a tier has, its own and everything below it. */
export const TIER_FEATURES: Record<Tier, ReadonlySet<Feature>> = (() => {
  const built = {} as Record<Tier, ReadonlySet<Feature>>
  const running: Feature[] = []

  for (const tier of TIERS) {
    running.push(...TIER_ADDS[tier])
    built[tier] = new Set(running)
  }

  return built
})()

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

export const LIMITS = [
  'clients',
  'projects',
  'invoicesPerMonth',
  'goals',
  'activeTimers',
  'assistantMessages',
  'channels',
  'campaigns',
  'devices'
] as const

export type Limit = (typeof LIMITS)[number]

/**
 * No cap.
 *
 * `Infinity` rather than `null` so every comparison in the app is arithmetic —
 * `used >= limitOf(tier, limit)` is false forever without a special case, and a
 * special case is what eventually blocks a paying customer at 2,147,483,647.
 * It does not survive `JSON.stringify`, so anything crossing IPC sends the
 * *used* count and asks this module for the cap on the other side.
 */
export const UNLIMITED = Number.POSITIVE_INFINITY

/** How to name a limit in a meter or a modal. Sentence case, no count. */
export const LIMIT_LABELS: Record<Limit, string> = {
  clients: 'Clients',
  projects: 'Projects',
  invoicesPerMonth: 'Invoices this month',
  goals: 'Goals',
  activeTimers: 'Running timers',
  assistantMessages: 'Assistant messages this month',
  channels: 'Marketing channels',
  campaigns: 'Campaigns on the go',
  devices: 'Computers'
}

/** The limits that reset with the calendar month, for the meters to say so. */
export const MONTHLY_LIMITS: readonly Limit[] = ['invoicesPerMonth', 'assistantMessages']

/**
 * Free's numbers come straight from §2.1.
 *
 * Tasks, notes and folder structures are deliberately absent — they are
 * unlimited on every tier and a limit that is never reached is a limit nobody
 * should have to read about.
 */
export const TIER_LIMITS: Record<Tier, Record<Limit, number>> = {
  free: {
    clients: 3,
    projects: 3,
    invoicesPerMonth: 3,
    goals: 1,
    activeTimers: 1,
    assistantMessages: 20,
    /**
     * Zero, because Free has no Marketing module at all.
     *
     * A cap of zero is this map's way of saying "not on this tier", which is
     * different from a cap somebody can reach. The meters skip it for exactly
     * that reason: the feature lock already explains it, and a meter reading
     * "0 of 0" would explain it again, worse.
     */
    channels: 0,
    campaigns: 0,
    devices: 1
  },
  basicPlus: {
    clients: UNLIMITED,
    projects: UNLIMITED,
    invoicesPerMonth: UNLIMITED,
    goals: UNLIMITED,
    activeTimers: UNLIMITED,
    assistantMessages: UNLIMITED,
    // §12. Three is enough to commit to properly and few enough that a
    // freelancer running six channels badly is the one being sold Pro.
    channels: 3,
    /**
     * §12's "3 active". Counted as campaigns still in play — one that is
     * complete or abandoned has stopped costing anything and should not hold
     * a slot against you forever.
     */
    campaigns: 3,
    devices: 2
  },
  pro: {
    clients: UNLIMITED,
    projects: UNLIMITED,
    invoicesPerMonth: UNLIMITED,
    goals: UNLIMITED,
    activeTimers: UNLIMITED,
    assistantMessages: UNLIMITED,
    channels: UNLIMITED,
    campaigns: UNLIMITED,
    devices: 2
  }
}

/* ------------------------------------------------------------------ *
 * Asking
 * ------------------------------------------------------------------ */

export function can(tier: Tier, feature: Feature): boolean {
  return TIER_FEATURES[tier].has(feature)
}

export function limitOf(tier: Tier, limit: Limit): number {
  return TIER_LIMITS[tier][limit]
}

export function isUnlimited(value: number): boolean {
  return !Number.isFinite(value)
}

/**
 * The cheapest tier that unlocks something.
 *
 * What the upgrade prompt names, so a Free user hitting a Basic+ feature is
 * offered Basic+ rather than being sold Pro for something Pro is not needed
 * for. Relies on `TIERS` being in ascending order, which it is and must stay.
 */
export function requires(feature: Feature): Tier {
  return TIERS.find((tier) => can(tier, feature)) ?? 'pro'
}

/** The cheapest tier that lifts a limit — the same question, for volume. */
export function requiresFor(limit: Limit, wanted: number): Tier {
  return TIERS.find((tier) => limitOf(tier, limit) >= wanted) ?? 'pro'
}

/** Ascending, so `rank(a) < rank(b)` means a is the lesser tier. */
export function rank(tier: Tier): number {
  return TIERS.indexOf(tier)
}

/**
 * Whether `held` is at least `needed`.
 *
 * The one comparison the app is allowed to make between two tiers, and it is
 * here rather than inline so that `'pro' > 'free'` — which is a string
 * comparison and happens to be false — cannot be written anywhere.
 */
export function atLeast(held: Tier, needed: Tier): boolean {
  return rank(held) >= rank(needed)
}
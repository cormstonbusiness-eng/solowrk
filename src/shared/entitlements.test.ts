import { describe, expect, it } from 'vitest'
import {
  FEATURES,
  FEATURE_LABELS,
  LIMITS,
  LIMIT_LABELS,
  TIERS,
  TIER_ADDS,
  TIER_FEATURES,
  TIER_LIMITS,
  TIER_NAMES,
  UNLIMITED,
  atLeast,
  can,
  isUnlimited,
  limitOf,
  rank,
  requires,
  requiresFor
} from './entitlements'

/**
 * The entitlement map.
 *
 * Everything here is the kind of mistake that ships quietly: a feature granted
 * to Pro but forgotten for the tier that already paid for it, a slug the
 * licence server does not issue, a limit with no name to show the user. None of
 * it throws, and all of it is either a paid feature given away or a customer
 * locked out of something they bought.
 */

describe('tiers are cumulative', () => {
  it('gives every higher tier everything the one below it has', () => {
    // The failure this prevents: writing a feature against Basic+ and Pro
    // silently not having it, or vice versa.
    for (let i = 1; i < TIERS.length; i += 1) {
      const lower = TIERS[i - 1]!
      const higher = TIERS[i]!

      for (const feature of TIER_FEATURES[lower]) {
        expect(can(higher, feature)).toBe(true)
      }
    }
  })

  it('gives Pro everything there is', () => {
    expect(TIER_FEATURES.pro.size).toBe(FEATURES.length)
  })

  it('gives Free no features at all', () => {
    // §2.1: Free gates volume, not capability. A feature appearing here means
    // the boundary has been drawn in the wrong place.
    expect(TIER_FEATURES.free.size).toBe(0)
  })
})

describe('the map is complete', () => {
  it('introduces every feature exactly once', () => {
    const introduced = TIERS.flatMap((tier) => [...TIER_ADDS[tier]])

    expect([...introduced].sort()).toEqual([...FEATURES].sort())
    expect(new Set(introduced).size).toBe(introduced.length)
  })

  it('names every feature and every limit', () => {
    // A missing label renders as `undefined` in a modal somebody is being
    // asked to pay money in response to.
    for (const feature of FEATURES) expect(FEATURE_LABELS[feature]?.length).toBeGreaterThan(0)
    for (const limit of LIMITS) expect(LIMIT_LABELS[limit]?.length).toBeGreaterThan(0)
    for (const tier of TIERS) expect(TIER_NAMES[tier]?.length).toBeGreaterThan(0)
  })

  it('gives every tier a number for every limit', () => {
    for (const tier of TIERS) {
      for (const limit of LIMITS) {
        expect(typeof TIER_LIMITS[tier][limit]).toBe('number')
      }
    }
  })
})

describe('the slugs', () => {
  it('are shaped the way the licence server compares them', () => {
    // Matched literally against the list the server issues. A capital or a
    // stray space would display perfectly and fail every check in silence.
    for (const feature of FEATURES) {
      expect(feature).toBe(feature.trim().toLowerCase())
      expect(feature).not.toContain(',')
      expect(feature).not.toContain(' ')
    }
  })

  it('keeps the four the live server already issues', () => {
    // Renaming one of these silently locks out every existing customer until
    // the server is redeployed to match.
    for (const slug of ['marketing', 'chasing', 'yearend', 'bank'] as const) {
      expect(FEATURES).toContain(slug)
    }
  })
})

describe('what unlocks what', () => {
  it('names the cheapest tier, not the dearest', () => {
    // Somebody hitting a Basic+ feature must be offered Basic+. Selling Pro for
    // something Pro is not needed for is how a pricing page loses trust.
    expect(requires('recurring')).toBe('basicPlus')
    expect(requires('chasing')).toBe('basicPlus')
    expect(requires('marketing')).toBe('pro')
    expect(requires('tax')).toBe('pro')
  })

  it('names the cheapest tier that lifts a limit', () => {
    expect(requiresFor('clients', 4)).toBe('basicPlus')
    expect(requiresFor('goals', 2)).toBe('basicPlus')
    // Free already allows one, so nothing needs upgrading for it.
    expect(requiresFor('activeTimers', 1)).toBe('free')
  })

  it('does not lie about a second computer', () => {
    // Devices is the one limit Pro does not lift beyond Basic+.
    expect(requiresFor('devices', 2)).toBe('basicPlus')
    expect(requiresFor('devices', 3)).toBe('pro')
  })
})

describe("Free's numbers", () => {
  it('match the specification', () => {
    // §2.1, quoted. If a product decision moves one of these, it moves here.
    expect(TIER_LIMITS.free).toMatchObject({
      clients: 3,
      projects: 3,
      invoicesPerMonth: 3,
      goals: 1,
      activeTimers: 1,
      assistantMessages: 20,
      devices: 1
    })
  })

  it('lets a paid tier past every count', () => {
    for (const limit of LIMITS) {
      if (limit === 'devices') continue
      expect(isUnlimited(limitOf('basicPlus', limit))).toBe(true)
      expect(isUnlimited(limitOf('pro', limit))).toBe(true)
    }
  })
})

describe('unlimited', () => {
  it('never blocks a creation, however many there are', () => {
    // Why Infinity rather than null: this stays arithmetic with no special
    // case, and a special case is what eventually refuses a paying customer.
    expect(2_147_483_647 >= limitOf('pro', 'clients')).toBe(false)
  })

  it('is recognisable', () => {
    expect(isUnlimited(UNLIMITED)).toBe(true)
    expect(isUnlimited(3)).toBe(false)
  })
})

describe('comparing tiers', () => {
  it('orders them cheapest first', () => {
    expect(rank('free')).toBeLessThan(rank('basicPlus'))
    expect(rank('basicPlus')).toBeLessThan(rank('pro'))
  })

  it('answers the question string comparison gets wrong', () => {
    // 'pro' > 'free' is false as strings, which is why this function exists.
    expect(atLeast('pro', 'free')).toBe(true)
    expect(atLeast('free', 'pro')).toBe(false)
    expect(atLeast('basicPlus', 'basicPlus')).toBe(true)
  })
})
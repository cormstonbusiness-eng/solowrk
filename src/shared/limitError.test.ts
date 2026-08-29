import { describe, expect, it } from 'vitest'
import {
  FeatureLockedError,
  LimitReachedError,
  limitFactsFrom,
  limitSentence,
  lockedFactsFrom,
  refusalFrom
} from './limitError'
import type { LimitFacts } from './limitError'

/**
 * The envelope.
 *
 * All of this exists because Electron throws away everything about an error
 * except its message. The test that matters is the round trip through a string
 * that has been mangled the way Electron mangles it.
 */

const FACTS: LimitFacts = {
  limit: 'clients',
  used: 3,
  cap: 3,
  tier: 'free',
  needs: 'basicPlus'
}

describe('crossing the process boundary', () => {
  it('survives the wrapping Electron puts round it', () => {
    // Verbatim shape of what the renderer actually receives.
    const thrown = new LimitReachedError(FACTS)
    const asElectronDeliversIt = new Error(
      `Error invoking remote method 'clients:create': Error: ${thrown.message}`
    )

    expect(limitFactsFrom(asElectronDeliversIt)).toEqual(FACTS)
  })

  it('reads the facts off the error itself in the main process', () => {
    // Main throws it and main can catch it — no parsing needed on that side.
    expect(new LimitReachedError(FACTS).facts).toEqual(FACTS)
  })

  it('takes a bare string, because a catch gives you anything', () => {
    expect(limitFactsFrom(new LimitReachedError(FACTS).message)).toEqual(FACTS)
  })
})

describe('telling it apart from everything else', () => {
  it('returns null for an ordinary failure', () => {
    // The question call sites ask is "was this a limit?", and the answer for
    // a disk error must be no rather than a throw.
    expect(limitFactsFrom(new Error('No workspace is open'))).toBeNull()
    expect(limitFactsFrom(undefined)).toBeNull()
    expect(limitFactsFrom(null)).toBeNull()
    expect(limitFactsFrom({ nowhere: 'near an error' })).toBeNull()
  })

  it('refuses a half-written envelope rather than rendering undefined', () => {
    // "undefined of undefined" in a modal asking for money is worse than no
    // modal at all.
    expect(limitFactsFrom(new Error('@@solowrk/limit@@{"limit":"clients"}'))).toBeNull()
    expect(limitFactsFrom(new Error('@@solowrk/limit@@not json'))).toBeNull()
  })
})

describe('what it says', () => {
  it('counts a standing total', () => {
    expect(limitSentence(FACTS)).toBe('You have reached 3 clients on Free.')
  })

  it('says so when the limit resets with the month', () => {
    // Otherwise "you have reached 3 invoices this month" reads as a permanent
    // ceiling, and somebody upgrades who only needed to wait a week.
    expect(
      limitSentence({ ...FACTS, limit: 'invoicesPerMonth', used: 3, cap: 3 })
    ).toBe('You have used all 3 of your invoices for this month on Free.')
  })
})

describe('the other kind of refusal', () => {
  const LOCKED = {
    feature: 'marketing',
    tier: 'free',
    needs: 'pro',
    message:
      'SoloWrk Pro includes the Marketing module. Upgrade at solo-wrk.com/account. Your clients, projects and invoices are unaffected.'
  } as const

  it('survives the wrapping Electron puts round it', () => {
    const thrown = new FeatureLockedError({ ...LOCKED })
    const delivered = new Error(
      `Error invoking remote method 'marketing:posts': Error: ${thrown.message}`
    )

    expect(lockedFactsFrom(delivered)).toEqual(LOCKED)
  })

  it('reads as a sentence before it reads as an envelope', () => {
    // Anywhere this does leak into a raw error string, the first thing on
    // screen should be English rather than JSON.
    expect(new FeatureLockedError({ ...LOCKED }).message).toMatch(/^SoloWrk Pro includes/)
  })

  it('is told apart from a limit', () => {
    // Both land in the same modal and it renders them differently, so mixing
    // them up would show a meter with no numbers behind it.
    expect(refusalFrom(new FeatureLockedError({ ...LOCKED }))?.kind).toBe('locked')
    expect(
      refusalFrom(
        new LimitReachedError({ limit: 'clients', used: 3, cap: 3, tier: 'free', needs: 'basicPlus' })
      )?.kind
    ).toBe('limit')
  })

  it('leaves an ordinary failure alone', () => {
    expect(refusalFrom(new Error('EBUSY: resource busy or locked'))).toBeNull()
    expect(lockedFactsFrom(null)).toBeNull()
  })

  it('refuses a half-written envelope', () => {
    expect(lockedFactsFrom(new Error('@@solowrk/locked@@{"feature":"marketing"}'))).toBeNull()
  })
})

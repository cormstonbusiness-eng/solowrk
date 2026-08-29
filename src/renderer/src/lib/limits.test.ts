import { beforeEach, describe, expect, it } from 'vitest'
import { FeatureLockedError, LimitReachedError } from '@shared/limitError'
import { dismissLimit, raiseLimit, resetLimits } from './limits'

/**
 * The store behind the limit modal.
 *
 * Small, but it sits on the global mutation error path — so the case that
 * matters most is the one where it must do *nothing*. A disk error reported as
 * a reason to upgrade would be worse than no modal at all.
 */

const FACTS = { limit: 'clients', used: 3, cap: 3, tier: 'free', needs: 'basicPlus' } as const

beforeEach(() => {
  resetLimits()
})

describe('what it takes', () => {
  it('recognises a limit that crossed the process boundary', () => {
    const thrown = new LimitReachedError({ ...FACTS })
    const delivered = new Error(
      `Error invoking remote method 'clients:create': Error: ${thrown.message}`
    )

    expect(raiseLimit(delivered)).toBe(true)
  })

  it('leaves every other failure alone', () => {
    // The important one. This runs on every failed mutation in the app.
    for (const other of [
      new Error('No workspace is open'),
      new Error('EBUSY: resource busy or locked'),
      'a string',
      undefined,
      null
    ]) {
      expect(raiseLimit(other)).toBe(false)
    }
  })
})

describe('two at once', () => {
  it('shows one wall rather than two modals', () => {
    // Two mutations failing together is one thing to explain, not a fight
    // over the same corner of the screen.
    expect(raiseLimit(new LimitReachedError({ ...FACTS }))).toBe(true)
    expect(raiseLimit(new LimitReachedError({ ...FACTS, limit: 'projects' }))).toBe(true)

    dismissLimit()
    // And dismissing clears the one that was showing, not a queue of them.
    expect(raiseLimit(new LimitReachedError({ ...FACTS }))).toBe(true)
  })
})

describe('a feature this tier does not include', () => {
  /**
   * The regression this exists for.
   *
   * Only limits were structured to begin with, so a gate refusal fell through
   * to whatever the call site did with it. The logo button had no error
   * handling at all and failed in complete silence -- which is exactly the
   * disabled-control-with-no-explanation that section 5.1 calls the worst
   * possible outcome.
   */
  it('raises the modal, the same as a limit does', () => {
    const locked = new FeatureLockedError({
      feature: 'branding',
      tier: 'free',
      needs: 'basicPlus',
      message: 'SoloWrk Basic+ includes your own logo and colours on documents. Upgrade at x. Y.'
    })

    expect(raiseLimit(locked)).toBe(true)
  })

  it('still ignores a genuine failure', () => {
    expect(raiseLimit(new Error('EBUSY: resource busy or locked'))).toBe(false)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { LimitReachedError } from '@shared/limitError'
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

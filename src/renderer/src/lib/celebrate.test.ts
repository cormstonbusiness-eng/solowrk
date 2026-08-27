import { beforeEach, describe, expect, it } from 'vitest'
import {
  celebratePayment,
  celebrateUnlock,
  currentToasts,
  dismissToast,
  resetCelebrations,
  takePayment,
  takeUnlocked
} from './celebrate'

/**
 * Celebrations.
 *
 * The rule the whole thing rests on: a celebration is *taken*, not broadcast.
 * One fired to an empty room spends the moment and the user never sees it; one
 * shown twice reads as a glitch.
 */

beforeEach(() => {
  resetCelebrations()
})

describe('an invoice being paid', () => {
  it('says so immediately and holds the figure for the dashboard', () => {
    celebratePayment(150_000, 'Northgate')

    const paid = takePayment()
    expect(paid).toEqual({ amount: 150_000, client: 'Northgate' })
  })

  it('is taken once', () => {
    celebratePayment(150_000, 'Northgate')

    expect(takePayment()).not.toBeNull()
    // Shown twice is a glitch.
    expect(takePayment()).toBeNull()
  })

  it('survives an invoice with no client on it', () => {
    celebratePayment(150_000, null)
    expect(takePayment()!.client).toBe('a client')
  })
})

describe('a licence unlocking', () => {
  it('does nothing at all for an empty list', () => {
    // A first load is not an upgrade, and throwing confetti at somebody who
    // has been paying for a year would be worse than silence.
    celebrateUnlock([])
    expect(takeUnlocked()).toEqual([])
  })

  it('remembers what was unlocked', () => {
    celebrateUnlock(['marketing', 'bank'])
    expect(takeUnlocked()).toEqual(['marketing', 'bank'])
  })

  it('does not repeat a feature unlocked twice before it was seen', () => {
    celebrateUnlock(['marketing'])
    celebrateUnlock(['marketing', 'bank'])

    expect(takeUnlocked()).toEqual(['marketing', 'bank'])
  })

  it('is taken once', () => {
    celebrateUnlock(['marketing'])

    expect(takeUnlocked()).toEqual(['marketing'])
    expect(takeUnlocked()).toEqual([])
  })
})

describe('toasts', () => {
  it('raises one when an invoice is paid', () => {
    celebratePayment(150_000, 'Northgate')

    const toasts = currentToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.title).toBe('Paid.')
    expect(toasts[0]!.body).toContain('£1,500.00')
    expect(toasts[0]!.body).toContain('Northgate')
  })

  it('raises none for an unlock', () => {
    // The what is-new panel is the announcement, and both would land in the
    // same corner of the window at the same moment.
    celebrateUnlock(['marketing'])
    expect(currentToasts()).toHaveLength(0)
  })

  it('gives every local toast a distinct negative id', () => {
    // Real notifications come from the database with positive ones, and the
    // sign is what stops a click marking a row that does not exist as read.
    celebratePayment(1000, 'A')
    celebratePayment(2000, 'B')

    const ids = currentToasts().map((one) => one.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toBeLessThan(0)
  })

  it('dismisses one and leaves the rest', () => {
    celebratePayment(1000, 'A')
    celebratePayment(2000, 'B')

    const [first] = currentToasts()
    dismissToast(first!.id)

    expect(currentToasts()).toHaveLength(1)
    expect(currentToasts()[0]!.body).toContain('B')
  })
})

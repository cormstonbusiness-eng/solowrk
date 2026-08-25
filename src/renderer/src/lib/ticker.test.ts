import { describe, expect, it } from 'vitest'
import { tickerSlots } from './ticker'

/**
 * The running timer, split into slots.
 *
 * All of this exists to stop a clock animating characters that did not change.
 * The elapsed time re-renders every second and is on screen from every page in
 * the app, so anything that moves when it should not is something somebody has
 * to look at all day.
 */
const keys = (value: string): string[] => tickerSlots(value).map((slot) => slot.key)

describe('slots', () => {
  it('gives one slot per character', () => {
    expect(tickerSlots('01:23')).toHaveLength(5)
  })

  it('animates digits and leaves punctuation alone', () => {
    const slots = tickerSlots('01:23')
    expect(slots.map((slot) => slot.animated)).toEqual([true, true, false, true, true])
  })

  it('keeps every key distinct', () => {
    // Two slots sharing a key is React reusing one element for two positions,
    // which shows up as a digit that never changes.
    const found = keys('12:34:56')
    expect(new Set(found).size).toBe(found.length)
  })
})

describe('keying from the right', () => {
  it('leaves the seconds alone when the figure grows a digit', () => {
    // The moment this exists for. 59:59 to 1:00:00 shifts every character one
    // place along; keyed from the left the whole clock would animate, and the
    // seconds would appear to change when they had only moved.
    const before = tickerSlots('59:59')
    const after = tickerSlots('1:00:00')

    const secondsBefore = before[before.length - 1]!
    const secondsAfter = after[after.length - 1]!

    expect(secondsAfter.key).toBe(secondsBefore.key)
  })

  it('gives what arrived keys nothing held before', () => {
    // 59:59 gaining an hours field adds two characters, not one: the leading
    // digit and the colon after it. Both are genuinely new, and everything
    // behind them keeps the key it had.
    const before = new Set(keys('59:59'))
    const arrived = keys('1:00:00').filter((key) => !before.has(key))

    expect(arrived).toEqual(['7', 'fixed-6'])
  })

  it('holds the units digit still across an ordinary tick', () => {
    // 01:23 to 01:24 changes one character. Every key must match, so that only
    // the one whose *character* changed animates.
    expect(keys('01:23')).toEqual(keys('01:24'))
  })

  it('does not confuse a digit slot with a punctuation slot at the same place', () => {
    // '1:00:00' has a colon where '59:59' has a digit. If both were keyed on
    // position alone, React would try to reuse one for the other.
    const digit = tickerSlots('12345')[0]!
    const punctuation = tickerSlots(':2345')[0]!

    expect(digit.key).not.toBe(punctuation.key)
  })
})

describe('edge cases', () => {
  it('copes with an empty string', () => {
    expect(tickerSlots('')).toEqual([])
  })

  it('treats a single digit as one animated slot', () => {
    expect(tickerSlots('7')).toEqual([{ key: '1', character: '7', animated: true }])
  })
})

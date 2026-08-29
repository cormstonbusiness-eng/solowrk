import { describe, expect, it } from 'vitest'
import {
  consistency,
  fillFor,
  ghostsFor,
  periodsBetween,
  slotDays,
  type Commitment
} from './cadence'

/**
 * The commitment.
 *
 * The behaviour worth pinning is the subtraction: a gap appears only where the
 * promise is not already kept. Get that wrong in one direction and the
 * calendar fills with ghosts somebody learns to ignore within a fortnight;
 * wrong in the other and the feature never shows anything at all.
 */

const TWICE_WEEKLY = { id: 1, cadenceCount: 2, cadencePeriod: 'week' as const }
const MONTHLY = { id: 2, cadenceCount: 1, cadencePeriod: 'month' as const }

// A Monday, so the week arithmetic is easy to read.
const MON = '2026-08-31'
const SUN = '2026-09-06'

describe('where the slots sit', () => {
  it('spreads them across the week rather than stacking them', () => {
    // Two ghosts on a Monday says something different from one on Tuesday and
    // one on Thursday. The second reads as a rhythm, which is the thing being
    // encouraged.
    const days = slotDays(MON, { count: 2, period: 'week' })

    expect(days).toHaveLength(2)
    expect(new Set(days).size).toBe(2)
  })

  it('puts a single weekly slot mid-week, not on Monday', () => {
    expect(slotDays(MON, { count: 1, period: 'week' })).toEqual(['2026-09-02'])
  })

  it('keeps the weekend out of it', () => {
    // Nobody sets out to post on a Sunday, and drawing a gap there invites
    // ignoring the whole feature.
    for (const day of slotDays(MON, { count: 5, period: 'week' })) {
      expect(day <= '2026-09-04').toBe(true)
    }
  })

  it('never asks for more days than the period has', () => {
    expect(slotDays(MON, { count: 99, period: 'week' })).toHaveLength(5)
  })

  it('gives nothing for no commitment', () => {
    expect(slotDays(MON, { count: 0, period: 'week' })).toEqual([])
  })
})

describe('the gaps', () => {
  it('draws the whole commitment when nothing is written', () => {
    expect(ghostsFor(TWICE_WEEKLY, MON, SUN, [])).toHaveLength(2)
  })

  it('draws only what is missing', () => {
    // The subtraction that is the whole feature.
    expect(ghostsFor(TWICE_WEEKLY, MON, SUN, ['2026-09-01'])).toHaveLength(1)
  })

  it('draws nothing once the promise is kept', () => {
    expect(ghostsFor(TWICE_WEEKLY, MON, SUN, ['2026-09-01', '2026-09-03'])).toEqual([])
  })

  it('draws nothing when more was written than promised', () => {
    const done = ['2026-09-01', '2026-09-02', '2026-09-03']
    expect(ghostsFor(TWICE_WEEKLY, MON, SUN, done)).toEqual([])
  })

  it('never lands on a day that already has something', () => {
    // A ghost on top of real work reads as the app not knowing what is there.
    const ghosts = ghostsFor(TWICE_WEEKLY, MON, SUN, [])
    const withOne = ghostsFor(TWICE_WEEKLY, MON, SUN, [ghosts[0]!.day])

    expect(withOne.map((one) => one.day)).not.toContain(ghosts[0]!.day)
  })

  it('says nothing at all for a channel with no commitment', () => {
    expect(ghostsFor({ ...TWICE_WEEKLY, cadenceCount: 0 }, MON, SUN, [])).toEqual([])
  })

  it('counts each week separately', () => {
    // Two weeks, two a week, one written in the first: three gaps.
    const fortnight = ghostsFor(TWICE_WEEKLY, MON, '2026-09-13', ['2026-09-01'])
    expect(fortnight).toHaveLength(3)
  })

  it('stays inside the range it was asked about', () => {
    for (const ghost of ghostsFor(TWICE_WEEKLY, MON, SUN, [])) {
      expect(ghost.day >= MON && ghost.day <= SUN).toBe(true)
    }
  })

  it('handles a monthly commitment', () => {
    expect(ghostsFor(MONTHLY, '2026-09-01', '2026-09-30', [])).toHaveLength(1)
    expect(ghostsFor(MONTHLY, '2026-09-01', '2026-09-30', ['2026-09-14'])).toEqual([])
  })
})

describe('the periods', () => {
  it('includes the one the range starts inside', () => {
    // A range beginning on a Wednesday still belongs to that week.
    expect(periodsBetween('2026-09-02', '2026-09-04', 'week')).toEqual(['2026-08-31'])
  })

  it('walks forward without missing one', () => {
    expect(periodsBetween(MON, '2026-09-20', 'week')).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14'
    ])
  })
})

describe('how a period went', () => {
  const twice: Commitment = { count: 2, period: 'week' }

  it('is one of three answers, never a percentage', () => {
    // The strip exists to show a pattern — posted through March, stopped in
    // April, started again in July. A gradient would be prettier and harder
    // to read.
    expect(fillFor(0, twice)).toBe('none')
    expect(fillFor(1, twice)).toBe('partial')
    expect(fillFor(2, twice)).toBe('met')
    expect(fillFor(5, twice)).toBe('met')
  })

  it('is never anything for a channel with no commitment', () => {
    expect(fillFor(3, { count: 0, period: 'week' })).toBe('none')
  })

  it('reads a run of weeks back', () => {
    const weeks = consistency(twice, MON, '2026-09-13', [
      '2026-09-01',
      '2026-09-03',
      '2026-09-08'
    ])

    expect(weeks.map((one) => one.fill)).toEqual(['met', 'partial'])
    expect(weeks[0]?.done).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import {
  HMRC_RATES,
  TENTHS_PER_MILE,
  type MileageRate,
  type Vehicle,
  milesLabel,
  rateLabel,
  toTenths,
  valueJourney,
  valueYear
} from './mileage'

/**
 * Mileage arithmetic.
 *
 * Every number here ends up on a tax return. The 10,000-mile threshold is
 * where both possible mistakes live — claiming 45p past it, or dropping to 25p
 * before it — so it is pinned from both sides and through the middle.
 */

const RATES: Record<Vehicle, MileageRate> = {
  car: { vehicle: 'car', ...HMRC_RATES.car },
  motorcycle: { vehicle: 'motorcycle', ...HMRC_RATES.motorcycle },
  bicycle: { vehicle: 'bicycle', ...HMRC_RATES.bicycle }
}

/** Miles as the log stores them. */
const m = (miles: number): number => Math.round(miles * TENTHS_PER_MILE)

describe('one journey', () => {
  it('pays the first rate from a standing start', () => {
    // 10 miles at 45p.
    expect(valueJourney({ vehicle: 'car', tenths: m(10) }, RATES.car, 0).amount).toBe(450)
  })

  it('handles a distance that is not a whole number of miles', () => {
    // 12.7 × 45 = 571.5, which in floating point is not 571.5. Half a penny
    // rounds up, and the result must be an integer either way.
    const value = valueJourney({ vehicle: 'car', tenths: m(12.7) }, RATES.car, 0).amount
    expect(value).toBe(572)
    expect(Number.isInteger(value)).toBe(true)
  })

  it('is worth nothing when it is no distance at all', () => {
    expect(valueJourney({ vehicle: 'car', tenths: 0 }, RATES.car, 0).amount).toBe(0)
  })

  it('refuses to pay for negative miles', () => {
    expect(valueJourney({ vehicle: 'car', tenths: m(-5) }, RATES.car, 0).amount).toBe(0)
  })
})

describe('the 10,000 mile threshold', () => {
  it('still pays 45p on the last mile below it', () => {
    // 9,999 already driven; this mile is the 10,000th and is worth 45p.
    const value = valueJourney({ vehicle: 'car', tenths: m(1) }, RATES.car, m(9_999))
    expect(value.amount).toBe(45)
    expect(value.rate).toBe(45)
  })

  it('pays 25p on the first mile above it', () => {
    const value = valueJourney({ vehicle: 'car', tenths: m(1) }, RATES.car, m(10_000))
    expect(value.amount).toBe(25)
    expect(value.rate).toBe(25)
  })

  it('splits a journey that straddles it', () => {
    // 9,995 driven, then a 10-mile trip: five miles at 45p, five at 25p.
    const value = valueJourney({ vehicle: 'car', tenths: m(10) }, RATES.car, m(9_995))
    expect(value.atFirstRate).toBe(m(5))
    expect(value.atSecondRate).toBe(m(5))
    expect(value.amount).toBe(5 * 45 + 5 * 25)
  })

  it('reports no single rate for a journey that straddles it', () => {
    // Rather than averaging to 35p, which is a rate HMRC has never published.
    const value = valueJourney({ vehicle: 'car', tenths: m(10) }, RATES.car, m(9_995))
    expect(value.rate).toBeNull()
    expect(rateLabel(value.rate)).toBe('Mixed')
  })

  it('ignores the threshold for a flat-rate vehicle', () => {
    // A bicycle is 20p for ever. 12,000 miles of it is still 20p.
    const value = valueJourney({ vehicle: 'bicycle', tenths: m(10) }, RATES.bicycle, m(12_000))
    expect(value.amount).toBe(200)
    expect(value.rate).toBe(20)
  })
})

describe('a year of journeys', () => {
  it('counts the running total in the order given', () => {
    const journeys = [
      { vehicle: 'car' as const, tenths: m(6_000) },
      { vehicle: 'car' as const, tenths: m(6_000) }
    ]
    const [first, second] = valueYear(journeys, RATES)

    expect(first!.amount).toBe(6_000 * 45)
    // The second crosses at 10,000: 4,000 miles at 45p, then 2,000 at 25p.
    expect(second!.amount).toBe(4_000 * 45 + 2_000 * 25)
  })

  it('does not let one vehicle eat another vehicle s allowance', () => {
    // 10,000 miles of driving must not push a bike ride onto the lower rate,
    // and the motorcycle threshold is separate again.
    const [, ride] = valueYear(
      [
        { vehicle: 'car' as const, tenths: m(10_000) },
        { vehicle: 'bicycle' as const, tenths: m(10) }
      ],
      RATES
    )
    expect(ride!.amount).toBe(200)
  })

  it('re-rates later journeys when an earlier one is inserted', () => {
    // This is why nothing is stored. The same 4,000-mile trip is worth two
    // different amounts depending on what came before it, and back-dating a
    // journey has to change the answer.
    const trip = { vehicle: 'car' as const, tenths: m(4_000) }

    const alone = valueYear([trip], RATES)[0]!
    const afterOthers = valueYear([{ vehicle: 'car' as const, tenths: m(8_000) }, trip], RATES)[1]!

    expect(alone.amount).toBe(4_000 * 45)
    expect(afterOthers.amount).toBe(2_000 * 45 + 2_000 * 25)
  })

  it('adds up to the same total however the miles are chopped up', () => {
    // Twelve 1,000-mile trips must be worth exactly what one 12,000-mile trip
    // is, or the number depends on how diligently somebody logged.
    const many = valueYear(
      Array.from({ length: 12 }, () => ({ vehicle: 'car' as const, tenths: m(1_000) })),
      RATES
    ).reduce((sum, one) => sum + one.amount, 0)

    const one = valueYear([{ vehicle: 'car' as const, tenths: m(12_000) }], RATES)[0]!.amount

    expect(many).toBe(one)
    expect(one).toBe(10_000 * 45 + 2_000 * 25)
  })

  it('applies a rate somebody has changed', () => {
    // The rates are settings, not constants: HMRC moves them, and when it does
    // the app must not need a release.
    const changed: Record<Vehicle, MileageRate> = {
      ...RATES,
      car: { vehicle: 'car', firstRate: 50, secondRate: 30, thresholdTenths: m(5_000) }
    }
    const [journey] = valueYear([{ vehicle: 'car' as const, tenths: m(6_000) }], changed)
    expect(journey!.amount).toBe(5_000 * 50 + 1_000 * 30)
  })
})

describe('reading and writing distances', () => {
  it('takes miles as somebody types them', () => {
    expect(toTenths('12.7')).toBe(127)
    expect(toTenths(' 8 ')).toBe(80)
    // A comma is a decimal point on half of Europe's keyboards and turns up.
    expect(toTenths('12,7')).toBe(127)
  })

  it('refuses what is not a distance', () => {
    expect(toTenths('')).toBeNull()
    expect(toTenths('there and back')).toBeNull()
    expect(toTenths('-4')).toBeNull()
  })

  it('always shows one decimal place, so a column lines up', () => {
    expect(milesLabel(80)).toBe('8.0')
    expect(milesLabel(127)).toBe('12.7')
  })

  it('quotes rates in pence until they reach a pound', () => {
    expect(rateLabel(45)).toBe('45p')
    expect(rateLabel(100)).toBe('£1.00')
  })
})

import { describe, expect, it } from 'vitest'
import {
  effectiveRate,
  lineAmount,
  roundPence,
  secondsToHours,
  taxSetAside,
  timeValue,
  totalsFor
} from './money'

describe('roundPence', () => {
  it('rounds half away from zero', () => {
    expect(roundPence(0.5)).toBe(1)
    expect(roundPence(1.5)).toBe(2)
    expect(roundPence(2.5)).toBe(3)
    // Math.round would give 0 here, which would skew credit notes.
    expect(roundPence(-0.5)).toBe(-1)
    expect(roundPence(-1.5)).toBe(-2)
  })
})

describe('lineAmount', () => {
  it('multiplies a fractional quantity by a unit price', () => {
    // 3.25 hours at £55/hr = £178.75
    expect(lineAmount(3.25, 5500)).toBe(17_875)
  })

  it('rounds once rather than accumulating drift', () => {
    expect(lineAmount(0.333, 10_000)).toBe(3330)
  })

  it('handles a plain quantity of one', () => {
    expect(lineAmount(1, 120_000)).toBe(120_000)
  })

  it('returns zero for nonsense input rather than NaN', () => {
    expect(lineAmount(Number.NaN, 5500)).toBe(0)
    expect(lineAmount(2, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('totalsFor', () => {
  const vat = { vatRegistered: true, vatRate: 2000 }

  it('adds 20% VAT to the net', () => {
    expect(totalsFor([120_000], vat)).toEqual({ net: 120_000, vat: 24_000, gross: 144_000 })
  })

  it('omits VAT entirely when not registered', () => {
    expect(totalsFor([120_000], { vatRegistered: false, vatRate: 2000 })).toEqual({
      net: 120_000,
      vat: 0,
      gross: 120_000
    })
  })

  it('computes VAT on the summed net, not per line', () => {
    // Three lines that each round differently in isolation. Per-line VAT would
    // be 3 x 667 = 2001; on the total it is 2000.
    const lines = [3333, 3333, 3334]
    expect(totalsFor(lines, vat)).toEqual({ net: 10_000, vat: 2000, gross: 12_000 })
  })

  it('handles an empty invoice', () => {
    expect(totalsFor([], vat)).toEqual({ net: 0, vat: 0, gross: 0 })
  })

  it('handles a credit line that makes the total negative', () => {
    expect(totalsFor([10_000, -12_000], vat)).toEqual({
      net: -2000,
      vat: -400,
      gross: -2400
    })
  })

  it('supports a non-standard VAT rate', () => {
    expect(totalsFor([100_000], { vatRegistered: true, vatRate: 500 }).vat).toBe(5000)
  })
})

describe('time', () => {
  it('converts seconds to hours to two decimals', () => {
    expect(secondsToHours(3600)).toBe(1)
    expect(secondsToHours(5400)).toBe(1.5)
    expect(secondsToHours(7140)).toBe(1.98)
  })

  it('values time from seconds rather than rounded hours', () => {
    // 1h59m at £60/hr is £119, not £120.
    expect(timeValue(7140, 6000)).toBe(11_900)
  })

  it('values a whole hour exactly', () => {
    expect(timeValue(3600, 5500)).toBe(5500)
  })

  it('values zero time as nothing', () => {
    expect(timeValue(0, 5500)).toBe(0)
  })
})

describe('taxSetAside', () => {
  it('takes a percentage of an amount', () => {
    expect(taxSetAside(120_000, 30)).toBe(36_000)
  })

  it('rounds to the nearest penny', () => {
    expect(taxSetAside(10_001, 30)).toBe(3000)
  })
})

describe('effectiveRate', () => {
  it('prefers the project rate', () => {
    expect(effectiveRate(7000, 6000, 5000)).toBe(7000)
  })

  it('falls back to the client rate', () => {
    expect(effectiveRate(null, 6000, 5000)).toBe(6000)
  })

  it('falls back to the business default', () => {
    expect(effectiveRate(null, null, 5000)).toBe(5000)
  })

  it('treats a zero rate as deliberate, not as missing', () => {
    // Pro bono work is a real case; `??` is correct here and `||` would not be.
    expect(effectiveRate(0, 6000, 5000)).toBe(0)
  })
})
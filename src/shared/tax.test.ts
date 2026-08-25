import { describe, expect, it } from 'vitest'
import { UK_BANDS_2025_26, estimateTax, setAsideShortfall } from './tax'

/**
 * The tax estimate.
 *
 * Somebody will set a standing order to this number and then not think about
 * it again until January. Under-stating it by a few percent is a bill they
 * cannot pay; over-stating it is money sitting idle for a year. The band edges
 * are where both mistakes live, so they are all pinned.
 */
const band = (pounds: number): number => pounds * 100

describe('income tax', () => {
  it('takes nothing below the allowance', () => {
    expect(estimateTax(band(10_000)).incomeTax).toBe(0)
    expect(estimateTax(band(12_570)).incomeTax).toBe(0)
  })

  it('takes 20p in the pound above it', () => {
    // £1 over the allowance is 20p, and nothing else changes.
    expect(estimateTax(band(12_571)).incomeTax).toBe(20)
    expect(estimateTax(band(22_570)).incomeTax).toBe(band(2_000))
  })

  it('finds the higher band exactly where it starts', () => {
    // £50,270 is the last pound of basic rate. One pound more is the first at
    // 40%, and getting this edge wrong is a four-figure error at the top.
    expect(estimateTax(band(50_270)).incomeTax).toBe(band(7_540))
    expect(estimateTax(band(50_271)).incomeTax).toBe(band(7_540) + 40)
  })

  it('finds the additional band', () => {
    expect(estimateTax(band(125_140)).incomeTax).toBeGreaterThan(band(42_000))
    // 45% applies above £125,140, by which point the allowance is gone.
    const step = estimateTax(band(125_141)).incomeTax - estimateTax(band(125_140)).incomeTax
    expect(step).toBe(45)
  })
})

describe('the taper above £100,000', () => {
  it('leaves the allowance alone below it', () => {
    expect(estimateTax(band(100_000)).allowance).toBe(band(12_570))
  })

  it('takes £1 of allowance for every £2 over', () => {
    expect(estimateTax(band(110_000)).allowance).toBe(band(12_570) - band(5_000))
  })

  it('runs the allowance out entirely', () => {
    // Gone by £125,140, and it must not go negative past that.
    expect(estimateTax(band(125_140)).allowance).toBe(0)
    expect(estimateTax(band(200_000)).allowance).toBe(0)
  })

  it('reports the 60% marginal band nobody expects', () => {
    // Inside the taper each extra pound is taxed at 40% and costs 50p of
    // allowance, which is itself taxed at 40% — 60% before NI. It is the most
    // surprising thing in the system and the whole reason to show a marginal
    // rate at all.
    const inside = estimateTax(band(110_000))
    expect(inside.marginalPercent).toBeGreaterThanOrEqual(60)
  })
})

describe('national insurance', () => {
  it('starts at the same threshold as income tax', () => {
    expect(estimateTax(band(12_570)).nationalInsurance).toBe(0)
    expect(estimateTax(band(12_571)).nationalInsurance).toBe(6)
  })

  it('drops to 2% above the upper threshold', () => {
    const step =
      estimateTax(band(50_271)).nationalInsurance - estimateTax(band(50_270)).nationalInsurance
    expect(step).toBe(2)
  })

  it('is charged on profit, not on profit after the allowance', () => {
    // A real and easy mistake: NI has its own threshold that happens to match
    // the personal allowance this year, and subtracting the allowance first
    // would quietly halve the bill.
    const at = estimateTax(band(40_000))
    expect(at.nationalInsurance).toBe(Math.round(band(40_000 - 12_570) * 0.06))
  })
})

describe('what to set aside', () => {
  it('is nothing on no profit', () => {
    const none = estimateTax(0)
    expect(none.total).toBe(0)
    expect(none.recommendedPercent).toBe(0)
  })

  it('treats a loss as nothing rather than a refund', () => {
    expect(estimateTax(-band(5_000)).total).toBe(0)
  })

  it('is well under the pub answer on a modest year', () => {
    // £30,000 profit is nowhere near 30%. Telling somebody to hold back a
    // third of it costs them the use of thousands of pounds for a year.
    const modest = estimateTax(band(30_000))
    expect(modest.recommendedPercent).toBeLessThan(25)
    expect(modest.recommendedPercent).toBeGreaterThan(15)
  })

  it('is well over it on a good year', () => {
    // And the same flat 30% is badly short here, which is the expensive
    // direction and the year somebody can least afford the surprise.
    expect(estimateTax(band(120_000)).recommendedPercent).toBeGreaterThan(35)
  })

  it('rounds the percentage up, never down', () => {
    // This is the number a standing order gets set to. A pound over each
    // month is a rounding error; a pound under, twelve times, is a shortfall.
    for (const profit of [band(18_345), band(41_111), band(77_777)]) {
      const estimate = estimateTax(profit)
      const held = Math.round((profit * estimate.recommendedPercent) / 100)
      expect(held, String(profit)).toBeGreaterThanOrEqual(estimate.total)
    }
  })
})

describe('the shortfall', () => {
  it('says when a flat rate will not cover it', () => {
    const estimate = estimateTax(band(80_000))
    const { enough, shortfall } = setAsideShortfall(estimate, 20)

    expect(enough).toBe(false)
    expect(shortfall).toBeGreaterThan(0)
  })

  it('says when it will', () => {
    const estimate = estimateTax(band(30_000))
    expect(setAsideShortfall(estimate, 40).enough).toBe(true)
  })

  it('never reports a negative shortfall as money owed', () => {
    const estimate = estimateTax(band(30_000))
    expect(setAsideShortfall(estimate, 90).shortfall).toBe(0)
  })
})

describe('the rules themselves', () => {
  it('say which year they are for', () => {
    // Rates change every April. A figure with no year against it is a figure
    // nobody can tell is stale.
    expect(UK_BANDS_2025_26.label).toMatch(/^\d{4}\/\d{2}$/)
  })

  it('are ordered lowest band first', () => {
    for (const bands of [UK_BANDS_2025_26.incomeTax, UK_BANDS_2025_26.nationalInsurance]) {
      const starts = bands.map((entry) => entry.from)
      expect([...starts].sort((a, b) => a - b)).toEqual(starts)
    }
  })
})

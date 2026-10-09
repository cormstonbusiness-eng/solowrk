import { describe, expect, it } from 'vitest'
import {
  UK_BANDS_2025_26,
  estimateTax,
  setAsideShortfall,
  type TaxRules
} from './tax'

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
    // `applyBands` takes each band's ceiling from the next one's floor, so an
    // out-of-order table does not error — it silently taxes the wrong money.
    for (const charge of UK_BANDS_2025_26.charges) {
      const starts = charge.bands.map((entry) => entry.from)
      expect([...starts].sort((a, b) => a - b), charge.id).toEqual(starts)
    }
  })

  it('say what the estimate excludes', () => {
    /*
      The note is per country because the caveats are. A sentence about Class 4
      National Insurance means nothing in Dublin, and leaving one country's
      assumptions on screen under another country's figure would be worse than
      showing none.
    */
    expect(UK_BANDS_2025_26.note).toContain('estimate')
    expect(UK_BANDS_2025_26.note.length).toBeGreaterThan(40)
  })
})


/* ------------------------------------------------------------------ *
 * The engine, rather than the UK's numbers
 *
 * Everything above pins the United Kingdom. These exercise the shapes the UK
 * does not have, against synthetic tables, so Ireland's pack arrives on
 * arithmetic that is already proven rather than being its first test.
 * ------------------------------------------------------------------ */

const rules = (over: Partial<TaxRules>): TaxRules => ({
  label: 'test',
  startYear: 2026,
  verifiedOn: '2026-01-01',
  sourceUrl: 'https://example.invalid/rates',
  note: 'A synthetic table used only by the tests.',
  reliefs: [],
  charges: [],
  ...over
})

describe('credits, as against allowances', () => {
  const credited = rules({
    reliefs: [
      {
        id: 'personalCredit',
        label: 'Personal credit',
        kind: 'credit',
        amount: band(2_000),
        appliesTo: ['incomeTax']
      }
    ],
    charges: [
      { id: 'incomeTax', label: 'Income tax', basis: 'gross', bands: [{ from: 0, rate: 20 }] }
    ]
  })

  it('comes off the tax due, not off the income', () => {
    // 20% of £20,000 is £4,000; a £2,000 credit leaves £2,000. An allowance of
    // the same size would have left £3,600 — which is why the two cannot be
    // modelled as one thing.
    expect(estimateTax(band(20_000), credited).total).toBe(band(2_000))
  })

  it('is not refundable', () => {
    // 20% of £5,000 is £1,000 against a £2,000 credit. The answer is nothing
    // owed, never £1,000 owed to the taxpayer.
    expect(estimateTax(band(5_000), credited).total).toBe(0)
  })

  it('reports only the part actually used', () => {
    const small = estimateTax(band(5_000), credited)
    expect(small.credits).toBe(band(1_000))
    expect(estimateTax(band(20_000), credited).credits).toBe(band(2_000))
  })

  it('does not touch a charge it does not apply to', () => {
    /*
      Ireland's credits reduce income tax but not USC or PRSI. A credit that
      quietly reduced everything would understate a bill substantially, and
      the mistake would look like a smaller number rather than an error.
    */
    const withSocial = rules({
      reliefs: credited.reliefs,
      charges: [
        ...credited.charges,
        { id: 'social', label: 'Social charge', basis: 'gross', bands: [{ from: 0, rate: 4 }] }
      ]
    })

    const estimate = estimateTax(band(20_000), withSocial)
    expect(estimate.charges.find((c) => c.id === 'social')?.amount).toBe(band(800))
  })
})

describe('a cliff-edge exemption', () => {
  const exempting = rules({
    charges: [
      {
        id: 'usc',
        label: 'USC',
        basis: 'gross',
        exemptBelow: band(13_000),
        bands: [{ from: 0, rate: 2 }]
      }
    ]
  })

  it('charges nothing at all below the threshold', () => {
    expect(estimateTax(band(12_999), exempting).total).toBe(0)
    expect(estimateTax(band(12_999), exempting).charges[0]!.exempt).toBe(true)
  })

  it('charges from zero once the threshold is reached', () => {
    // Not from the threshold — on the whole amount. This is what makes it a
    // cliff rather than a band, and it is the easiest thing here to get wrong.
    expect(estimateTax(band(13_000), exempting).total).toBe(band(260))
    expect(estimateTax(band(13_000), exempting).charges[0]!.exempt).toBeUndefined()
  })

  it('warns about the cliff while still below it', () => {
    const near = estimateTax(band(12_500), exempting)
    expect(near.cliffAhead?.chargeLabel).toBe('USC')
    expect(near.cliffAhead?.at).toBe(band(13_000))
    // £260 of tax for one more pound of profit, which is the whole point of
    // saying so in money rather than as a marginal rate.
    expect(near.cliffAhead?.cost).toBe(band(260))
  })

  it('says nothing once the cliff is behind them', () => {
    expect(estimateTax(band(20_000), exempting).cliffAhead).toBeUndefined()
  })

  it('caps the marginal rate rather than reporting a nonsense one', () => {
    // One pound over the edge genuinely costs £260, which is a 26,000%
    // marginal rate. True, and useless — the cliff field carries that.
    expect(estimateTax(band(12_999), exempting).marginalPercent).toBe(100)
  })
})

describe('an annual minimum', () => {
  const floored = rules({
    charges: [
      {
        id: 'prsi',
        label: 'PRSI',
        basis: 'gross',
        bands: [{ from: 0, rate: 4 }],
        minimum: { amount: band(650), whenIncomeAtLeast: band(5_000) }
      }
    ]
  })

  it('does not apply below the trigger', () => {
    // 4% of £4,999 is £200, and the floor has not engaged.
    expect(estimateTax(band(4_999), floored).total).toBe(19_996)
  })

  it('raises a small charge to the floor', () => {
    // 4% of £5,000 is £200, but the minimum contribution is £650.
    const at = estimateTax(band(5_000), floored)
    expect(at.total).toBe(band(650))
    expect(at.charges[0]!.atMinimum).toBe(true)
  })

  it('leaves a charge above the floor alone', () => {
    // 4% of £30,000 is £1,200, well over the minimum.
    const above = estimateTax(band(30_000), floored)
    expect(above.total).toBe(band(1_200))
    expect(above.charges[0]!.atMinimum).toBeUndefined()
  })
})

describe('the marginal rate is a measurement, not a rule', () => {
  it('finds each UK band edge without being told where it is', () => {
    /*
      The replacement for a hand-written special case that multiplied the
      income-tax rate by 1.5 inside the taper. Measuring the next pound
      instead reproduces every edge — including the taper — and cost nothing
      in accuracy: not one figure in this file changed when it was swapped.
    */
    // Basic rate plus 6% NI.
    expect(estimateTax(band(30_000)).marginalPercent).toBe(26)
    // Higher rate plus 2% NI.
    expect(estimateTax(band(60_000)).marginalPercent).toBe(42)
    // Inside the taper: 40% on £1.50 of taxable income, plus 2% NI.
    expect(estimateTax(band(110_000)).marginalPercent).toBe(62)
    // Past the taper, additional rate plus 2%.
    expect(estimateTax(band(150_000)).marginalPercent).toBe(47)
  })

  it('is nothing below the allowance', () => {
    expect(estimateTax(band(10_000)).marginalPercent).toBe(0)
  })
})

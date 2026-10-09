import { describe, expect, it } from 'vitest'
import {
  COUNTRY_CODES,
  COUNTRY_PACKS,
  countryPack,
  isCountryCode,
  rulesFor,
  taxYearStartLabel
} from './index'
import { GB } from './gb'
import { IE } from './ie'
import { estimateTax } from '../tax'

describe('the country registry', () => {
  it('has a pack for every code it advertises', () => {
    /*
      A code in `COUNTRY_CODES` with no pack behind it would show up in the
      country picker and then break the page that read it. The two lists are
      declared separately because the type has to be a literal union, so this
      is the only thing keeping them honest.
    */
    for (const code of COUNTRY_CODES) {
      expect(COUNTRY_PACKS[code], code).toBeDefined()
      expect(COUNTRY_PACKS[code].code, code).toBe(code)
    }
  })

  it('falls back rather than throwing on a code it has never seen', () => {
    /*
      Not hypothetical: `settings.country_code` is a plain text column, and an
      older build can open a workspace a newer one wrote. Falling back means
      such a workspace opens and can be corrected in Settings, instead of
      failing on every page that shows a figure.
    */
    expect(countryPack('ZZ').code).toBe('GB')
    expect(countryPack(null).code).toBe('GB')
    expect(countryPack('').code).toBe('GB')
  })

  it('knows which codes it supports', () => {
    expect(isCountryCode('GB')).toBe(true)
    expect(isCountryCode('ZZ')).toBe(false)
  })
})

describe('the United Kingdom pack', () => {
  it('states what used to be hard-coded', () => {
    /*
      The golden test for migration 34.

      Every value here was a constant somewhere in the app before the pack
      existed, and `session.create` now writes them from here. If one of them
      changes, an existing workspace's defaults change with it — so they are
      pinned rather than merely present.
    */
    expect(GB.currency).toBe('GBP')
    expect(GB.locale).toBe('en-GB')
    expect(GB.name).toBe('United Kingdom')
    expect(GB.timeZone).toBe('Europe/London')
    expect(GB.salesTax.defaultRate).toBe(2000)
    expect(GB.salesTax.label).toBe('VAT')
    expect(GB.taxYear.start).toEqual({ day: 6, month: 4 })
    expect(GB.taxYear.labelStyle).toBe('split')
    expect(GB.defaultSetAsidePercent).toBe(30)
    // 0 is Monday in the app's own convention, not Sunday as in JavaScript.
    expect(GB.weekStartsOn).toBe(0)
    expect(GB.dateParseOrder).toBe('dmy')
    expect(GB.accountingBasis).toBe('cash')
    expect(GB.templatePack).toBe('uk')
  })

  it('ships the HMRC mileage scheme in miles', () => {
    expect(GB.mileage).not.toBeNull()
    expect(GB.mileage?.unit).toBe('mile')
    expect(GB.mileage?.authority).toBe('HMRC')
    // 45p for the first 10,000 miles of the tax year, then 25p.
    expect(GB.mileage?.rates.car.firstRate).toBe(45)
    expect(GB.mileage?.rates.car.secondRate).toBe(25)
  })
})

describe('rulesFor', () => {
  it('returns the table published for that tax year', () => {
    const found = rulesFor('GB', 2025)
    expect(found.rules.label).toBe('2025/26')
    expect(found.stale).toBe(false)
  })

  it('flags a year it has no table for', () => {
    /*
      The honesty requirement.

      Tax tables are shipped in the app, so a user on an old build in a new
      tax year gets last year's rates applied to this year's profit. That is
      the least-bad answer — there is no useful "no tax" figure to show
      somebody who has earned money — but it must never be silent, because
      the number looks exactly as authoritative either way.
    */
    const found = rulesFor('GB', 2099)
    expect(found.stale).toBe(true)
    expect(found.rules.label).toBe('2025/26')
  })

  it('gives every table a year, a source and a verification date', () => {
    // Without these the app cannot say how old a figure's rates are, which is
    // the whole mechanism for making staleness visible rather than silent.
    for (const code of COUNTRY_CODES) {
      for (const rules of COUNTRY_PACKS[code].taxRules) {
        expect(rules.startYear, rules.label).toBeGreaterThan(2000)
        expect(rules.verifiedOn, rules.label).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(rules.sourceUrl, rules.label).toMatch(/^https:\/\//)
      }
    }
  })
})


/* ------------------------------------------------------------------ *
 * Ireland
 *
 * Every figure here is a number somebody may set a standing order to, so the
 * edges are pinned rather than sampled. Verified against Revenue and the KPMG
 * Budget 2026 tables on 9 October 2026.
 * ------------------------------------------------------------------ */

const euro = (amount: number): number => amount * 100
const ieRules = COUNTRY_PACKS.IE.taxRules[0]!

describe('the Ireland pack', () => {
  it('runs on the euro and the calendar year', () => {
    expect(IE.currency).toBe('EUR')
    expect(IE.locale).toBe('en-IE')
    expect(IE.timeZone).toBe('Europe/Dublin')
    expect(IE.taxYear.start).toEqual({ day: 1, month: 1 })
    expect(IE.taxYear.labelStyle).toBe('calendar')
    // 23% standard rate, against the UK's 20%.
    expect(IE.salesTax.defaultRate).toBe(2300)
    expect(IE.address.postcodeLabel).toBe('Eircode')
    expect(IE.templatePack).toBe('ie')
  })

  it('ships no mileage scheme', () => {
    /*
      A decision, not a gap. Revenue's civil service motor rates are banded by
      engine size and cumulative distance and are what an employer may
      reimburse an employee at — not a flat allowance a sole trader claims. A
      plausible-looking guess here would land on somebody's tax return.
    */
    expect(IE.mileage).toBeNull()
  })

  it('seeds the same set-aside as the UK', () => {
    /*
      Deliberately not higher, though the intuition says it should be — see
      the note in the pack. The two systems cross over in the fifties, so a
      flat seed cannot encode "Ireland costs more" because it does not.
    */
    expect(IE.defaultSetAsidePercent).toBe(GB.defaultSetAsidePercent)
  })
})

describe('Irish income tax', () => {
  it('charges 20% to the standard rate cut-off and 40% above', () => {
    // €44,000 for a single person. One euro more is the first at 40%, and
    // getting this edge wrong is a four-figure error at the top.
    const step =
      estimateTax(euro(44_001), ieRules).charges.find((c) => c.id === 'incomeTax')!.amount -
      estimateTax(euro(44_000), ieRules).charges.find((c) => c.id === 'incomeTax')!.amount
    expect(step).toBe(40)
  })

  it('applies the credits to tax due, not to income', () => {
    /*
      €30,000 at 20% is €6,000, less €4,000 of credits is €2,000. Treating the
      credits as an allowance instead would give €5,200 — the single most
      likely way to get an Irish figure wrong by reasoning from the UK.
    */
    const estimate = estimateTax(euro(30_000), ieRules)
    expect(estimate.charges.find((c) => c.id === 'incomeTax')!.amount).toBe(euro(2_000))
    expect(estimate.credits).toBe(euro(4_000))
  })

  it('never turns unused credits into a refund', () => {
    // €15,000 at 20% is €3,000 against €4,000 of credits. Nothing owed, and
    // certainly not €1,000 owed to the taxpayer.
    const estimate = estimateTax(euro(15_000), ieRules)
    expect(estimate.charges.find((c) => c.id === 'incomeTax')!.amount).toBe(0)
  })

  it('has no tax-free allowance', () => {
    // The structural difference from the UK, and why Irish tax starts sooner.
    expect(estimateTax(euro(30_000), ieRules).allowance).toBe(0)
  })
})

describe('the USC exemption cliff', () => {
  const usc = (profit: number): number =>
    estimateTax(profit, ieRules).charges.find((c) => c.id === 'usc')!.amount

  it('charges nothing below €13,000 of income', () => {
    expect(usc(euro(12_999))).toBe(0)
    expect(estimateTax(euro(12_999), ieRules).charges.find((c) => c.id === 'usc')!.exempt).toBe(
      true
    )
  })

  it('charges from zero once €13,000 is reached', () => {
    // 0.5% of the first €12,012 plus 2% of the remaining €988 — on the whole
    // amount, not on the part above the threshold. That is what makes it a
    // cliff, and it is the easiest thing in Irish tax to model wrongly.
    expect(usc(euro(13_000))).toBe(Math.round(euro(12_012) * 0.005 + euro(988) * 0.02))
  })

  it('warns while still below the edge', () => {
    const near = estimateTax(euro(12_500), ieRules)
    expect(near.cliffAhead?.chargeLabel).toBe('USC')
    expect(near.cliffAhead?.at).toBe(euro(13_000))
    /*
      About €80 for one more euro of profit — the whole USC bill at €13,000,
      since the bands are progressive within the charge rather than a flat
      rate on everything. Not ruinous, but a step rather than a rate, and the
      person deciding whether to take one more small job in December is
      exactly who should be told.
    */
    expect(near.cliffAhead!.cost).toBe(usc(euro(13_000)))
    expect(near.cliffAhead!.cost).toBeGreaterThan(euro(75))
  })

  it('surcharges non-PAYE income above €100,000', () => {
    // 8% plus the 3% surcharge, which lands on exactly this app's users.
    const step = usc(euro(100_001)) - usc(euro(100_000))
    expect(step).toBe(11)
  })
})

describe('Irish PRSI', () => {
  const prsi = (profit: number): number =>
    estimateTax(profit, ieRules).charges.find((c) => c.id === 'prsi')!.amount

  it('takes the higher of the two 2026 rates', () => {
    /*
      The rate rose from 4.2% to 4.35% on 1 October 2026, part-way through the
      calendar tax year. A single annual band cannot express that, so the
      table takes 4.35% — over-stating by at most 0.15% of profit, which is
      the safe direction for a figure somebody sets aside against.
    */
    expect(prsi(euro(50_000))).toBe(Math.round(euro(50_000) * 0.0435))
  })

  it('applies the €650 annual minimum', () => {
    // 4.35% of €6,000 is €261, but the minimum contribution is €650.
    const at = estimateTax(euro(6_000), ieRules)
    expect(at.charges.find((c) => c.id === 'prsi')!.amount).toBe(euro(650))
    expect(at.charges.find((c) => c.id === 'prsi')!.atMinimum).toBe(true)
  })

  it('leaves a contribution above the minimum alone', () => {
    expect(estimateTax(euro(50_000), ieRules).charges.find((c) => c.id === 'prsi')!.atMinimum)
      .toBeUndefined()
  })
})

describe('what an Irish sole trader owes overall', () => {
  it('crosses over with the UK rather than being simply dearer', () => {
    /*
      The comparison that makes the point of the whole exercise, and the one
      that caught a wrong assumption while this pack was being written.

      It looks as though Ireland must cost more — three charges, and income
      tax from the first euro where Britain has £12,570 tax-free. It does not,
      at the bottom: Ireland's €4,000 of credits are worth €4,000, while the
      UK allowance saves a basic-rate payer about £2,514. So Ireland is
      *cheaper* on a modest profit and dearer on a large one, and no flat
      percentage can express that.

      Pinned in both directions because an "Ireland is more expensive"
      shortcut is the kind of thing that gets re-introduced by somebody
      reasoning from intuition, as it nearly was here.
    */
    const ukRules = GB.taxRules[0]!

    expect(estimateTax(euro(30_000), ieRules).total).toBeLessThan(
      estimateTax(euro(30_000), ukRules).total
    )
    expect(estimateTax(euro(100_000), ieRules).total).toBeGreaterThan(
      estimateTax(euro(100_000), ukRules).total
    )
  })

  it('never recommends setting aside more than everything', () => {
    // The PRSI minimum makes a tiny profit lumpy, and an unclamped percentage
    // on a €700 profit would read as nonsense.
    for (const profit of [euro(700), euro(5_000), euro(13_000), euro(200_000)]) {
      const estimate = estimateTax(profit, ieRules)
      expect(estimate.recommendedPercent, String(profit)).toBeLessThanOrEqual(100)
      expect(estimate.recommendedPercent, String(profit)).toBeGreaterThanOrEqual(0)
    }
  })
})


describe('taxYearStartLabel', () => {
  it('spells the month out', () => {
    /*
      "6/4" means the sixth of April to a British reader and the fourth of
      June to an American one — and this string appears in the one place the
      app asks somebody which of those two worlds they live in. A country
      picker that explains itself ambiguously is worse than one that says
      nothing at all.
    */
    expect(taxYearStartLabel(GB)).toBe('6 April')
    expect(taxYearStartLabel(IE)).toBe('1 January')
  })

  it('never renders a bare numeric date', () => {
    for (const code of COUNTRY_CODES) {
      expect(taxYearStartLabel(COUNTRY_PACKS[code]), code).not.toMatch(/\d+\s*\/\s*\d+/)
    }
  })
})

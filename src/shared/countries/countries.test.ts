import { describe, expect, it } from 'vitest'
import { COUNTRY_CODES, COUNTRY_PACKS, countryPack, isCountryCode, rulesFor } from './index'
import { GB } from './gb'

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

import type { TaxRules } from '../tax'
import { GB } from './gb'
import { IE } from './ie'
import { DEFAULT_COUNTRY, type CountryCode, type CountryPack } from './types'

export * from './types'

/**
 * Every country the app can be set to.
 *
 * Adding one is meant to be writing a file and adding a line here. If it ever
 * requires touching the tax engine, the formatter or a query, something that
 * should have been a fact in the pack has been written into code instead.
 */
export const COUNTRY_PACKS: Record<CountryCode, CountryPack> = {
  GB,
  IE
}

/**
 * The pack for a country code, falling back rather than throwing.
 *
 * An unknown code is not hypothetical: `settings.country_code` is a plain text
 * column, and an older build can be pointed at a workspace a newer one wrote.
 * Falling back to the default means such a workspace opens and can be
 * corrected, rather than failing on every page that shows a figure.
 */
export function countryPack(code: string | null | undefined): CountryPack {
  if (!code) return COUNTRY_PACKS[DEFAULT_COUNTRY]
  return COUNTRY_PACKS[code as CountryCode] ?? COUNTRY_PACKS[DEFAULT_COUNTRY]
}

/** Whether a string is a country this build knows about. */
export function isCountryCode(code: string): code is CountryCode {
  return code in COUNTRY_PACKS
}

/**
 * How long a tax table may go unverified before the app says so.
 *
 * Fourteen months rather than twelve: a table published for a tax year stays
 * correct throughout it, and a warning that appeared a month before the rates
 * actually changed would be noise. Beyond fourteen months it has certainly
 * been superseded.
 */
export const RULES_STALE_AFTER_MONTHS = 14

export interface RulesLookup {
  rules: TaxRules
  /**
   * True when no table exists for the year asked for, so an older one is being
   * applied to it.
   *
   * The app must say this out loud. Somebody acting on a tax figure computed
   * at last year's rates needs to know that is what they are looking at, and
   * silence here is the difference between an estimate and a misrepresentation.
   */
  stale: boolean
}

/**
 * The tax table for a country and tax year.
 *
 * Returns the exact year's table where there is one, and otherwise the newest
 * available, flagged. Never returns nothing: a pack with no tables at all
 * would be a build error, and there is no useful "no tax" answer to give
 * somebody who has earned money.
 */
export function rulesFor(code: string | null | undefined, startYear: number): RulesLookup {
  const pack = countryPack(code)
  const exact = pack.taxRules.find((rules) => rules.startYear === startYear)
  if (exact) return { rules: exact, stale: false }

  /*
    The newest table, which is not necessarily the last in the array — the
    array is maintained by hand and sorting it here costs nothing compared to
    applying the wrong year's rates because somebody appended out of order.
  */
  const newest = [...pack.taxRules].sort((a, b) => b.startYear - a.startYear)[0]
  if (!newest) {
    throw new Error(`Country pack ${pack.code} ships no tax tables`)
  }

  return { rules: newest, stale: true }
}

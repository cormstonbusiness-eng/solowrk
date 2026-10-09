import type { BasisPoints } from '../types'
import type { MileageRate, Vehicle } from '../mileage'
import type { TaxYearRules } from '../taxYear'
import type { TaxRules } from '../tax'

/**
 * What the app needs to know about where a business is.
 *
 * One pack per country, held as code rather than as database rows. That choice
 * has a cost — a rate that turns out to be wrong needs an app update — but the
 * alternative is strictly worse: a table shipped with a bad figure *cannot be
 * corrected for existing users at all*, because their workspace already has
 * the row. Staleness is instead made visible, by giving every tax table a
 * `verifiedOn` date and warning when the current year has no entry.
 *
 * The pack is the only place a jurisdiction's facts live. If a feature needs to
 * branch on the country, it is almost always because a fact is missing here.
 */
export interface CountryPack {
  /** ISO 3166-1 alpha-2. Stored on the workspace as `settings.country_code`. */
  code: CountryCode
  /** As it should appear in an invoice address block. */
  name: string
  /** BCP 47. Drives dates, number grouping and collation. */
  locale: string
  /** ISO 4217. Becomes the workspace's home currency. */
  currency: string
  /** IANA zone, for seeding the calendar rather than overriding the machine. */
  timeZone: string

  /** Where the tax year starts, and how it is written down. */
  taxYear: TaxYearRules

  /**
   * The consumption tax, whatever it is called locally.
   *
   * The label is part of the pack because it is printed on invoices and is a
   * legal requirement to get right: VAT in the UK and Ireland, GST in Canada,
   * Australia and New Zealand, sales tax in the United States — and the
   * mechanics differ as much as the names, which is why only the single-rate
   * case is modelled today.
   */
  salesTax: {
    /** 'VAT', 'GST', 'Sales tax'. */
    label: string
    /** 'VAT number', 'GST number', 'EIN'. */
    numberLabel: string
    /** The standard rate, in basis points. 2000 is twenty percent. */
    defaultRate: BasisPoints
  }

  /**
   * Tax tables, newest last, one per tax year.
   *
   * A list rather than a single table so that last year's figures stay
   * available for last year's numbers — somebody looking at a prior year
   * should not see it recalculated at this year's rates.
   */
  taxRules: TaxRules[]

  /**
   * What to seed the flat set-aside percentage at.
   *
   * A starting point, not an answer: the band-based estimate in `@shared/tax`
   * is what tells somebody whether it is enough.
   */
  defaultSetAsidePercent: number

  /**
   * Which day a week starts on, as a Monday-first index — 0 is Monday.
   *
   * Deliberately *not* the JavaScript `getDay()` convention. See the note in
   * `@shared/calendar`: the same convention encodes the working-days bitmask,
   * and conflating the two rotates everybody's working week.
   */
  weekStartsOn: number

  /**
   * How to read an ambiguous numeric date, for bank and receipt imports.
   *
   * `03/04/2026` is the third of April in Britain and the fourth of March in
   * America. This is a correctness setting, not a display one — guessing wrong
   * writes the wrong month into the ledger.
   */
  dateParseOrder: 'dmy' | 'mdy'

  /**
   * The mileage scheme, or `null` where there is no comparable one.
   *
   * `null` is a real answer rather than a gap. HMRC publishes flat approved
   * rates a sole trader can simply claim; Ireland's civil-service motor rates
   * are banded by engine size *and* cumulative distance and are not the same
   * instrument. Shipping a plausible-looking guess would put a wrong figure on
   * somebody's tax return, so a pack without a scheme hides the feature.
   */
  mileage: MileageScheme | null

  /** How an address is shaped and labelled. */
  address: {
    /** A state or province field, where one is expected. `null` omits it. */
    region: { label: string } | null
    /** 'Postcode', 'Eircode', 'ZIP code'. */
    postcodeLabel: string
  }

  /**
   * Whether income is counted when invoiced or when paid.
   *
   * Stated explicitly so that a country which mandates accruals cannot
   * silently inherit the cash basis the app assumes today.
   */
  accountingBasis: 'cash' | 'accrual'

  /**
   * Which set of starter contracts and terms to seed.
   *
   * Prose citing statute cannot be parameterised — the UK templates name the
   * Late Payment of Commercial Debts (Interest) Act 1998 and fixed
   * compensation in pounds — so each jurisdiction gets its own pack, swapped
   * wholesale.
   */
  templatePack: TemplatePack
}

/**
 * A mileage allowance scheme.
 *
 * `unit` is unused while only the UK has a scheme, and is here so that the
 * first metric country is a data change rather than an audit of every
 * distance in the app.
 */
export interface MileageScheme {
  unit: 'mile' | 'km'
  vehicles: readonly Vehicle[]
  rates: Record<Vehicle, Omit<MileageRate, 'vehicle'>>
  /** Named on screen, so the rate editor can say whose rates these are. */
  authority: string
}

/**
 * The countries this build actually supports.
 *
 * Ireland is deliberately absent until its pack and tax tables exist. A code
 * listed here appears in the country picker and is written to a workspace, so
 * advertising one that quietly falls back to the UK would hand somebody a
 * sterling workspace on a 6 April tax year and let them find out later.
 */
export const COUNTRY_CODES = ['GB'] as const
export type CountryCode = (typeof COUNTRY_CODES)[number]

export const TEMPLATE_PACKS = ['uk', 'ie'] as const
export type TemplatePack = (typeof TEMPLATE_PACKS)[number]

/** Before anybody has been asked. Every existing workspace is this. */
export const DEFAULT_COUNTRY: CountryCode = 'GB'

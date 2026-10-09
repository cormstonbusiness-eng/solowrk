/**
 * Tax year arithmetic.
 *
 * The boundary is data, not a constant. The UK runs 6 April to 5 April and
 * writes the year as `2026/27`; Ireland runs the calendar year and writes it
 * as `2026`. Both shapes are expressed by `TaxYearRules`, which a country
 * pack supplies.
 *
 * Getting the boundary wrong puts income in the wrong year on somebody's tax
 * return, so the rules are isolated here and tested at the boundary rather
 * than inlined into queries.
 *
 * Dates are handled as `yyyy-mm-dd` strings throughout. Constructing `Date`
 * objects from them invites timezone shifts — a payment at 00:30 BST on 6 April
 * must not land in the previous tax year because UTC still thinks it is the 5th.
 */

import { DEFAULT_LOCALE, formatMonthLong } from './dateFormat'

export interface TaxYear {
  /** First day, inclusive. */
  start: string
  /** Last day, inclusive. */
  end: string
  /** As HMRC writes it: 2026/27. */
  label: string
  /** Calendar year the tax year starts in. */
  startYear: number
}

export interface TaxYearStart {
  day: number
  month: number
}

/**
 * How a tax year is written down.
 *
 * `split` is the HMRC form `2026/27`, for a year that straddles two calendar
 * years. `calendar` is Ireland's `2026`. The difference is not only
 * cosmetic: the split form contains a slash, which the year-end pack has to
 * strip out of a folder name.
 */
export type TaxYearLabelStyle = 'split' | 'calendar'

/** A jurisdiction's tax year, as a country pack states it. */
export interface TaxYearRules {
  start: TaxYearStart
  labelStyle: TaxYearLabelStyle
}

export const UK_TAX_YEAR_START: TaxYearStart = { day: 6, month: 4 }

/**
 * What every function here falls back to.
 *
 * Kept as the default so a workspace that has never been asked where it is
 * behaves exactly as the app always did.
 */
export const UK_TAX_YEAR: TaxYearRules = {
  start: UK_TAX_YEAR_START,
  labelStyle: 'split'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `yyyy-mm-dd` for today, in local time. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The tax year containing `date`.
 *
 * A date on or after 6 April belongs to the year starting that April; anything
 * earlier belongs to the year that started the previous April.
 */
/**
 * Tax-year rules from a settings row.
 *
 * Pairs the two loose columns the schema has carried since the beginning with
 * a label style. Structurally typed rather than importing `Settings`, which
 * would make this module depend on the whole type surface for two numbers.
 */
export function taxYearRulesFrom(
  settings: { taxYearStartDay: number; taxYearStartMonth: number },
  labelStyle: TaxYearLabelStyle = 'split'
): TaxYearRules {
  return {
    start: { day: settings.taxYearStartDay, month: settings.taxYearStartMonth },
    labelStyle
  }
}

export function taxYearFor(date: string, rules: TaxYearRules = UK_TAX_YEAR): TaxYear {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const { start } = rules

  const onOrAfterStart = month > start.month || (month === start.month && day >= start.day)
  const startYear = onOrAfterStart ? year : year - 1

  return taxYearStarting(startYear, rules)
}

export function taxYearStarting(
  startYear: number,
  rules: TaxYearRules = UK_TAX_YEAR
): TaxYear {
  const { start, labelStyle } = rules
  const startDate = `${startYear}-${pad(start.month)}-${pad(start.day)}`

  // The day before the next year's start — computed with a Date so month
  // lengths and leap years are handled, then read back in local time.
  const dayBefore = new Date(startYear + 1, start.month - 1, start.day - 1)
  const end = `${dayBefore.getFullYear()}-${pad(dayBefore.getMonth() + 1)}-${pad(dayBefore.getDate())}`

  return {
    start: startDate,
    end,
    label:
      labelStyle === 'calendar'
        ? String(startYear)
        : `${startYear}/${pad((startYear + 1) % 100)}`,
    startYear
  }
}

export function currentTaxYear(rules: TaxYearRules = UK_TAX_YEAR): TaxYear {
  return taxYearFor(today(), rules)
}

/** Inclusive on both ends. */
export function isInTaxYear(date: string, taxYear: TaxYear): boolean {
  return date >= taxYear.start && date <= taxYear.end
}

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface DateRange {
  from: string
  to: string
  label: string
}

/** Calendar ranges for the finance page's period switcher. */
/**
 * `rules` reaches the `year` case, which until now called `taxYearFor` with no
 * argument at all — so the switcher showed 6 April to 5 April however the
 * workspace was configured. Invisible while every user was British; wrong for
 * the first user who is not.
 */
export function rangeFor(
  period: Period,
  reference: string = today(),
  rules: TaxYearRules = UK_TAX_YEAR,
  locale: string = DEFAULT_LOCALE
): DateRange {
  const [year, month, day] = reference.split('-').map(Number) as [number, number, number]

  switch (period) {
    case 'day':
      return { from: reference, to: reference, label: reference }

    case 'week': {
      // Monday-based, as a working week.
      const date = new Date(year, month - 1, day)
      const offset = (date.getDay() + 6) % 7
      const monday = new Date(year, month - 1, day - offset)
      const sunday = new Date(year, month - 1, day - offset + 6)
      return {
        from: formatDate(monday),
        to: formatDate(sunday),
        label: 'This week'
      }
    }

    case 'month': {
      const last = new Date(year, month, 0).getDate()
      return {
        from: `${year}-${pad(month)}-01`,
        to: `${year}-${pad(month)}-${pad(last)}`,
        label: formatMonthLong(`${year}-${pad(month)}-01`, locale)
      }
    }

    case 'quarter': {
      const firstMonth = Math.floor((month - 1) / 3) * 3 + 1
      const lastDay = new Date(year, firstMonth + 2, 0).getDate()
      return {
        from: `${year}-${pad(firstMonth)}-01`,
        to: `${year}-${pad(firstMonth + 2)}-${pad(lastDay)}`,
        label: `Q${Math.floor((month - 1) / 3) + 1} ${year}`
      }
    }

    case 'year': {
      const taxYear = taxYearFor(reference, rules)
      return { from: taxYear.start, to: taxYear.end, label: `Tax year ${taxYear.label}` }
    }
  }
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Add days to a `yyyy-mm-dd` string, staying in local time. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return formatDate(new Date(year, month - 1, day + days))
}

/** Add months, clamping to the end of shorter months (31 Jan + 1 month = 28 Feb). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const lastDayOfTarget = new Date(year, month - 1 + months + 1, 0).getDate()
  return formatDate(new Date(year, month - 1 + months, Math.min(day, lastDayOfTarget)))
}
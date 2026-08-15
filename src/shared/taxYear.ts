/**
 * UK tax year arithmetic.
 *
 * The UK tax year runs 6 April to 5 April. Getting the boundary wrong puts
 * income in the wrong year on someone's self-assessment, so the rules are
 * isolated here and tested at the boundary rather than inlined into queries.
 *
 * Dates are handled as `yyyy-mm-dd` strings throughout. Constructing `Date`
 * objects from them invites timezone shifts — a payment at 00:30 BST on 6 April
 * must not land in the previous tax year because UTC still thinks it is the 5th.
 */

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

export const UK_TAX_YEAR_START: TaxYearStart = { day: 6, month: 4 }

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
export function taxYearFor(date: string, start: TaxYearStart = UK_TAX_YEAR_START): TaxYear {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]

  const onOrAfterStart = month > start.month || (month === start.month && day >= start.day)
  const startYear = onOrAfterStart ? year : year - 1

  return taxYearStarting(startYear, start)
}

export function taxYearStarting(
  startYear: number,
  start: TaxYearStart = UK_TAX_YEAR_START
): TaxYear {
  const startDate = `${startYear}-${pad(start.month)}-${pad(start.day)}`

  // The day before the next year's start — computed with a Date so month
  // lengths and leap years are handled, then read back in local time.
  const dayBefore = new Date(startYear + 1, start.month - 1, start.day - 1)
  const end = `${dayBefore.getFullYear()}-${pad(dayBefore.getMonth() + 1)}-${pad(dayBefore.getDate())}`

  return {
    start: startDate,
    end,
    label: `${startYear}/${pad((startYear + 1) % 100)}`,
    startYear
  }
}

export function currentTaxYear(start: TaxYearStart = UK_TAX_YEAR_START): TaxYear {
  return taxYearFor(today(), start)
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
export function rangeFor(period: Period, reference: string = today()): DateRange {
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
        label: new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric'
        })
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
      const taxYear = taxYearFor(reference)
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
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  isInTaxYear,
  rangeFor,
  taxYearFor,
  taxYearRulesFrom,
  taxYearStarting,
  type TaxYearRules
} from './taxYear'

describe('taxYearFor', () => {
  it('puts 6 April in the tax year starting that day', () => {
    const year = taxYearFor('2026-04-06')
    expect(year.start).toBe('2026-04-06')
    expect(year.end).toBe('2027-04-05')
    expect(year.label).toBe('2026/27')
  })

  it('puts 5 April in the previous tax year', () => {
    // The boundary that matters: one day earlier is a whole year earlier for
    // self-assessment purposes.
    const year = taxYearFor('2026-04-05')
    expect(year.start).toBe('2025-04-06')
    expect(year.end).toBe('2026-04-05')
    expect(year.label).toBe('2025/26')
  })

  it('handles dates either side of new year', () => {
    expect(taxYearFor('2026-12-31').label).toBe('2026/27')
    expect(taxYearFor('2027-01-01').label).toBe('2026/27')
  })

  it('handles March, which is always the previous tax year', () => {
    expect(taxYearFor('2026-03-31').label).toBe('2025/26')
  })

  it('pads the second year in the label', () => {
    expect(taxYearStarting(2009).label).toBe('2009/10')
    expect(taxYearStarting(1999).label).toBe('1999/00')
  })

  it('ends on 5 April even across a leap year', () => {
    expect(taxYearStarting(2027).end).toBe('2028-04-05')
  })
})

describe('isInTaxYear', () => {
  const year = taxYearStarting(2026)

  it('includes both boundary days', () => {
    expect(isInTaxYear('2026-04-06', year)).toBe(true)
    expect(isInTaxYear('2027-04-05', year)).toBe(true)
  })

  it('excludes the days either side', () => {
    expect(isInTaxYear('2026-04-05', year)).toBe(false)
    expect(isInTaxYear('2027-04-06', year)).toBe(false)
  })
})

describe('rangeFor', () => {
  it('gives a whole calendar month', () => {
    const range = rangeFor('month', '2026-02-14')
    expect(range.from).toBe('2026-02-01')
    expect(range.to).toBe('2026-02-28')
  })

  it('handles a leap February', () => {
    expect(rangeFor('month', '2028-02-14').to).toBe('2028-02-29')
  })

  it('gives a Monday-to-Sunday week', () => {
    // 2026-08-16 is a Sunday.
    const range = rangeFor('week', '2026-08-16')
    expect(range.from).toBe('2026-08-10')
    expect(range.to).toBe('2026-08-16')
  })

  it('gives calendar quarters', () => {
    expect(rangeFor('quarter', '2026-05-20')).toMatchObject({
      from: '2026-04-01',
      to: '2026-06-30'
    })
    expect(rangeFor('quarter', '2026-12-01')).toMatchObject({
      from: '2026-10-01',
      to: '2026-12-31'
    })
  })

  it('uses the tax year, not the calendar year, for a year range', () => {
    const range = rangeFor('year', '2026-08-16')
    expect(range.from).toBe('2026-04-06')
    expect(range.to).toBe('2027-04-05')
  })
})

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('adds months, clamping to the shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('adds months across a leap February', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
})

/* ------------------------------------------------------------------ *
 * Jurisdictions other than the UK
 *
 * Ireland runs the calendar year and writes it as a single number. Both of
 * those were hard-coded until the boundary became data, and the `rangeFor`
 * case below is the one that was silently wrong: it called `taxYearFor` with
 * no argument, so the finance page's "year" period showed 6 April to 5 April
 * however the workspace was configured.
 * ------------------------------------------------------------------ */

const IRELAND: TaxYearRules = { start: { day: 1, month: 1 }, labelStyle: 'calendar' }

describe('a calendar tax year', () => {
  it('runs 1 January to 31 December', () => {
    const year = taxYearFor('2026-08-16', IRELAND)
    expect(year.start).toBe('2026-01-01')
    expect(year.end).toBe('2026-12-31')
  })

  it('keeps 1 January in the year that starts on it', () => {
    // The boundary case. Under UK rules this date belongs to the *previous*
    // tax year, so getting it wrong moves a January invoice by twelve months.
    expect(taxYearFor('2026-01-01', IRELAND).startYear).toBe(2026)
    expect(taxYearFor('2025-12-31', IRELAND).startYear).toBe(2025)
  })

  it('writes the label as one year rather than two', () => {
    expect(taxYearFor('2026-08-16', IRELAND).label).toBe('2026')
    expect(taxYearStarting(2026, IRELAND).label).toBe('2026')
  })

  it('leaves the UK label alone', () => {
    // The split form, with the slash the year-end pack has to strip.
    expect(taxYearStarting(2026).label).toBe('2026/27')
  })
})

describe('rangeFor honours the tax year it is given', () => {
  it('scopes a year range to the configured boundary', () => {
    /*
      The bug this parameter exists for. Before it, a calendar-year workspace
      asking for "this year" got 6 April to 5 April — the wrong twelve months
      of income, on the page people read to decide what to set aside.
    */
    const range = rangeFor('year', '2026-08-16', IRELAND)
    expect(range.from).toBe('2026-01-01')
    expect(range.to).toBe('2026-12-31')
    expect(range.label).toBe('Tax year 2026')
  })

  it('still defaults to the UK boundary', () => {
    const range = rangeFor('year', '2026-08-16')
    expect(range.from).toBe('2026-04-06')
    expect(range.label).toBe('Tax year 2026/27')
  })
})

describe('taxYearRulesFrom', () => {
  it('builds rules from the two settings columns', () => {
    // The columns have existed since the first migration and were read by
    // exactly one consumer. This is the bridge that makes them mean something.
    const rules = taxYearRulesFrom({ taxYearStartDay: 1, taxYearStartMonth: 1 }, 'calendar')
    expect(taxYearFor('2026-02-01', rules).start).toBe('2026-01-01')
  })

  it('defaults to the split label, as the UK writes it', () => {
    const rules = taxYearRulesFrom({ taxYearStartDay: 6, taxYearStartMonth: 4 })
    expect(taxYearFor('2026-08-16', rules).label).toBe('2026/27')
  })
})

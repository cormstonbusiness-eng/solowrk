import { describe, expect, it } from 'vitest'
import { addDays, addMonths, isInTaxYear, rangeFor, taxYearFor, taxYearStarting } from './taxYear'

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
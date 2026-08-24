import { describe, expect, it } from 'vitest'
import { hours, pounds, toCsv, yesNo } from './csv'

/**
 * The CSV format.
 *
 * Every failure here is silent: the file opens, it just says something other
 * than what is in the workspace. That is worse than a crash, because the
 * person who finds out is an accountant reading numbers they trust.
 */
const NAME = [{ header: 'Name', value: (row: { name: string }) => row.name }]

/** The content without the byte-order mark, for readable assertions. */
function body(csv: string): string {
  return csv.replace(/^﻿/, '')
}

describe('escaping', () => {
  it('leaves ordinary values alone', () => {
    expect(body(toCsv(NAME, [{ name: 'Acme Ltd' }]))).toBe('Name\r\nAcme Ltd\r\n')
  })

  it('quotes a value containing a comma', () => {
    // Unquoted, this is two columns and every column after it is shifted.
    expect(body(toCsv(NAME, [{ name: 'Acme, Ltd' }]))).toContain('"Acme, Ltd"')
  })

  it('doubles quotes inside a value', () => {
    expect(body(toCsv(NAME, [{ name: 'The "Big" Co' }]))).toContain('"The ""Big"" Co"')
  })

  it('quotes a value containing a newline', () => {
    // Invoice notes are a textarea, so this is not hypothetical.
    const csv = body(toCsv(NAME, [{ name: 'Line one\nLine two' }]))
    expect(csv).toContain('"Line one\nLine two"')
    // And the row count is still one row plus a header.
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2)
  })

  it('handles a carriage return as well as a newline', () => {
    expect(body(toCsv(NAME, [{ name: 'a\r\nb' }]))).toContain('"a\r\nb"')
  })

  it('writes an empty cell for null and undefined', () => {
    const columns = [
      { header: 'A', value: () => null },
      { header: 'B', value: () => undefined },
      { header: 'C', value: () => 0 }
    ]
    // Zero is a number and must survive; blank is blank.
    expect(body(toCsv(columns, [{}]))).toBe('A,B,C\r\n,,0\r\n')
  })
})

describe('what Excel does with it', () => {
  it('starts with a byte-order mark', () => {
    // Without this Excel on Windows reads the file as cp1252, and every pound
    // sign and accented name arrives as mojibake.
    expect(toCsv(NAME, [])).toMatch(/^﻿/)
  })

  it('ends every line with CRLF', () => {
    const csv = toCsv(NAME, [{ name: 'A' }, { name: 'B' }])
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(4) // header, two rows, trailing empty
  })

  it('defuses a value that would run as a formula', () => {
    for (const dangerous of ['=1+1', '+1', '@SUM(A1)', '=cmd|/c calc']) {
      expect(body(toCsv(NAME, [{ name: dangerous }]))).toContain(`'${dangerous}`)
    }
  })

  it('leaves a negative number alone', () => {
    // The reason `-` is not treated as dangerous. Prefixing this would corrupt
    // every credit note in the file to defend against something nobody does.
    expect(body(toCsv(NAME, [{ name: '-40.00' }]))).toBe('Name\r\n-40.00\r\n')
  })

  it('still escapes a formula that also contains a comma', () => {
    const csv = body(toCsv(NAME, [{ name: '=A1,B1' }]))
    expect(csv).toContain(`"'=A1,B1"`)
  })
})

describe('the number columns', () => {
  it('writes money a spreadsheet can add up', () => {
    // No symbol and no thousands separator: "£1,234.00" is text that sums to
    // zero, which is the kind of wrong that gets noticed in January.
    expect(pounds(123_456)).toBe('1234.56')
    expect(pounds(0)).toBe('0.00')
    expect(pounds(-500)).toBe('-5.00')
    expect(pounds(null)).toBe('')
  })

  it('writes time as decimal hours', () => {
    expect(hours(3600)).toBe('1.00')
    expect(hours(5400)).toBe('1.50')
    expect(hours(0)).toBe('0.00')
    expect(hours(undefined)).toBe('')
  })

  it('writes booleans for a person to read', () => {
    expect(yesNo(true)).toBe('Yes')
    expect(yesNo(false)).toBe('No')
  })
})
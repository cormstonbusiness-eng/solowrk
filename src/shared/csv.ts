/**
 * Writing CSV that survives the journey to a spreadsheet.
 *
 * Shared rather than main-only so the format is pinned by tests that need no
 * database and no Electron. Three things go wrong with hand-rolled CSV and all
 * three are silent — the file opens, it just says the wrong thing:
 *
 *  - a comma, quote or newline inside a value splits it into extra columns
 *  - Excel on Windows reads UTF-8 as cp1252 without a byte-order mark, so
 *    every pound sign and every accented client name arrives as mojibake
 *  - a value beginning with `=` is a formula, not text, and runs on open
 *
 * RFC 4180 covers the first. The other two are Excel's own behaviour and have
 * to be handled anyway, because Excel is where these files are going.
 */

export interface Column<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

/**
 * Characters that make Excel treat a cell as a formula rather than text.
 *
 * `-` is deliberately absent: a leading minus is far more often a negative
 * number than an attack, and prefixing "-40.00" would corrupt every credit in
 * the file to defend against something nobody has done.
 */
const FORMULA_START = /^[=+@\t\r]/

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''

  let text = String(value)

  // Neutralised with a leading apostrophe, which Excel strips on display and
  // which stays visible and reversible in the raw file — as opposed to
  // silently handing somebody's accountant a spreadsheet that executes.
  if (FORMULA_START.test(text)) text = `'${text}`

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A CSV document, ready to write to disk as UTF-8.
 *
 * CRLF because RFC 4180 says so and because Excel is happier with it. The
 * byte-order mark goes on at the front for the reason above; it is invisible
 * in every reader that matters and is what stops £ becoming Â£.
 */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [
    columns.map((column) => cell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => cell(column.value(row))).join(','))
  ]

  return `﻿${lines.join('\r\n')}\r\n`
}

/** Pence to a plain decimal, for a column something will sum. */
export function pounds(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return ''
  // No thousands separator and no currency symbol: this is a number for a
  // spreadsheet, and "£1,234.00" is text that sums to zero.
  return (pence / 100).toFixed(2)
}

/** Seconds to decimal hours, which is what gets billed and totalled. */
export function hours(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return ''
  return (seconds / 3600).toFixed(2)
}

/** Booleans as words rather than 0/1, because a person reads this too. */
export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}
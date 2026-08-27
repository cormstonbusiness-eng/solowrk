/**
 * Reading a receipt.
 *
 * The text arrives from Windows' own OCR, which is offline and free and never
 * sends anything anywhere — the whole reason to use it rather than a service.
 * What arrives is a smudged, out-of-order approximation of a crumpled piece of
 * paper, and this turns that into three guesses: what it cost, when, and who
 * from.
 *
 * **Guesses, and presented as guesses.** Nothing here writes an expense. It
 * fills a form somebody then looks at, because OCR reads £11.90 as £1190 often
 * enough that silently trusting it would put a wrong number in somebody's tax
 * return — and a wrong number nobody was asked about is far worse than an
 * empty field.
 */

export interface ReceiptReading {
  /** Integer pence, or null when nothing looked like a total. */
  total: number | null
  /** Integer pence of VAT, when the receipt breaks it out. */
  vat: number | null
  /** `yyyy-mm-dd`, or null. */
  date: string | null
  /** The shop, as best anybody can tell. */
  vendor: string | null
  /** How much of the above to believe, roughly. */
  confidence: 'good' | 'partial' | 'poor'
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/** `12.34`, `£12.34`, `1,234.56`, and the OCR-mangled `12,34`. */
const AMOUNT = /(?:£|GBP)?\s?(\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2}|\d+)/gi

function toPence(raw: string): number | null {
  // Thousands separators out, then the decimal comma some receipts print.
  const cleaned = raw.replace(/[\s,](?=\d{3}\b)/g, '').replace(',', '.')
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

function amountsIn(line: string): number[] {
  const found: number[] = []
  for (const match of line.matchAll(AMOUNT)) {
    const pence = toPence(match[1] ?? '')
    if (pence !== null && pence > 0 && pence < IMPLAUSIBLE_PENCE) found.push(pence)
  }
  return found
}

/**
 * Lines that name the figure we want, and lines that name one we do not.
 *
 * Order matters: "total" appears inside "subtotal", so the exclusions are
 * checked first. A receipt whose subtotal was read as the total understates
 * the expense by exactly the VAT, which is the kind of error that survives
 * a whole year unnoticed.
 */
const NOT_TOTAL = /sub[\s-]?total|vat|tax|change|cash|card|tender|balance|saving/i
const IS_TOTAL = /total|amount\s+due|to\s+pay|due/i
const IS_VAT = /\bvat\b|\bv\.a\.t\b/i

/**
 * A VAT *registration number* is not a VAT *amount*.
 *
 * Every UK receipt carries one, it sits on a line saying "VAT", and it is
 * nine digits — so read as money it becomes a couple of million pounds of
 * tax on a cup of coffee. Checked before the VAT line is read at all.
 */
const VAT_REGISTRATION = /vat\s*(?:no|number|reg|registration)\b/i

/**
 * Nobody expenses this much on one receipt. A figure this large is a phone
 * number, a registration or a barcode that OCR found printed on the paper.
 */
const IMPLAUSIBLE_PENCE = 10_000_000

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
}

const NUMERIC_DATE = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/
const NAMED_DATE = /\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s+(\d{2,4})\b/i
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/

function fourDigitYear(year: number): number {
  // A two-digit year on a receipt is this century. 26 is 2026, not 1926.
  return year < 100 ? 2000 + year : year
}

function asDay(year: number, month: number, date: number): string | null {
  if (month < 1 || month > 12 || date < 1 || date > 31) return null
  // A real calendar check, so 31 February is rejected rather than stored.
  const at = new Date(Date.UTC(year, month - 1, date))
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== date) return null
  return at.toISOString().slice(0, 10)
}

/**
 * The date on a receipt, read the British way.
 *
 * `03/04/2026` is the third of April, not the fourth of March. This is a UK
 * app and the ambiguity is unresolvable from the digits alone — so it is
 * resolved by convention and said out loud here, rather than left as a
 * surprise for whoever files the wrong quarter. Where the first number is
 * over twelve it settles itself.
 */
export function readDate(text: string): string | null {
  const iso = ISO_DATE.exec(text)
  if (iso) return asDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const named = NAMED_DATE.exec(text)
  if (named) {
    const month = MONTHS[(named[2] ?? '').toLowerCase().slice(0, 4)] ?? MONTHS[(named[2] ?? '').toLowerCase().slice(0, 3)]
    if (month) return asDay(fourDigitYear(Number(named[3])), month, Number(named[1]))
  }

  const numeric = NUMERIC_DATE.exec(text)
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    const year = fourDigitYear(Number(numeric[3]))
    // Day first unless that is impossible.
    return first > 12 && second <= 12
      ? asDay(year, second, first)
      : (asDay(year, second, first) ?? asDay(year, first, second))
  }

  return null
}

/* ------------------------------------------------------------------ *
 * Vendor
 * ------------------------------------------------------------------ */

/** Lines that are never a shop name, however near the top they sit. */
const NOISE =
  /^\s*$|receipt|invoice|vat\s*(no|reg)|tel[:\s]|www\.|http|thank\s*you|customer\s+copy|^\d[\d\s/.\-]*$|^[^a-z]*$/i

/**
 * The shop, which is almost always the first line that reads like a name.
 *
 * "Almost always" is doing real work: receipts also start with a logo that
 * OCRs as nothing, an address, or a phone number. So it is the first line
 * that survives the noise filter and has some letters in it.
 */
export function readVendor(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim()
    if (trimmed.length < 3 || trimmed.length > 40) continue
    if (NOISE.test(trimmed)) continue
    if (!/[a-z]{3}/i.test(trimmed)) continue
    // Receipts shout. Title case reads better in a form somebody is checking.
    return trimmed === trimmed.toUpperCase() ? titleCase(trimmed) : trimmed
  }
  return null
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    // Keep the ones that are genuinely initialisms.
    .replace(/\bLtd\b/g, 'Ltd')
}

/* ------------------------------------------------------------------ *
 * The whole thing
 * ------------------------------------------------------------------ */

export function readReceipt(text: string): ReceiptReading {
  const lines = text.split(/\r?\n/).map((line) => line.trim())

  let total: number | null = null
  let vat: number | null = null

  for (const line of lines) {
    // The registration number first, or it is read as an amount of tax.
    if (VAT_REGISTRATION.test(line)) continue
    if (IS_VAT.test(line) && !IS_TOTAL.test(line)) {
      vat = vat ?? amountsIn(line).at(-1) ?? null
      continue
    }
    if (NOT_TOTAL.test(line)) continue
    if (!IS_TOTAL.test(line)) continue
    // The last figure on the line: "TOTAL 3 items £24.50" ends with the money.
    const candidate = amountsIn(line).at(-1)
    if (candidate !== undefined) total = Math.max(total ?? 0, candidate)
  }

  // Nothing said "total". Fall back to the largest amount anywhere, which on a
  // receipt is very nearly always what was paid.
  if (total === null) {
    const everything = lines.flatMap(amountsIn)
    total = everything.length > 0 ? Math.max(...everything) : null
  }

  const date = readDate(text)
  const vendor = readVendor(lines)

  const found = [total, date, vendor].filter((one) => one !== null).length
  return {
    total,
    vat,
    date,
    vendor,
    confidence: found === 3 ? 'good' : found >= 2 ? 'partial' : 'poor'
  }
}

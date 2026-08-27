/**
 * Reading a bank statement.
 *
 * A CSV the user downloaded themselves — no open-banking connection, no
 * credentials, nothing that phones anybody. The trade is that every UK bank
 * exports a different shape, so this reads by *recognising* columns rather
 * than by knowing banks: a table of header synonyms, a delimiter sniff, and a
 * few date and money formats. A bank nobody has heard of works if it labels
 * its columns like a bank, and one that does not can be mapped by hand.
 *
 * **Nothing here decides anything.** It turns a file into rows. What those
 * rows mean — which invoice was paid, what an expense was for — is decided in
 * `bankMatch`, and confirmed by a person, because a statement line that
 * silently marks an invoice paid is a mistake that stops the chasing and
 * misstates the income at the same time.
 */

export interface BankRow {
  /** `yyyy-mm-dd`. */
  date: string
  /** Whatever the bank calls the other party. */
  description: string
  /** A payment reference, when the bank breaks it out separately. */
  reference: string
  /** Signed integer pence. Negative is money leaving. */
  amount: number
  /**
   * A stable identity for this line, so importing the same file twice does
   * not create it twice. Deliberately built from what a bank cannot change
   * between two downloads of the same statement — not from row position,
   * which moves the moment the export range does.
   */
  fingerprint: string
}

export interface BankReading {
  rows: BankRow[]
  /** Header names as they appeared, so the UI can show what was recognised. */
  columns: { date: string; description: string; amount: string }
  /** Lines that could not be read, with why. Never silently dropped. */
  skipped: { line: number; reason: string }[]
}

export class BankCsvError extends Error {}

/* ------------------------------------------------------------------ *
 * Splitting the file
 * ------------------------------------------------------------------ */

/**
 * Split one CSV line, honouring quotes.
 *
 * Written out rather than split on the delimiter because a payee is very often
 * `"SMITH, J"` and splitting naively shunts every later column one to the left
 * — which lands a balance in the amount column and reads as a payment of
 * several thousand pounds.
 */
export function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!

    if (quoted) {
      if (character === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"') quoted = true
    else if (character === delimiter) {
      fields.push(field)
      field = ''
    } else field += character
  }

  fields.push(field)
  return fields.map((one) => one.trim())
}

/** Comma unless something else is plainly more common. */
function sniffDelimiter(lines: string[]): string {
  const candidates = [',', ';', '\t']
  let best = ','
  let bestCount = 0

  for (const candidate of candidates) {
    // Counted across several lines: a single line can be misleading, and a
    // description full of semicolons should not win the vote on its own.
    const count = lines
      .slice(0, 10)
      .reduce((sum, line) => sum + splitLine(line, candidate).length, 0)
    if (count > bestCount) {
      bestCount = count
      best = candidate
    }
  }

  return best
}

/* ------------------------------------------------------------------ *
 * Recognising the columns
 * ------------------------------------------------------------------ */

const DATE_HEADERS = /^(transaction\s*)?date|date\s*(of|posted)|posting\s*date|completed\s*date$/i
const DESCRIPTION_HEADERS =
  /descript|narrative|details|payee|counter\s*party|merchant|name|transaction\s*type|memo/i
const REFERENCE_HEADERS = /reference|ref\b|notes?$/i

/** One signed column. */
const AMOUNT_HEADERS = /^(amount|value|transaction\s*amount|paid\s*(in|out)\s*\/|net)$/i

/** The two-column shape, which is at least as common in the UK. */
const IN_HEADERS = /paid\s*in|money\s*in|credit(?!\s*card)|receipts?$/i
const OUT_HEADERS = /paid\s*out|money\s*out|debit|withdrawal|payments?$/i

/**
 * Never the amount, whatever else it looks like.
 *
 * `Balance` is the trap: it is numeric, it sits next to the amount, and taking
 * it instead turns every line into a transaction for the size of the account.
 */
const NEVER_AMOUNT = /balance|running|total/i

function findColumn(headers: string[], pattern: RegExp, exclude?: RegExp): number {
  return headers.findIndex(
    (header) => pattern.test(header) && !(exclude && exclude.test(header))
  )
}

/* ------------------------------------------------------------------ *
 * Dates and money
 * ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function realDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const at = new Date(Date.UTC(year, month - 1, day))
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * A statement date, read the British way.
 *
 * `03/04/2026` is the third of April. Unresolvable from the digits, so settled
 * by convention and said out loud — a bank statement misread as American puts
 * a payment in the wrong month for nine days of every twelve.
 */
export function parseBankDate(value: string): string | null {
  const text = value.trim()
  if (text === '') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const named = /^(\d{1,2})[\s-]([a-z]{3,9})[\s-](\d{2,4})/i.exec(text)
  if (named) {
    const month = MONTHS[named[2]!.toLowerCase().slice(0, 3)]
    if (month) {
      const year = Number(named[3])
      return realDate(year < 100 ? 2000 + year : year, month, Number(named[1]))
    }
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text)
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    const rawYear = Number(numeric[3])
    const year = rawYear < 100 ? 2000 + rawYear : rawYear
    // Day first unless that is impossible.
    return first > 12 && second <= 12
      ? realDate(year, second, first)
      : (realDate(year, second, first) ?? realDate(year, first, second))
  }

  return null
}

/**
 * Money off a statement, as integer pence.
 *
 * Handles the four ways a negative arrives: a minus sign, brackets, a trailing
 * `DR`, and a bank that puts everything positive in two separate columns —
 * that last one is handled by the caller, which knows which column it read.
 */
export function parseBankAmount(value: string): number | null {
  let text = value.trim()
  if (text === '') return null

  let negative = false

  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (/\bdr$/i.test(text)) {
    negative = true
    text = text.replace(/\bdr$/i, '')
  }
  text = text.replace(/\bcr$/i, '')

  text = text.replace(/[£$€\s]/g, '')

  /**
   * A comma is a thousands separator or a decimal point, and getting it wrong
   * is a hundred-fold error in somebody's accounts.
   *
   * When both separators appear, the **last one is the decimal point** —
   * `1,500.00` and `1.500,00` are the same amount written two ways, and each
   * makes the other's separator the thousands mark. When only a comma appears,
   * it is a decimal point if one or two digits follow it and nothing else
   * (`1500,00`), and a thousands separator otherwise (`1,500`).
   */
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')

  if (lastDot !== -1 && lastComma !== -1) {
    text =
      lastComma > lastDot
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '')
  } else if (lastComma !== -1) {
    text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '')
  }

  if (text.startsWith('-')) {
    negative = true
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }

  if (text === '' || !/^\d+(\.\d+)?$/.test(text)) return null

  const pence = Math.round(Number(text) * 100)
  return negative ? -pence : pence
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * A stable id for a statement line.
 *
 * Date, amount and a normalised description. Not the row number, which changes
 * with the export range, and not a running balance, which changes if anything
 * before it is amended. Two genuinely identical payments on one day — a pair
 * of £4.50 coffees — collide, which is why the row's ordinal within its own
 * day is folded in as a tiebreaker by the caller.
 */
export function fingerprintFor(
  date: string,
  amount: number,
  description: string,
  ordinal: number
): string {
  const normalised = description.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
  return `${date}|${amount}|${normalised}|${ordinal}`
}

/* ------------------------------------------------------------------ *
 * The whole file
 * ------------------------------------------------------------------ */

/** How far down the file to look for a header row before giving up. */
const HEADER_SEARCH_LINES = 15

export function parseBankCsv(text: string): BankReading {
  const lines = text
    .split(/\r?\n/)
    // Blank lines are common at the top and bottom of a bank export.
    .filter((line) => line.trim() !== '')

  if (lines.length === 0) throw new BankCsvError('That file is empty.')

  const delimiter = sniffDelimiter(lines)

  // Banks put a title, an account number and a date range above the header,
  // so the header is found rather than assumed to be line one.
  let headerIndex = -1
  let headers: string[] = []

  for (let index = 0; index < Math.min(HEADER_SEARCH_LINES, lines.length); index += 1) {
    const candidate = splitLine(lines[index]!, delimiter)
    if (
      findColumn(candidate, DATE_HEADERS) !== -1 &&
      (findColumn(candidate, AMOUNT_HEADERS, NEVER_AMOUNT) !== -1 ||
        findColumn(candidate, IN_HEADERS, NEVER_AMOUNT) !== -1 ||
        findColumn(candidate, OUT_HEADERS, NEVER_AMOUNT) !== -1)
    ) {
      headerIndex = index
      headers = candidate
      break
    }
  }

  if (headerIndex === -1) {
    throw new BankCsvError(
      'That does not look like a bank statement. It needs a header row with a date column and an amount column.'
    )
  }

  const dateAt = findColumn(headers, DATE_HEADERS)
  const referenceAt = findColumn(headers, REFERENCE_HEADERS)
  const amountAt = findColumn(headers, AMOUNT_HEADERS, NEVER_AMOUNT)
  const inAt = findColumn(headers, IN_HEADERS, NEVER_AMOUNT)
  const outAt = findColumn(headers, OUT_HEADERS, NEVER_AMOUNT)

  // The description column is searched last and must not steal a column
  // already spoken for — "Transaction Type" matches both, and several banks
  // label the reference column "Notes".
  const claimed = new Set([dateAt, referenceAt, amountAt, inAt, outAt].filter((one) => one !== -1))
  const descriptionAt = headers.findIndex(
    (header, index) => !claimed.has(index) && DESCRIPTION_HEADERS.test(header)
  )

  const rows: BankRow[] = []
  const skipped: { line: number; reason: string }[] = []
  const perDay = new Map<string, number>()

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const fields = splitLine(lines[index]!, delimiter)
    const lineNumber = index + 1

    const date = parseBankDate(fields[dateAt] ?? '')
    if (!date) {
      // Statement footers ("End of statement", a closing balance) land here,
      // and are reported rather than dropped so a real misread is visible.
      skipped.push({ line: lineNumber, reason: 'No date on this line' })
      continue
    }

    let amount: number | null = null

    if (amountAt !== -1) {
      amount = parseBankAmount(fields[amountAt] ?? '')
    } else {
      const paidIn = inAt === -1 ? null : parseBankAmount(fields[inAt] ?? '')
      const paidOut = outAt === -1 ? null : parseBankAmount(fields[outAt] ?? '')
      // A two-column statement puts both as positive numbers, so the sign
      // comes from which column the figure was in, not from the figure.
      if (paidIn !== null && paidIn !== 0) amount = Math.abs(paidIn)
      else if (paidOut !== null && paidOut !== 0) amount = -Math.abs(paidOut)
    }

    if (amount === null || amount === 0) {
      skipped.push({ line: lineNumber, reason: 'No amount on this line' })
      continue
    }

    const description = (descriptionAt === -1 ? '' : (fields[descriptionAt] ?? '')).trim()
    const reference = (referenceAt === -1 ? '' : (fields[referenceAt] ?? '')).trim()

    const ordinal = (perDay.get(date) ?? 0) + 1
    perDay.set(date, ordinal)

    rows.push({
      date,
      description,
      reference,
      amount,
      fingerprint: fingerprintFor(date, amount, `${description} ${reference}`, ordinal)
    })
  }

  if (rows.length === 0) {
    throw new BankCsvError('No transactions could be read out of that file.')
  }

  return {
    rows,
    columns: {
      date: headers[dateAt] ?? '',
      description: descriptionAt === -1 ? '(none)' : (headers[descriptionAt] ?? ''),
      amount:
        amountAt !== -1
          ? (headers[amountAt] ?? '')
          : [inAt, outAt]
              .filter((one) => one !== -1)
              .map((one) => headers[one])
              .join(' / ')
    },
    skipped
  }
}

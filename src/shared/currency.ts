/**
 * Currency and locale formatting. The one place a number becomes money.
 *
 * Before this file existed, `£` and `'en-GB'` were re-implemented in nineteen
 * separate formatters across main, renderer and shared. Each was individually
 * reasonable and collectively they meant the app could only ever be British:
 * there was no single place to change, and a nineteen-way change is one nobody
 * makes. Everything that renders an amount now comes through here.
 *
 * Amounts arrive as integer minor units — pence, cents — and only become a
 * decimal at the moment they are printed. That rule is enforced upstream by
 * `@shared/money`; this file is where it is finally allowed to be broken, and
 * the division lives in exactly one function so a zero-decimal currency like
 * the yen is a table entry rather than an audit.
 */

/** Home currency before anything has said otherwise. */
export const DEFAULT_CURRENCY = 'GBP'

export interface CurrencyInfo {
  /** ISO 4217, as stored on the workspace and on documents. */
  code: string
  /**
   * How many digits the minor unit has. Two for sterling and the euro, zero
   * for the yen, three for the dinar.
   *
   * This is the number that makes a stored integer meaningful, so it is data
   * rather than the hard-coded 100 it replaces.
   */
  minorUnits: number
  /** The locale whose conventions suit this currency's home country. */
  locale: string
}

/**
 * The currencies the app can format.
 *
 * Deliberately a short list rather than every ISO code: an entry here is a
 * claim that amounts in this currency render correctly, and the list grows as
 * country packs are added. `currencyInfo` falls back rather than throwing, so
 * an unknown code still produces something readable.
 */
export const CURRENCIES: Record<string, CurrencyInfo> = {
  GBP: { code: 'GBP', minorUnits: 2, locale: 'en-GB' },
  EUR: { code: 'EUR', minorUnits: 2, locale: 'en-IE' },
  USD: { code: 'USD', minorUnits: 2, locale: 'en-US' },
  CAD: { code: 'CAD', minorUnits: 2, locale: 'en-CA' },
  AUD: { code: 'AUD', minorUnits: 2, locale: 'en-AU' },
  NZD: { code: 'NZD', minorUnits: 2, locale: 'en-NZ' }
}

/**
 * The currency's details, falling back to a two-decimal shape.
 *
 * Never throws. A workspace can carry a currency code this build has never
 * heard of — an older app opening a newer workspace, or a code typed by hand —
 * and the right answer there is an amount that reads a little plainly, not a
 * crash on the finance page.
 */
export function currencyInfo(code: string | null | undefined): CurrencyInfo {
  if (!code) return CURRENCIES[DEFAULT_CURRENCY]!
  return CURRENCIES[code] ?? { code, minorUnits: 2, locale: 'en-GB' }
}

/** What to divide a stored integer by to get a decimal amount. */
function divisorFor(info: CurrencyInfo): number {
  return 10 ** info.minorUnits
}

/**
 * Formatters are expensive to construct and these are called inside render
 * loops and table bodies, so they are built once per shape and kept.
 */
const cache = new Map<string, Intl.NumberFormat>()

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  const found = cache.get(key)
  if (found) return found

  const made = new Intl.NumberFormat(locale, options)
  cache.set(key, made)
  return made
}

export interface MoneyOptions {
  /**
   * Show the minor unit. Off by default because most of the app shows figures
   * at a glance, where `£1,240` reads faster than `£1,240.00`, and on because
   * an invoice total that hides its pennies is wrong.
   */
  pennies?: boolean
  /**
   * Override the locale. Defaults to the currency's own, which is what makes a
   * euro amount render as a euro amount without every caller knowing that.
   */
  locale?: string
  /** What to render when there is no amount at all. */
  blank?: string
}

/**
 * An amount in minor units, as money.
 *
 * `Intl.NumberFormat` places the symbol, the separators and the sign according
 * to the locale, which is the whole reason to use it over concatenating a
 * symbol: several locales put the symbol after the number, and every locale
 * disagrees about where a minus sign goes. Doing that by hand is how you end
 * up with `£-1,500`.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  options: MoneyOptions = {}
): string {
  if (amount === null || amount === undefined) return options.blank ?? '—'

  const info = currencyInfo(currency)
  const digits = options.pennies ? info.minorUnits : 0

  return numberFormat(options.locale ?? info.locale, {
    style: 'currency',
    currency: info.code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(amount / divisorFor(info))
}

/**
 * An hourly rate.
 *
 * Pennies appear only when there are any, because `£50/hr` is the common case
 * and `£50.00/hr` is noise — but `£62.50/hr` must not round to `£63/hr`.
 */
export function formatRate(
  amount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  options: MoneyOptions = {}
): string {
  if (amount === null || amount === undefined) return options.blank ?? '—'

  const info = currencyInfo(currency)
  const pennies = amount % divisorFor(info) !== 0

  return `${formatMoney(amount, currency, { ...options, pennies })}/hr`
}

/**
 * The currency's symbol on its own, for a label or an input's prefix.
 *
 * Read out of `Intl` rather than stored in the table so there is one source of
 * truth for it, and so a currency whose symbol differs by locale gets the
 * right one.
 */
export function moneySymbol(currency: string = DEFAULT_CURRENCY, locale?: string): string {
  const info = currencyInfo(currency)

  const parts = numberFormat(locale ?? info.locale, {
    style: 'currency',
    currency: info.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).formatToParts(0)

  return parts.find((part) => part.type === 'currency')?.value ?? info.code
}

/**
 * Whether the symbol leads the number in this locale.
 *
 * `MoneyInput` needs to know which side to put its prefix on, and there is no
 * other honest way to ask.
 */
export function symbolLeads(currency: string = DEFAULT_CURRENCY, locale?: string): boolean {
  const info = currencyInfo(currency)

  const parts = numberFormat(locale ?? info.locale, {
    style: 'currency',
    currency: info.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).formatToParts(1)

  return parts.findIndex((p) => p.type === 'currency') < parts.findIndex((p) => p.type === 'integer')
}

/**
 * A plain number, grouped for the locale.
 *
 * For counts and word tallies, which want thousands separators but are not
 * money and must not acquire a currency symbol.
 */
export function formatNumber(value: number, locale = 'en-GB'): string {
  return numberFormat(locale, {}).format(value)
}

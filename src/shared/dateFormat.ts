/**
 * Locale date formatting. The companion to `@shared/currency`, and the reason
 * `'en-GB'` no longer appears forty times across the app.
 *
 * Arithmetic on dates lives in `@shared/taxYear` and stays there: this file
 * only turns a stored date into something a person reads.
 *
 * **Every function here pins UTC, and that is load-bearing.** Dates are stored
 * as bare `yyyy-mm-dd` with no time and no zone. Handing `'2026-04-06'` to a
 * formatter without a zone makes it midnight *local*, and anywhere west of
 * Greenwich that renders as the fifth of April — which, for a date that decides
 * which tax year an invoice falls in, is a wrong number on a tax return rather
 * than a cosmetic slip. Pinning UTC makes the displayed day always the stored
 * day.
 */

/**
 * The locale before a country pack has said otherwise.
 *
 * Sterling and British date order were the only options the app had until
 * now, so this is what every caller's default parameter resolves to and why
 * none of this changes what an existing workspace prints.
 */
export const DEFAULT_LOCALE = 'en-GB'

/** Formatters are expensive to build and these run inside table bodies. */
const cache = new Map<string, Intl.DateTimeFormat>()

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  const found = cache.get(key)
  if (found) return found

  const made = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
  cache.set(key, made)
  return made
}

/**
 * A `yyyy-mm-dd` string as a UTC instant.
 *
 * Tolerates a full timestamp by keeping only the date part, because several
 * callers hold an ISO stamp rather than a plain date and the day is all that
 * is being asked for.
 */
function instant(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
}

/** `1 April 2026`. Invoices, contracts, emails — anything a client reads. */
export function formatDateLong(iso: string | null | undefined, locale = 'en-GB'): string {
  if (!iso) return '—'
  return dateFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(instant(iso))
}

/** `1 Apr 2026`. Tables and lists inside the app. */
export function formatDateShort(iso: string | null | undefined, locale = 'en-GB'): string {
  if (!iso) return '—'
  return dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(instant(iso))
}

/** `Apr`. Chart axes, where the year is established by the axis itself. */
export function formatMonthShort(iso: string, locale = 'en-GB'): string {
  return dateFormat(locale, { month: 'short' }).format(instant(iso))
}

/** `April 2026`. Period switchers and month headings. */
export function formatMonthLong(iso: string, locale = 'en-GB'): string {
  return dateFormat(locale, { month: 'long', year: 'numeric' }).format(instant(iso))
}

/** `Mon` or `Monday`, for calendar column headings. */
export function formatWeekday(
  iso: string,
  locale = 'en-GB',
  style: 'short' | 'long' | 'narrow' = 'short'
): string {
  return dateFormat(locale, { weekday: style }).format(instant(iso))
}

/**
 * A date formatted by an arbitrary set of options.
 *
 * The escape hatch for the handful of callers that want something none of the
 * named helpers cover. Still UTC-pinned, which is the whole point of routing
 * through here rather than calling `Intl` directly.
 */
export function formatDateWith(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  return dateFormat(locale, options).format(instant(iso))
}

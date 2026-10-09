/**
 * Renderer formatting helpers.
 *
 * The money and date functions are thin wrappers over `@shared/currency` and
 * `@shared/dateFormat`, which main and shared use too — one implementation, so
 * a figure on screen and the same figure on the invoice PDF cannot disagree.
 *
 * Currency and locale are optional parameters rather than required ones so that
 * the several hundred existing call sites keep working unchanged. They resolve
 * to sterling and `en-GB`, which is what the app printed before country packs
 * existed.
 */

import { DEFAULT_CURRENCY, formatMoney as money, formatNumber, formatRate as rate } from '@shared/currency'
import { DEFAULT_LOCALE, formatDateShort } from '@shared/dateFormat'

/** Re-exported so a page needs one import to render a figure of any kind. */
export { formatNumber }

export function formatMoney(
  pence: number | null,
  options: { pennies?: boolean; currency?: string } = {}
): string {
  return money(pence, options.currency ?? DEFAULT_CURRENCY, { pennies: options.pennies })
}

export function formatRate(pence: number | null, currency: string = DEFAULT_CURRENCY): string {
  return rate(pence, currency)
}

/**
 * A stored date, short form.
 *
 * Now UTC-pinned, via `@shared/dateFormat`. It was not before, which meant a
 * bare `yyyy-mm-dd` became midnight UTC and rendered a day early anywhere west
 * of Greenwich. Identical output in the UK, correct everywhere else.
 */
export function formatDate(iso: string | null, locale = DEFAULT_LOCALE): string {
  return formatDateShort(iso, locale)
}

/**
 * When something happened, from a SQLite timestamp.
 *
 * `datetime('now')` writes UTC with no zone marker — '2026-08-25 09:12:00' —
 * and passing that straight to `new Date()` makes most engines read it as
 * *local* time. On a British summer afternoon that is an hour out, and every
 * entry in a timeline would say it happened an hour before it did. So the
 * space becomes a T and a Z is appended before parsing.
 *
 * Recent times are relative, because "12 minutes ago" is what a person wants
 * from a timeline; anything older than a week gets a date, because "23 days
 * ago" is not.
 */
export function formatWhen(stamp: string): string {
  const at = new Date(`${stamp.replace(' ', 'T')}Z`)
  if (Number.isNaN(at.getTime())) return stamp

  const seconds = Math.round((Date.now() - at.getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  if (seconds < 604_800) {
    const days = Math.floor(seconds / 86_400)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  return formatDateShort(at.toISOString())
}

/** Midnight today, as the reference point for "overdue". */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function daysUntil(iso: string): number {
  const due = new Date(iso)
  const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  return Math.round((dueMidnight.getTime() - startOfToday().getTime()) / 86_400_000)
}

export function isOverdue(iso: string | null): boolean {
  return iso !== null && daysUntil(iso) < 0
}

/**
 * Human phrasing for a due date. Deliberately blunt about lateness — "3 days
 * late" is more useful to a freelancer than "13 August".
 */
export function describeDue(iso: string | null): { label: string; tone: 'danger' | 'warning' | 'muted' } {
  if (!iso) return { label: '', tone: 'muted' }

  const days = daysUntil(iso)
  if (days < -1) return { label: `${Math.abs(days)} days late`, tone: 'danger' }
  if (days === -1) return { label: 'Yesterday', tone: 'danger' }
  if (days === 0) return { label: 'Today', tone: 'warning' }
  if (days === 1) return { label: 'Tomorrow', tone: 'warning' }
  if (days <= 7) return { label: `In ${days} days`, tone: 'muted' }
  return { label: formatDate(iso), tone: 'muted' }
}

/** Running-clock display for a live timer: 01:23:45. */
export function formatElapsed(seconds: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(pad)
    .join(':')
}

/** Settled duration for a logged entry: "3h 25m". */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** `yyyy-mm-dd` for date inputs, which reject full ISO timestamps. */
export function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

/**
 * A file size, in the largest unit that leaves a number worth reading.
 *
 * Zero is an em dash rather than "0 B", because an empty file is a fact about
 * the file and "0 B" reads as a failed measurement.
 *
 * 1024 rather than 1000: this reports what Explorer reports, and a size that
 * disagreed with the one beside it in the same folder would be the wrong kind
 * of correct.
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`
}

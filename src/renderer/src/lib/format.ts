/** Formatting helpers. Money arrives as integer pence and only becomes pounds here. */

export function formatMoney(pence: number | null, options: { pennies?: boolean } = {}): string {
  if (pence === null) return '—'
  const pounds = pence / 100
  return `£${pounds.toLocaleString('en-GB', {
    minimumFractionDigits: options.pennies ? 2 : 0,
    maximumFractionDigits: options.pennies ? 2 : 0
  })}`
}

export function formatRate(pence: number | null): string {
  return pence === null ? '—' : `${formatMoney(pence, { pennies: pence % 100 !== 0 })}/hr`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
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

  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
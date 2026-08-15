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

/** `yyyy-mm-dd` for date inputs, which reject full ISO timestamps. */
export function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}
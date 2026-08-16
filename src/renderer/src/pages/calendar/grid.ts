/** Shared geometry and labels for the calendar views. */

/** Pixels per hour in the week and day time grids. */
export const HOUR_HEIGHT = 46
export const PX_PER_MINUTE = HOUR_HEIGHT / 60

/** Where the grid scrolls to on open — nobody starts their day at midnight. */
export const DEFAULT_SCROLL_HOUR = 8

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

export function monthLabel(day: string): string {
  const [year, month] = day.split('-').map(Number) as [number, number]
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric'
  })
}

export function dayLabel(day: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date).toLocaleDateString('en-GB', options)
}

/** "Mon 16" for a week column header. */
export function columnLabel(day: string): { weekday: string; date: string } {
  return {
    weekday: dayLabel(day, { weekday: 'short' }),
    date: String(Number(day.slice(8)))
  }
}
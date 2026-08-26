/** Shared geometry and labels for the calendar views. */

/**
 * Pixels per hour, as the user can set it.
 *
 * Four steps rather than a slider: the useful range is "a whole day at once"
 * to "a fifteen-minute gap is a real target", and a continuous control would
 * only invite fiddling with a number nobody has an opinion about. 56 is the
 * default because a 30-minute meeting is then 28px, which is enough for a
 * title and a time.
 */
export const ZOOM_LEVELS = [40, 56, 72, 96] as const

export const DEFAULT_HOUR_HEIGHT = 56

/** The nearest zoom step to whatever is stored, so an odd value still works. */
export function nearestZoom(hourHeight: number): number {
  return ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - hourHeight) < Math.abs(best - hourHeight) ? level : best
  )
}

/** One step in or out, stopping at the ends rather than wrapping. */
export function stepZoom(hourHeight: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.indexOf(nearestZoom(hourHeight) as (typeof ZOOM_LEVELS)[number])
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction))]!
}

export function pxPerMinute(hourHeight: number): number {
  return hourHeight / 60
}

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

/**
 * "3h 30m", or "45m" — how much of a day is spoken for.
 *
 * Never "3.5h". Nobody books three and a half hours; they book until half
 * past, and decimal hours are a unit for timesheets rather than for a day.
 */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

/**
 * How much a block shows, from how tall it is.
 *
 * A fifteen-minute block at the smallest zoom is ten pixels high. Trying to
 * fit a title, a time and a project into that produces three unreadable lines
 * rather than one readable one, so each step down drops something.
 */
export type BlockDetail = 'full' | 'time' | 'title' | 'inline'

export function detailFor(height: number): BlockDetail {
  if (height >= 72) return 'full'
  if (height >= 44) return 'time'
  if (height >= 24) return 'title'
  return 'inline'
}
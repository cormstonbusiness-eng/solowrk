/**
 * Calendar arithmetic and the day-view overlap layout.
 *
 * Times are **local wall-clock stamps**: `yyyy-mm-ddThh:mm`, with no timezone
 * and no seconds. This is deliberate, and it is the same reasoning as
 * `taxYear.ts` — a meeting at 10:00 is at 10:00. Storing UTC would mean an
 * appointment booked in August silently moving an hour when the clocks change
 * in October, and it would make every range query a conversion instead of a
 * string comparison.
 *
 * The trade lands in phase 8: syncing with Google and Microsoft, which both
 * speak UTC, converts at that boundary and nowhere else.
 */

export const MINUTES_PER_DAY = 1440

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `yyyy-mm-dd` for a Date, read in local time. */
export function dayFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `yyyy-mm-ddThh:mm` for a Date, read in local time. */
export function stampFromDate(date: Date): string {
  return `${dayFromDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function nowStamp(): string {
  return stampFromDate(new Date())
}

/** The date half of a stamp. Also accepts a bare `yyyy-mm-dd`. */
export function dayOf(stamp: string): string {
  return stamp.slice(0, 10)
}

/** Minutes since midnight. A bare date counts as midnight. */
export function minutesOf(stamp: string): number {
  const time = stamp.slice(11, 16)
  if (time.length < 5) return 0
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** Build a stamp from a day and minutes-since-midnight, rolling over days. */
export function stampAt(day: string, minutes: number): string {
  const days = Math.floor(minutes / MINUTES_PER_DAY)
  const within = minutes - days * MINUTES_PER_DAY
  return `${addDays(day, days)}T${pad(Math.floor(within / 60))}:${pad(within % 60)}`
}

/** `hh:mm` for display. */
export function timeOf(stamp: string): string {
  return stamp.slice(11, 16)
}

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return dayFromDate(new Date(year, month - 1, date + days))
}

export function addMinutes(stamp: string, minutes: number): string {
  return stampAt(dayOf(stamp), minutesOf(stamp) + minutes)
}

/** Whole days between two dates — `to` minus `from`, so later is positive. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  // Midday avoids a DST transition making the difference 23 or 25 hours.
  const a = new Date(fy, fm - 1, fd, 12).getTime()
  const b = new Date(ty, tm - 1, td, 12).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** Minutes from `from` to `to`, across day boundaries. */
export function minutesBetween(from: string, to: string): number {
  return daysBetween(dayOf(from), dayOf(to)) * MINUTES_PER_DAY + minutesOf(to) - minutesOf(from)
}

/** Monday of the week containing `day`. Weeks are Monday-based, as a working week. */
export function startOfWeek(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const offset = (new Date(year, month - 1, date).getDay() + 6) % 7
  return addDays(day, -offset)
}

/** The seven days of the week containing `day`. */
export function weekDays(day: string): string[] {
  const monday = startOfWeek(day)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/** Add months to a day, clamping to the end of shorter months. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const lastDay = new Date(year, month - 1 + months + 1, 0).getDate()
  return dayFromDate(new Date(year, month - 1 + months, Math.min(date, lastDay)))
}

/**
 * The six-week grid a month view draws: always 42 days, always starting on a
 * Monday, with the leading and trailing days belonging to the neighbouring
 * months. Fixed at six rows on purpose — a grid that changes height between
 * months makes the whole page jump as you page through it.
 */
export function monthGrid(day: string): string[] {
  const first = startOfWeek(startOfMonth(day))
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

export function isSameMonth(day: string, reference: string): boolean {
  return day.slice(0, 7) === reference.slice(0, 7)
}

/* ------------------------------------------------------------------ *
 * Placing events on a day
 * ------------------------------------------------------------------ */

export interface TimeSpan {
  startsAt: string
  endsAt: string
}

/** The days an event touches, so a multi-day event appears on each of them. */
export function daysCovered(span: TimeSpan): string[] {
  const first = dayOf(span.startsAt)
  const last = dayOf(span.endsAt)
  const count = Math.max(0, daysBetween(first, last))
  return Array.from({ length: count + 1 }, (_, index) => addDays(first, index))
}

export function occursOn(span: TimeSpan, day: string): boolean {
  return dayOf(span.startsAt) <= day && day <= dayOf(span.endsAt)
}

/**
 * The slice of an event that falls on `day`, in minutes since that day's
 * midnight. An event running past midnight is clipped rather than drawn
 * overflowing, so each day column stays self-contained.
 */
export function segmentOn(span: TimeSpan, day: string): { start: number; end: number } {
  const start = dayOf(span.startsAt) < day ? 0 : minutesOf(span.startsAt)
  const end = dayOf(span.endsAt) > day ? MINUTES_PER_DAY : minutesOf(span.endsAt)
  // A zero-length event still needs to be clickable.
  return { start, end: Math.max(end, start + 15) }
}

export interface Placed<T> {
  item: T
  /** Zero-based column within its overlapping cluster. */
  column: number
  /** How many columns that cluster needs — the divisor for the width. */
  columns: number
}

/**
 * Side-by-side placement for events that overlap in time.
 *
 * Events are grouped into clusters of transitively-overlapping items, and
 * within a cluster each one takes the first column that is free at its start.
 * The cluster is what decides the width: two meetings at 9 and 10 that both
 * overlap an all-morning block sit in the same cluster, so all three keep a
 * consistent width instead of the middle one jumping.
 */
export function placeOverlapping<T>(
  items: T[],
  bounds: (item: T) => { start: number; end: number }
): Placed<T>[] {
  const sorted = [...items].sort((a, b) => {
    const left = bounds(a)
    const right = bounds(b)
    // Longer first when two start together, so the backdrop event takes column 0.
    return left.start - right.start || right.end - right.start - (left.end - left.start)
  })

  const placed: Placed<T>[] = []
  let cluster: Placed<T>[] = []
  let clusterEnd = -Infinity
  let columnEnds: number[] = []

  const flush = (): void => {
    for (const entry of cluster) entry.columns = columnEnds.length
    placed.push(...cluster)
    cluster = []
    columnEnds = []
    clusterEnd = -Infinity
  }

  for (const item of sorted) {
    const { start, end } = bounds(item)
    if (start >= clusterEnd && cluster.length > 0) flush()

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(end)
    } else {
      columnEnds[column] = end
    }

    cluster.push({ item, column, columns: 1 })
    clusterEnd = Math.max(clusterEnd, end)
  }

  if (cluster.length > 0) flush()
  return placed
}

/** Round minutes to the nearest `step`, for drag and resize. */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step
}

/** Clamp a value into a range — used to keep a dragged event inside its day. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** "09:00 – 10:30", or "09:00 – 10:30, next day" when it runs over midnight. */
export function describeSpan(span: TimeSpan): string {
  const base = `${timeOf(span.startsAt)} – ${timeOf(span.endsAt)}`
  const overnight = daysBetween(dayOf(span.startsAt), dayOf(span.endsAt))
  return overnight > 0 ? `${base}, +${overnight}d` : base
}
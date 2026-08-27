/**
 * Repeating blocks, as RFC 5545 recurrence rules.
 *
 * Written here rather than taken from a library for the same reason SQLite
 * comes from `node:sqlite`: this app ships with no compiled dependencies and
 * as few uncompiled ones as it can manage, and the useful part of RFC 5545 is
 * a few hundred lines. What is implemented is the subset a working diary
 * needs — daily, weekly, monthly and yearly, with intervals, weekday lists,
 * month-day lists, and either a count or an end date. What is deliberately
 * not implemented is BYSETPOS, BYWEEKNO, BYYEARDAY and the rest of the tail:
 * nobody schedules client work on the 53rd week of the year, and a parser
 * that half-supports something is worse than one that says it does not.
 *
 * Everything works in **day space** — `yyyy-mm-dd` strings, no times. The
 * time of day comes from the block being repeated and is re-applied to each
 * occurrence. That is what makes a 09:00 weekly stand-up still 09:00 after the
 * clocks change: there is no instant being shifted, only a date and a wall
 * time being put back together.
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

/** Monday-first, matching every other part of the calendar. */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export interface ByDay {
  weekday: Weekday
  /**
   * Which one in the month: 1 is the first, -1 the last. Absent means every
   * one. Only meaningful for MONTHLY and YEARLY.
   */
  ordinal?: number
}

export interface Recurrence {
  freq: Frequency
  /** Every `interval` periods. Always at least 1. */
  interval: number
  byDay: ByDay[]
  byMonthDay: number[]
  /** Total occurrences including the first. Mutually exclusive with `until`. */
  count?: number
  /** Inclusive last day, `yyyy-mm-dd`. */
  until?: string
}

/**
 * Hard ceilings on expansion.
 *
 * Both are measured against the range being drawn, never against the series
 * start. Measuring from the start is the obvious thing and it is wrong: a
 * stand-up somebody has had every Monday since 2018 would fall outside a
 * horizon anchored to 2018 and vanish from this year's calendar entirely,
 * and a daily series older than five hundred days would exhaust an occurrence
 * cap long before the loop reached the week on screen.
 *
 * `MAX_IN_RANGE` bounds what comes back, which is what the grid has to draw.
 * `MAX_STEPS` bounds the walk itself, so a rule from an imported feed that
 * starts in 1900 costs a bounded amount of work rather than an unbounded one.
 */
export const MAX_IN_RANGE = 500
export const MAX_STEPS = 20_000

/* ------------------------------------------------------------------ *
 * Day arithmetic
 * ------------------------------------------------------------------ */

function parts(day: string): [number, number, number] {
  return day.split('-').map(Number) as [number, number, number]
}

function toUtc(day: string): number {
  const [year, month, date] = parts(day)
  return Date.UTC(year, month - 1, date)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

function shiftDays(day: string, days: number): string {
  return fromUtc(toUtc(day) + days * DAY_MS)
}

/** Monday = 0, matching WEEKDAYS. */
function weekdayIndex(day: string): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7
}

/** The Monday of the week `day` falls in. */
function weekStart(day: string): string {
  return shiftDays(day, -weekdayIndex(day))
}

function addMonths(day: string, months: number): { year: number; month: number; date: number } {
  const [year, month, date] = parts(day)
  const total = (year * 12 + (month - 1)) + months
  return { year: Math.floor(total / 12), month: (total % 12) + 1, date }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * A date in a month, or null if that month has no such date.
 *
 * Null rather than clamping, deliberately, and this is the RFC's own rule:
 * "the 31st of every month" happens seven times a year, not twelve. Clamping
 * to the 30th would silently invent four appointments a year on a date nobody
 * chose, and the person who set the rule would never be told.
 */
function dateIn(year: number, month: number, date: number): string | null {
  if (date < 1 || date > daysInMonth(year, month)) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ *
 * Parsing and formatting
 * ------------------------------------------------------------------ */

const FREQUENCIES: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']

function parseByDay(value: string): ByDay[] {
  const out: ByDay[] = []
  for (const raw of value.split(',')) {
    const token = raw.trim().toUpperCase()
    const match = /^(-?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token)
    if (!match) continue
    const weekday = match[2] as Weekday
    out.push(match[1] ? { weekday, ordinal: Number(match[1]) } : { weekday })
  }
  return out
}

/**
 * Read a rule, or return null.
 *
 * Null rather than throwing, because rules arrive from subscribed calendars
 * written by software nobody here controls. One malformed RRULE in a feed of
 * two hundred events must cost that one event its repetition, not the sync.
 */
export function parseRule(text: string | null | undefined): Recurrence | null {
  if (!text) return null

  const body = text.trim().replace(/^RRULE:/i, '')
  const fields = new Map<string, string>()
  for (const pair of body.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    fields.set(pair.slice(0, index).trim().toUpperCase(), pair.slice(index + 1).trim())
  }

  const freq = (fields.get('FREQ') ?? '').toUpperCase() as Frequency
  if (!FREQUENCIES.includes(freq)) return null

  const interval = Number(fields.get('INTERVAL') ?? 1)
  const rule: Recurrence = {
    freq,
    interval: Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1,
    byDay: parseByDay(fields.get('BYDAY') ?? ''),
    byMonthDay: (fields.get('BYMONTHDAY') ?? '')
      .split(',')
      .map((one) => Number(one.trim()))
      .filter((one) => Number.isInteger(one) && one !== 0 && Math.abs(one) <= 31)
  }

  const count = Number(fields.get('COUNT'))
  // Clamped to the walk budget rather than to a display cap: a COUNT is a
  // fact about the series, and a feed claiming a million of them should
  // cost bounded work rather than have its number quietly rewritten small.
  if (Number.isInteger(count) && count > 0) rule.count = Math.min(count, MAX_STEPS)

  const until = fields.get('UNTIL')
  if (until) {
    // Both the date and the date-time forms, and the trailing Z is ignored:
    // the whole calendar is wall time, so treating an UNTIL as an instant
    // would move the last occurrence by an hour half the year.
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(until)
    if (match) rule.until = `${match[1]}-${match[2]}-${match[3]}`
  }

  return rule
}

export function formatRule(rule: Recurrence): string {
  const parts: string[] = [`FREQ=${rule.freq}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.byDay.length > 0) {
    parts.push(
      `BYDAY=${rule.byDay.map((one) => `${one.ordinal ?? ''}${one.weekday}`).join(',')}`
    )
  }
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`)
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`)
  return parts.join(';')
}

const DAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday'
}

const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last'
}

/**
 * The rule as a sentence.
 *
 * Shown wherever a rule can be set, because `FREQ=MONTHLY;BYDAY=3TH` is not
 * something anybody should have to check by reading. Getting this wrong is
 * how people end up with a meeting on the wrong Thursday for a year.
 */
export function describeRule(rule: Recurrence): string {
  const every = rule.interval === 1 ? '' : `${rule.interval} `
  let base: string

  switch (rule.freq) {
    case 'DAILY':
      base = `Every ${every}${rule.interval === 1 ? 'day' : 'days'}`
      break
    case 'WEEKLY': {
      const days = rule.byDay.map((one) => DAY_NAMES[one.weekday])
      const weeks = `Every ${every}${rule.interval === 1 ? 'week' : 'weeks'}`
      base = days.length > 0 ? `${weeks} on ${list(days)}` : weeks
      break
    }
    case 'MONTHLY': {
      const months = `Every ${every}${rule.interval === 1 ? 'month' : 'months'}`
      const nth = rule.byDay[0]
      if (nth?.ordinal !== undefined) {
        base = `${months} on the ${ORDINALS[nth.ordinal] ?? `${nth.ordinal}th`} ${DAY_NAMES[nth.weekday]}`
      } else if (rule.byMonthDay.length > 0) {
        base = `${months} on the ${list(rule.byMonthDay.map(ordinalDate))}`
      } else {
        base = months
      }
      break
    }
    case 'YEARLY':
      base = `Every ${every}${rule.interval === 1 ? 'year' : 'years'}`
      break
  }

  if (rule.count !== undefined) return `${base}, ${rule.count} times`
  if (rule.until !== undefined) return `${base}, until ${rule.until}`
  return base
}

function list(items: (string | number)[]): string {
  if (items.length <= 1) return String(items[0] ?? '')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function ordinalDate(date: number): string {
  if (date < 0) return date === -1 ? 'last day' : `${-date}th from last`
  const suffix =
    date % 10 === 1 && date !== 11
      ? 'st'
      : date % 10 === 2 && date !== 12
        ? 'nd'
        : date % 10 === 3 && date !== 13
          ? 'rd'
          : 'th'
  return `${date}${suffix}`
}

/* ------------------------------------------------------------------ *
 * Expansion
 * ------------------------------------------------------------------ */

/**
 * The days a rule falls on, within a range.
 *
 * `start` is the first occurrence — the rule describes repetitions of it, and
 * the first one always counts toward COUNT. Occurrences before `range.from`
 * are still generated and counted, because "the tenth Tuesday" means the
 * tenth from the beginning, not the tenth you happened to scroll to.
 *
 * `exdates` are days the series skips: a cancelled instance, or one moved
 * somewhere else and materialised as its own block.
 */
export function expand(
  rule: Recurrence,
  start: string,
  range: { from: string; to: string },
  exdates: string[] = []
): string[] {
  const skip = new Set(exdates)
  // The range is what bounds this. An endless rule stops at `range.to`
  // because there is nothing past it to draw, and `until` stops it sooner.
  const ceiling =
    rule.until !== undefined && rule.until < range.to ? rule.until : range.to

  const found: string[] = []
  /** Occurrences of the series so far, which is what COUNT counts. */
  let emitted = 0
  /** Iterations, which is only a guard against a pathological rule. */
  let steps = 0

  /** True when the caller should stop generating entirely. */
  const take = (day: string): boolean => {
    if (day < start) return false
    if (rule.until !== undefined && day > rule.until) return true

    // Counted before the skip, not after. COUNT counts occurrences of the
    // series, and one that was cancelled or dragged out of it still used one
    // up — which is what stops a series of ten quietly becoming eleven every
    // time somebody moves an instance. It is also why a series that ran out
    // years ago correctly shows nothing today: the only way to know it is
    // over is to have counted from the beginning.
    emitted += 1
    steps += 1
    if (!skip.has(day) && day >= range.from && day <= range.to) found.push(day)

    if (rule.count !== undefined && emitted >= rule.count) return true
    if (found.length >= MAX_IN_RANGE) return true
    if (steps >= MAX_STEPS) return true
    return false
  }

  if (rule.freq === 'DAILY') {
    for (let day = start; day <= ceiling; day = shiftDays(day, rule.interval)) {
      if (take(day)) break
    }
    return found
  }

  if (rule.freq === 'WEEKLY') {
    // Default to the weekday the series started on, which is what a bare
    // FREQ=WEEKLY means.
    const wanted =
      rule.byDay.length > 0
        ? rule.byDay.map((one) => WEEKDAYS.indexOf(one.weekday)).sort((a, b) => a - b)
        : [weekdayIndex(start)]

    let week = weekStart(start)
    outer: while (week <= ceiling) {
      for (const index of wanted) {
        const day = shiftDays(week, index)
        if (day > ceiling) continue
        if (take(day)) break outer
      }
      week = shiftDays(week, 7 * rule.interval)
    }
    return found
  }

  if (rule.freq === 'MONTHLY') {
    const [, , startDate] = parts(start)
    const nth = rule.byDay.find((one) => one.ordinal !== undefined)

    for (let step = 0; ; step += rule.interval) {
      const { year, month } = addMonths(start, step)
      const first = dateIn(year, month, 1)
      if (!first || first > ceiling) break

      const days: string[] = []
      if (nth) {
        const day = nthWeekdayOf(year, month, nth.weekday, nth.ordinal!)
        if (day) days.push(day)
      } else {
        for (const date of rule.byMonthDay.length > 0 ? rule.byMonthDay : [startDate]) {
          // Negative counts back from the end, which is the only way to say
          // "the last day of the month" for a month that has 28 of them.
          const resolved =
            date > 0 ? dateIn(year, month, date) : dateIn(year, month, daysInMonth(year, month) + 1 + date)
          if (resolved) days.push(resolved)
        }
      }

      let stop = false
      for (const day of days.sort()) {
        if (day > ceiling) continue
        if (take(day)) {
          stop = true
          break
        }
      }
      if (stop) break
    }
    return found
  }

  // YEARLY: the same date each year. A 29 February rule fires in leap years
  // only, for the same reason the 31st does not become the 30th.
  const [, startMonth, startDate] = parts(start)
  for (let step = 0; ; step += rule.interval) {
    const year = parts(start)[0] + step
    const day = dateIn(year, startMonth, startDate)
    if (day && day > ceiling) break
    if (!day) {
      // Not a leap year. Keep going rather than stopping the series.
      if (`${year + 1}-01-01` > ceiling) break
      continue
    }
    if (take(day)) break
  }
  return found
}

/** The nth (or last) given weekday of a month, or null if there is no such one. */
function nthWeekdayOf(
  year: number,
  month: number,
  weekday: Weekday,
  ordinal: number
): string | null {
  const wanted = WEEKDAYS.indexOf(weekday)
  const total = daysInMonth(year, month)

  const matches: string[] = []
  for (let date = 1; date <= total; date += 1) {
    const day = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    if (weekdayIndex(day) === wanted) matches.push(day)
  }

  return (ordinal > 0 ? matches[ordinal - 1] : matches.at(ordinal)) ?? null
}

/** The rule a "repeats weekly on the day it is on" choice produces. */
export function simpleRule(freq: Frequency, start: string): Recurrence {
  if (freq === 'WEEKLY') {
    return { freq, interval: 1, byDay: [{ weekday: WEEKDAYS[weekdayIndex(start)]! }], byMonthDay: [] }
  }
  return { freq, interval: 1, byDay: [], byMonthDay: [] }
}

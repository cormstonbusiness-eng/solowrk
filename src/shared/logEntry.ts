/**
 * Reading "log 2h yesterday" as a time entry.
 *
 * The command palette is the fastest way into this app, and the slowest thing
 * anybody does in it is retrospectively logging time they forgot to track.
 * Typing the sentence is the whole feature.
 *
 * Deliberately conservative: anything it is not sure about returns null and
 * the palette simply offers nothing, rather than guessing and quietly booking
 * ninety minutes to the wrong day. A command that does the wrong thing is far
 * worse than one that fails to appear.
 */

export interface LoggedTime {
  /** Seconds, always positive. */
  seconds: number
  /** `yyyy-mm-dd`. */
  date: string
  /** What is left after the duration and the day are taken out, trimmed. */
  note: string
}

/** `1h`, `90m`, `1.5h`, `2 hours`, `45 mins`, `1h30`, `1h 30m`. */
const DURATION =
  /(?:^|\s)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minute|minutes)?)?|(?:^|\s)(\d+)\s*(m|min|mins|minute|minutes)\b/i

/**
 * The named days people actually type. Anything more elaborate — "last
 * Tuesday", "the 3rd" — is a date picker's job, and getting it subtly wrong
 * would put billable hours in the wrong week.
 */
const DAYS: Record<string, number> = {
  today: 0,
  yesterday: -1,
  'day before yesterday': -2
}

function shiftDay(today: string, days: number): string {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  // UTC arithmetic on a date-only string: a local Date across a DST boundary
  // can come back a day out, which would book the time to the wrong day.
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

export function parseLoggedTime(input: string, today: string): LoggedTime | null {
  const text = input.trim()
  if (text === '') return null

  const match = DURATION.exec(text)
  if (!match) return null

  const [whole, hours, , extraMinutes, minutesOnly] = match

  const seconds = hours
    ? Math.round(Number(hours) * 3600) + Number(extraMinutes ?? 0) * 60
    : Number(minutesOnly) * 60

  // Zero is not a mistake worth booking, and a working day past sixteen hours
  // is far more likely to be a typo than a shift.
  if (seconds <= 0 || seconds > 16 * 3600) return null

  let rest = text.replace(whole!, ' ')

  let date = today
  for (const [name, offset] of Object.entries(DAYS).sort(
    // Longest first, so "day before yesterday" is not eaten by "yesterday".
    (a, b) => b[0].length - a[0].length
  )) {
    const found = new RegExp(`\\b${name}\\b`, 'i')
    if (found.test(rest)) {
      date = shiftDay(today, offset)
      rest = rest.replace(found, ' ')
      break
    }
  }

  const note = rest
    // The verb itself, and the joining words left behind once the duration and
    // the day have been lifted out.
    .replace(/\b(log|logged|track|tracked|add|record)\b/gi, ' ')
    .replace(/^\s*(on|to|for|of)\b/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { seconds, date, note }
}

/** "2h 30m", for reading a parsed entry back before committing to it. */
export function describeSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)

  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/**
 * iCalendar, read and written.
 *
 * A parser rather than a dependency, for the same reason as the recurrence
 * rules: what a diary actually needs from RFC 5545 is `VEVENT` with a handful
 * of properties, and the rest of the format is calendaring-server machinery
 * nobody here will ever emit.
 *
 * The hard part is not the grammar, it is the times. iCalendar has three kinds
 * of DTSTART and they mean genuinely different things:
 *
 *   DTSTART;VALUE=DATE:20260817          an all-day event
 *   DTSTART:20260817T090000              a *floating* time — 09:00 wherever
 *                                        you happen to be
 *   DTSTART:20260817T080000Z             an instant, 08:00 UTC
 *
 * SoloWrk stores wall time, so the first two arrive unchanged and only the
 * third is converted. Treating a floating time as UTC is the classic bug here
 * and it moves half a calendar by an hour for half the year.
 */

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  location: string
  /** `yyyy-mm-ddThh:mm`, local wall time. */
  startsAt: string
  endsAt: string
  allDay: boolean
  /** The raw RRULE, for the recurrence engine to read. */
  rrule: string | null
  /** Days the series skips, `yyyy-mm-dd`. */
  exdates: string[]
  status: string
  url: string
}

/* ------------------------------------------------------------------ *
 * Unfolding and splitting
 * ------------------------------------------------------------------ */

/**
 * Put folded lines back together.
 *
 * iCalendar wraps at 75 octets and marks the continuation with a leading space
 * or tab. A parser that skips this reads a long description as a series of
 * unknown properties and loses it.
 */
function unfold(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
  }
  return lines
}

interface Property {
  name: string
  params: Map<string, string>
  value: string
}

function parseLine(line: string): Property | null {
  const colon = indexOfUnquoted(line, ':')
  if (colon === -1) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...rawParams] = head.split(';')

  const params = new Map<string, string>()
  for (const param of rawParams) {
    const equals = param.indexOf('=')
    if (equals === -1) continue
    params.set(
      param.slice(0, equals).toUpperCase(),
      param.slice(equals + 1).replace(/^"|"$/g, '')
    )
  }

  return { name: (name ?? '').toUpperCase(), params, value }
}

/**
 * The first colon that is not inside a quoted parameter.
 *
 * `ATTENDEE;CN="Smith: Dana":mailto:…` is legal, and splitting on the first
 * colon would cut the property name in half.
 */
function indexOfUnquoted(line: string, char: string): number {
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const at = line[index]
    if (at === '"') quoted = !quoted
    else if (at === char && !quoted) return index
  }
  return -1
}

/** Undo the text escaping: `\n`, `\,`, `\;`, `\\`. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim()
}

/* ------------------------------------------------------------------ *
 * Times
 * ------------------------------------------------------------------ */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export interface IcsTime {
  /** `yyyy-mm-ddThh:mm`, or `yyyy-mm-dd` when it is a date. */
  stamp: string
  isDate: boolean
}

/**
 * Read a DATE or DATE-TIME.
 *
 * A trailing Z is the only thing that makes a time an instant, and it is the
 * only case converted. A TZID parameter names a zone this app does not carry a
 * database for; those are treated as floating, which is right far more often
 * than it is wrong — a feed written in Europe/London on a machine in
 * Europe/London wants exactly that.
 */
export function parseIcsTime(value: string, isDate: boolean): IcsTime | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!match) return null

  const [, year, month, day, hour, minute, , zulu] = match
  if (isDate || hour === undefined) {
    return { stamp: `${year}-${month}-${day}`, isDate: true }
  }

  if (zulu) {
    const utc = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
    )
    return {
      stamp: `${utc.getFullYear()}-${pad(utc.getMonth() + 1)}-${pad(utc.getDate())}T${pad(
        utc.getHours()
      )}:${pad(utc.getMinutes())}`,
      isDate: false
    }
  }

  return { stamp: `${year}-${month}-${day}T${hour}:${minute}`, isDate: false }
}

/* ------------------------------------------------------------------ *
 * Parsing a feed
 * ------------------------------------------------------------------ */

/**
 * Every usable event in a feed.
 *
 * Anything unreadable is dropped rather than thrown: a feed is written by
 * software nobody here controls, and one malformed VEVENT out of two hundred
 * must cost that one event, not the sync. Cancelled events are dropped too —
 * a meeting somebody called off is not a meeting.
 */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let current: Partial<IcsEvent> & { exdates?: string[] } | null = null
  let endsAtDate: string | null = null
  let durationMinutes: number | null = null

  for (const line of unfold(text)) {
    const property = parseLine(line)
    if (!property) continue

    if (property.name === 'BEGIN' && property.value.toUpperCase() === 'VEVENT') {
      current = { exdates: [] }
      endsAtDate = null
      durationMinutes = null
      continue
    }

    if (property.name === 'END' && property.value.toUpperCase() === 'VEVENT') {
      if (current) {
        const finished = finish(current, endsAtDate, durationMinutes)
        if (finished) events.push(finished)
      }
      current = null
      continue
    }

    if (!current) continue

    switch (property.name) {
      case 'UID':
        current.uid = property.value.trim()
        break
      case 'SUMMARY':
        current.summary = unescapeText(property.value)
        break
      case 'DESCRIPTION':
        current.description = unescapeText(property.value)
        break
      case 'LOCATION':
        current.location = unescapeText(property.value)
        break
      case 'URL':
        current.url = property.value.trim()
        break
      case 'STATUS':
        current.status = property.value.trim().toUpperCase()
        break
      case 'RRULE':
        current.rrule = property.value.trim()
        break
      case 'DTSTART': {
        const time = parseIcsTime(property.value, property.params.get('VALUE') === 'DATE')
        if (time) {
          current.allDay = time.isDate
          current.startsAt = time.isDate ? `${time.stamp}T00:00` : time.stamp
        }
        break
      }
      case 'DTEND': {
        const time = parseIcsTime(property.value, property.params.get('VALUE') === 'DATE')
        if (time) endsAtDate = time.stamp
        break
      }
      case 'DURATION':
        durationMinutes = parseDuration(property.value)
        break
      case 'EXDATE': {
        for (const one of property.value.split(',')) {
          const time = parseIcsTime(one, property.params.get('VALUE') === 'DATE')
          if (time) current.exdates?.push(time.stamp.slice(0, 10))
        }
        break
      }
      default:
        break
    }
  }

  return events
}

/**
 * Turn what was collected into an event, or nothing.
 *
 * A VEVENT with no UID or no start is not something that can be reconciled or
 * drawn, so it is dropped. DTEND for an all-day event is *exclusive* in the
 * RFC — a one-day event ends the next morning — and storing that literally
 * would draw every all-day event two days long.
 */
function finish(
  draft: Partial<IcsEvent> & { exdates?: string[] },
  endsAtDate: string | null,
  durationMinutes: number | null
): IcsEvent | null {
  if (!draft.uid || !draft.startsAt) return null
  if (draft.status === 'CANCELLED') return null

  const allDay = draft.allDay === true
  let endsAt: string

  if (endsAtDate) {
    endsAt = allDay
      ? `${shiftDay(endsAtDate.slice(0, 10), -1)}T23:59`
      : endsAtDate.includes('T')
        ? endsAtDate
        : `${endsAtDate}T23:59`
  } else if (durationMinutes !== null) {
    endsAt = addMinutesTo(draft.startsAt, durationMinutes)
  } else {
    // No end and no duration. The RFC says a date-time event with neither
    // takes up no time at all; a date event takes up the day.
    endsAt = allDay ? `${draft.startsAt.slice(0, 10)}T23:59` : draft.startsAt
  }

  return {
    uid: draft.uid,
    summary: draft.summary || 'Untitled',
    description: draft.description ?? '',
    location: draft.location ?? '',
    startsAt: draft.startsAt,
    endsAt,
    allDay,
    rrule: draft.rrule ?? null,
    exdates: draft.exdates ?? [],
    status: draft.status ?? '',
    url: draft.url ?? ''
  }
}

/** ISO 8601 durations, as far as a calendar uses them: P1DT2H30M. */
function parseDuration(value: string): number | null {
  const match = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim()
  )
  if (!match) return null
  const [, weeks, days, hours, minutes] = match
  return (
    Number(weeks ?? 0) * 10080 +
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0)
  )
}

function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10)
}

function addMinutesTo(stamp: string, minutes: number): string {
  const [day, time] = stamp.split('T') as [string, string]
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const at = new Date(Date.UTC(year, month - 1, date, hour, minute + minutes))
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T${pad(
    at.getUTCHours()
  )}:${pad(at.getUTCMinutes())}`
}

/* ------------------------------------------------------------------ *
 * Writing a feed
 * ------------------------------------------------------------------ */

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** Fold at 75 octets, as the RFC requires, so long descriptions survive. */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  for (let index = 75; index < line.length; index += 74) {
    parts.push(` ${line.slice(index, index + 74)}`)
  }
  return parts.join('\r\n')
}

export interface IcsExportBlock {
  id: number
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  allDay: boolean
  recurrenceRule: string | null
  updatedAt: string
}

/**
 * The user's own blocks, as a file they can hand to anybody.
 *
 * Written as floating times with no TZID, which is what they are: SoloWrk
 * stores 09:00, not an instant, and stamping a zone on the way out would be
 * asserting something the app was never told.
 */
export function writeIcs(blocks: IcsExportBlock[], name = 'SoloWrk'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blockout Digital//SoloWrk//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`
  ]

  for (const block of blocks) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:solowrk-${block.id}@solo-wrk.com`)
    lines.push(`DTSTAMP:${stampToIcs(block.updatedAt)}`)

    if (block.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${block.startsAt.slice(0, 10).replace(/-/g, '')}`)
      // Exclusive, per the RFC: a one-day event ends the next morning.
      lines.push(
        `DTEND;VALUE=DATE:${shiftDay(block.endsAt.slice(0, 10), 1).replace(/-/g, '')}`
      )
    } else {
      lines.push(`DTSTART:${localToIcs(block.startsAt)}`)
      lines.push(`DTEND:${localToIcs(block.endsAt)}`)
    }

    lines.push(fold(`SUMMARY:${escapeText(block.title)}`))
    if (block.description) lines.push(fold(`DESCRIPTION:${escapeText(block.description)}`))
    if (block.location) lines.push(fold(`LOCATION:${escapeText(block.location)}`))
    if (block.recurrenceRule) lines.push(`RRULE:${block.recurrenceRule}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

/** `2026-08-17T09:00` → `20260817T090000`, still floating. */
function localToIcs(stamp: string): string {
  return `${stamp.slice(0, 10).replace(/-/g, '')}T${stamp.slice(11, 16).replace(':', '')}00`
}

/** DTSTAMP has to be UTC — it is when the file was written, not a wall time. */
function stampToIcs(iso: string): string {
  const at = new Date(iso)
  const when = Number.isNaN(at.getTime()) ? new Date() : at
  return `${when.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
}

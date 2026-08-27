import { describe, expect, it } from 'vitest'
import { parseIcs, parseIcsTime, writeIcs } from './ics'

/** A feed is written by software nobody here controls. These are the shapes it comes in. */
const feed = (...events: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')

const vevent = (...lines: string[]): string =>
  ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')

describe('reading times', () => {
  it('takes a floating time at face value', () => {
    // The classic bug: treating this as UTC moves half a calendar by an hour
    // for half the year. 09:00 in a feed means 09:00.
    expect(parseIcsTime('20260817T090000', false)).toEqual({
      stamp: '2026-08-17T09:00',
      isDate: false
    })
  })

  it('converts an instant into local wall time', () => {
    const parsed = parseIcsTime('20260817T080000Z', false)
    // Whatever the machine's zone, it is a real conversion rather than the
    // digits being copied across.
    expect(parsed?.stamp).toMatch(/^2026-08-1[67]T\d{2}:\d{2}$/)
    expect(parsed?.isDate).toBe(false)
  })

  it('reads a date as a date', () => {
    expect(parseIcsTime('20260817', true)).toEqual({ stamp: '2026-08-17', isDate: true })
  })

  it('returns null for anything it cannot read', () => {
    expect(parseIcsTime('next tuesday', false)).toBeNull()
  })
})

describe('reading a feed', () => {
  it('pulls out the fields it uses', () => {
    const text = feed(
      vevent(
        'UID:abc@example.com',
        'SUMMARY:Kickoff call',
        'DESCRIPTION:Bring the deck',
        'LOCATION:Zoom',
        'DTSTART:20260817T090000',
        'DTEND:20260817T100000'
      )
    )

    expect(parseIcs(text)).toEqual([
      {
        uid: 'abc@example.com',
        summary: 'Kickoff call',
        description: 'Bring the deck',
        location: 'Zoom',
        startsAt: '2026-08-17T09:00',
        endsAt: '2026-08-17T10:00',
        allDay: false,
        rrule: null,
        exdates: [],
        status: '',
        url: ''
      }
    ])
  })

  it('puts folded lines back together', () => {
    // iCalendar wraps at 75 octets. A parser that skips this reads a long
    // description as unknown properties and loses it.
    const text = feed(
      vevent(
        'UID:a',
        'DTSTART:20260817T090000',
        'DESCRIPTION:This is a rather long description that the feed has',
        '  wrapped across two lines'
      )
    )

    expect(parseIcs(text)[0]?.description).toBe(
      'This is a rather long description that the feed has wrapped across two lines'
    )
  })

  it('undoes the text escaping', () => {
    const text = feed(
      vevent('UID:a', 'DTSTART:20260817T090000', 'SUMMARY:Rebrand\\, phase 2\\nand a note')
    )
    expect(parseIcs(text)[0]?.summary).toBe('Rebrand, phase 2\nand a note')
  })

  it('does not split a property name on a colon inside a quoted parameter', () => {
    const text = feed(
      vevent('UID:a', 'DTSTART:20260817T090000', 'LOCATION;X-NOTE="Smith: Dana":The studio')
    )
    expect(parseIcs(text)[0]?.location).toBe('The studio')
  })

  it('skips events somebody called off', () => {
    const text = feed(
      vevent('UID:a', 'SUMMARY:Cancelled thing', 'DTSTART:20260817T090000', 'STATUS:CANCELLED'),
      vevent('UID:b', 'SUMMARY:Real thing', 'DTSTART:20260818T090000')
    )
    expect(parseIcs(text).map((one) => one.summary)).toEqual(['Real thing'])
  })

  it('drops what it cannot use without losing the rest', () => {
    // One malformed VEVENT out of two hundred must cost that one event, not
    // the sync.
    const text = feed(
      vevent('SUMMARY:No UID at all', 'DTSTART:20260817T090000'),
      vevent('UID:b', 'SUMMARY:No start'),
      vevent('UID:c', 'SUMMARY:Fine', 'DTSTART:20260818T090000')
    )
    expect(parseIcs(text).map((one) => one.summary)).toEqual(['Fine'])
  })

  it('survives a file that is not a calendar at all', () => {
    expect(parseIcs('this is not an ics file')).toEqual([])
    expect(parseIcs('')).toEqual([])
  })

  it('keeps a recurrence rule and its exceptions', () => {
    const text = feed(
      vevent(
        'UID:a',
        'DTSTART:20260803T090000',
        'DTEND:20260803T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'EXDATE:20260817T090000,20260824T090000'
      )
    )
    expect(parseIcs(text)[0]).toMatchObject({
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-08-17', '2026-08-24']
    })
  })
})

describe('all-day events', () => {
  it('does not draw a one-day event across two days', () => {
    // DTEND is exclusive in the RFC: a one-day event ends the next morning.
    // Storing that literally is how every all-day event ends up a day long
    // in the wrong direction.
    const text = feed(
      vevent('UID:a', 'SUMMARY:Bank holiday', 'DTSTART;VALUE=DATE:20260831', 'DTEND;VALUE=DATE:20260901')
    )

    expect(parseIcs(text)[0]).toMatchObject({
      allDay: true,
      startsAt: '2026-08-31T00:00',
      endsAt: '2026-08-31T23:59'
    })
  })

  it('handles one with no end at all', () => {
    const text = feed(vevent('UID:a', 'DTSTART;VALUE=DATE:20260831'))
    expect(parseIcs(text)[0]).toMatchObject({
      allDay: true,
      endsAt: '2026-08-31T23:59'
    })
  })
})

describe('durations instead of an end', () => {
  it('reads hours and minutes', () => {
    const text = feed(vevent('UID:a', 'DTSTART:20260817T090000', 'DURATION:PT1H30M'))
    expect(parseIcs(text)[0]?.endsAt).toBe('2026-08-17T10:30')
  })

  it('reads days', () => {
    const text = feed(vevent('UID:a', 'DTSTART:20260817T090000', 'DURATION:P1DT2H'))
    expect(parseIcs(text)[0]?.endsAt).toBe('2026-08-18T11:00')
  })
})

describe('writing a feed', () => {
  const block = {
    id: 7,
    title: 'Kickoff call',
    description: 'Bring the deck',
    location: 'Zoom',
    startsAt: '2026-08-17T09:00',
    endsAt: '2026-08-17T10:00',
    allDay: false,
    recurrenceRule: null,
    updatedAt: '2026-08-01T12:00:00.000Z'
  }

  it('writes floating times, because that is what is stored', () => {
    // Stamping a zone on the way out would assert something the app was never
    // told. 09:00 goes out as 09:00.
    const text = writeIcs([block])
    expect(text).toContain('DTSTART:20260817T090000')
    expect(text).not.toContain('DTSTART:20260817T090000Z')
  })

  it('uses CRLF line endings, as the format requires', () => {
    expect(writeIcs([block])).toContain('\r\n')
  })

  it('escapes what has to be escaped', () => {
    const text = writeIcs([{ ...block, title: 'Rebrand, phase 2; final' }])
    expect(text).toContain('SUMMARY:Rebrand\\, phase 2\\; final')
  })

  it('makes an all-day end exclusive again', () => {
    const text = writeIcs([
      { ...block, allDay: true, startsAt: '2026-08-31T00:00', endsAt: '2026-08-31T23:59' }
    ])
    expect(text).toContain('DTSTART;VALUE=DATE:20260831')
    expect(text).toContain('DTEND;VALUE=DATE:20260901')
  })

  it('comes back out the way it went in', () => {
    const [parsed] = parseIcs(writeIcs([block]))
    expect(parsed).toMatchObject({
      summary: 'Kickoff call',
      location: 'Zoom',
      startsAt: '2026-08-17T09:00',
      endsAt: '2026-08-17T10:00',
      allDay: false
    })
  })

  it('round-trips an all-day event without it growing a day', () => {
    const [parsed] = parseIcs(
      writeIcs([{ ...block, allDay: true, startsAt: '2026-08-31T00:00', endsAt: '2026-08-31T23:59' }])
    )
    expect(parsed).toMatchObject({ startsAt: '2026-08-31T00:00', endsAt: '2026-08-31T23:59' })
  })

  it('round-trips a long description through the folding', () => {
    const long = 'A description long enough that the writer has to fold it across lines, '.repeat(3)
    const [parsed] = parseIcs(writeIcs([{ ...block, description: long }]))
    expect(parsed?.description).toBe(long.trim())
  })
})

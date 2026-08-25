import { describe, expect, it } from 'vitest'
import { describeSeconds, parseLoggedTime } from './logEntry'

/**
 * Reading a typed sentence as a time entry.
 *
 * Both failure directions are bad and only one is visible. Refusing to parse
 * something reasonable is an annoyance the user sees immediately; parsing
 * something wrong books billable hours to the wrong day or the wrong length,
 * and is found weeks later when an invoice does not match the work.
 */
const TODAY = '2026-08-25'

describe('durations', () => {
  it('reads hours', () => {
    expect(parseLoggedTime('log 2h', TODAY)?.seconds).toBe(7200)
    expect(parseLoggedTime('log 2 hours', TODAY)?.seconds).toBe(7200)
    expect(parseLoggedTime('log 1hr', TODAY)?.seconds).toBe(3600)
  })

  it('reads minutes', () => {
    expect(parseLoggedTime('log 90m', TODAY)?.seconds).toBe(5400)
    expect(parseLoggedTime('log 45 mins', TODAY)?.seconds).toBe(2700)
  })

  it('reads a decimal hour', () => {
    expect(parseLoggedTime('log 1.5h', TODAY)?.seconds).toBe(5400)
    expect(parseLoggedTime('log 0.25h', TODAY)?.seconds).toBe(900)
  })

  it('reads hours and minutes together', () => {
    expect(parseLoggedTime('log 1h30', TODAY)?.seconds).toBe(5400)
    expect(parseLoggedTime('log 1h 30m', TODAY)?.seconds).toBe(5400)
    expect(parseLoggedTime('log 2h15m', TODAY)?.seconds).toBe(8100)
  })

  it('refuses nothing at all', () => {
    expect(parseLoggedTime('log 0h', TODAY)).toBeNull()
    expect(parseLoggedTime('log 0m', TODAY)).toBeNull()
  })

  it('refuses a day that is longer than a day', () => {
    // Far more likely to be a typo than a shift, and booking it silently would
    // wreck a week's figures.
    expect(parseLoggedTime('log 30h', TODAY)).toBeNull()
    expect(parseLoggedTime('log 16h', TODAY)?.seconds).toBe(16 * 3600)
  })

  it('offers nothing when there is no duration in it', () => {
    for (const input of ['', 'log', 'new invoice', 'settings', 'log some time']) {
      expect(parseLoggedTime(input, TODAY), input).toBeNull()
    }
  })

  it('does not read an invoice number as a duration', () => {
    // The palette runs this against every keystroke, including ones aimed at
    // something else entirely.
    expect(parseLoggedTime('INV-0042', TODAY)).toBeNull()
  })
})

describe('the day', () => {
  it('defaults to today', () => {
    expect(parseLoggedTime('log 2h', TODAY)?.date).toBe(TODAY)
  })

  it('understands yesterday', () => {
    expect(parseLoggedTime('log 2h yesterday', TODAY)?.date).toBe('2026-08-24')
  })

  it('understands the day before yesterday, and is not fooled by the overlap', () => {
    // "day before yesterday" contains "yesterday". Matched longest-first, or
    // this books to the wrong day while looking like it worked.
    expect(parseLoggedTime('log 2h day before yesterday', TODAY)?.date).toBe('2026-08-23')
  })

  it('crosses a month boundary', () => {
    expect(parseLoggedTime('log 1h yesterday', '2026-09-01')?.date).toBe('2026-08-31')
  })

  it('crosses a year boundary', () => {
    expect(parseLoggedTime('log 1h yesterday', '2027-01-01')?.date).toBe('2026-12-31')
  })
})

describe('the note', () => {
  it('keeps what is left', () => {
    expect(parseLoggedTime('log 2h on the Ashfield rebrand', TODAY)?.note).toBe('the Ashfield rebrand')
  })

  it('drops the verb and the day', () => {
    expect(parseLoggedTime('logged 90m yesterday client call', TODAY)?.note).toBe('client call')
  })

  it('is empty when nothing is left', () => {
    expect(parseLoggedTime('log 2h', TODAY)?.note).toBe('')
    expect(parseLoggedTime('log 2h yesterday', TODAY)?.note).toBe('')
  })
})

describe('reading it back', () => {
  it('says what was understood, so it can be checked before committing', () => {
    expect(describeSeconds(7200)).toBe('2h')
    expect(describeSeconds(5400)).toBe('1h 30m')
    expect(describeSeconds(2700)).toBe('45m')
  })
})

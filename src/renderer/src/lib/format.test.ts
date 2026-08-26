import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatWhen } from './format'

/**
 * When something happened.
 *
 * One thing here is a real bug rather than a preference: SQLite writes
 * `datetime('now')` as UTC with no zone marker, and `new Date('2026-08-25
 * 09:12:00')` is read as *local* time by every engine the app runs on. Through
 * a British summer that is an hour out, and every line of a timeline would
 * claim to have happened an hour before it did.
 */

afterEach(() => {
  vi.useRealTimers()
})

/** Pretend it is this moment, in a zone that is not UTC. */
function at(iso: string): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe('a SQLite timestamp', () => {
  it('is read as UTC, not as local time', () => {
    // Written at 09:00 UTC; it is now 09:30 UTC. Half an hour, not an hour and
    // a half, whatever zone the machine is in.
    at('2026-08-25T09:30:00Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('30 minutes ago')
  })

  it('says just now for the last minute', () => {
    at('2026-08-25T09:00:30Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('Just now')
  })

  it('counts in singular where it should', () => {
    at('2026-08-25T09:01:10Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('1 minute ago')

    at('2026-08-25T10:00:10Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('1 hour ago')

    at('2026-08-26T09:00:10Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('1 day ago')
  })

  it('moves up a unit at each boundary', () => {
    at('2026-08-25T11:00:00Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('2 hours ago')

    at('2026-08-28T09:00:00Z')
    expect(formatWhen('2026-08-25 09:00:00')).toBe('3 days ago')
  })

  it('gives a date once relative stops being useful', () => {
    // "23 days ago" is not something anybody converts back into a date.
    //
    // Matched on shape rather than on the exact day: the date is rendered in
    // the machine's own zone, and pinning "25 Aug" would fail on a machine far
    // enough east or west to be on the other side of midnight.
    at('2026-09-20T12:00:00Z')
    expect(formatWhen('2026-08-25 12:00:00')).toMatch(/^\d{1,2} Aug 2026$/)
  })

  it('hands back nonsense unchanged rather than showing Invalid Date', () => {
    expect(formatWhen('not a date')).toBe('not a date')
  })
})

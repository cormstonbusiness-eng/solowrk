import { describe, expect, it } from 'vitest'
import type { Settings } from '@shared/types'
import { DEFAULT_CHASE_DAYS, chaseSchedule } from './chasers'

/**
 * The chase schedule.
 *
 * The consequences of getting this wrong land on somebody else's client, in the
 * user's name, so the parsing is deliberately forgiving and pinned here. The
 * sweep that uses it is exercised against a real database in the integration
 * pass; this covers the part that turns a line of text somebody typed into a
 * decision about when to email a customer.
 */

function settingsWith(chaseDays: string, chaseEnabled = true): Settings {
  return { chaseDays, chaseEnabled } as Settings
}

describe('reading the schedule', () => {
  it('takes a plain list', () => {
    expect(chaseSchedule(settingsWith('7,14,30'))).toEqual([7, 14, 30])
  })

  it('tolerates the spaces people type', () => {
    expect(chaseSchedule(settingsWith('7, 14 , 30'))).toEqual([7, 14, 30])
  })

  it('sorts, so a schedule entered backwards still escalates', () => {
    // "30,7,14" almost certainly means the same three milestones, and chasing
    // hardest first would be the opposite of what they meant.
    expect(chaseSchedule(settingsWith('30,7,14'))).toEqual([7, 14, 30])
  })

  it('drops duplicates', () => {
    // Two chasers on the same day is one too many.
    expect(chaseSchedule(settingsWith('7,7,14'))).toEqual([7, 14])
  })

  it('ignores nonsense rather than failing', () => {
    // A schedule someone mangled by hand should chase sensibly, not stop
    // chasing — silence here would look identical to "nobody owes me anything".
    expect(chaseSchedule(settingsWith('7,banana,14'))).toEqual([7, 14])
    expect(chaseSchedule(settingsWith('7,-3,14'))).toEqual([7, 14])
  })

  it('falls back when there is nothing usable', () => {
    for (const input of ['', '   ', 'nonsense', ',,,']) {
      expect(chaseSchedule(settingsWith(input))).toEqual(DEFAULT_CHASE_DAYS)
    }
  })

  it('allows chasing on the due date itself', () => {
    // Zero is a legitimate choice for somebody who invoices on delivery.
    expect(chaseSchedule(settingsWith('0,7'))).toEqual([0, 7])
  })

  it('accepts a single milestone', () => {
    expect(chaseSchedule(settingsWith('14'))).toEqual([14])
  })
})

describe('the default', () => {
  it('escalates rather than repeating', () => {
    const gaps = DEFAULT_CHASE_DAYS.slice(1).map((day, i) => day - DEFAULT_CHASE_DAYS[i]!)
    expect(gaps.every((gap) => gap > 0)).toBe(true)
  })

  it('does not chase before the invoice is meaningfully late', () => {
    // A note the morning after payment terms expire reads as though the
    // invoice matters more than the relationship. A week is a reasonable
    // interval to have let the post, or an accounts run, happen.
    expect(DEFAULT_CHASE_DAYS[0]).toBeGreaterThanOrEqual(5)
  })
})

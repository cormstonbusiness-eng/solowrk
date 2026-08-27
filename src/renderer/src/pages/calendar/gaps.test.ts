import { describe, expect, it } from 'vitest'
import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { autoSchedule, describeAvailability, gapsAcross, gapsOn, nearestGap } from './gaps'

/** 09:00–17:30, Monday to Friday. */
const settings: CalendarSettings = {
  workingHoursStart: 540,
  workingHoursEnd: 1050,
  workingDays: 31,
  dailyCapacityMinutes: 360,
  weeklyBillableTarget: 1500,
  defaultBlockMinutes: 60,
  snapMinutes: 15,
  weekStartsOn: 0,
  defaultView: 'week',
  showWeekends: true,
  hourHeight: 56,
  timezone: 'Europe/London',
  pinTimezone: false
}

let nextId = 1
const at = (
  day: string,
  from: string,
  to: string,
  over: Partial<CalendarBlockWithContext> = {}
): CalendarBlockWithContext =>
  ({
    id: nextId,
    key: String(nextId++),
    title: 'Thing',
    blockType: 'meeting',
    startsAt: `${day}T${from}`,
    endsAt: `${day}T${to}`,
    allDay: false,
    billable: false,
    ...over
  }) as CalendarBlockWithContext

// Monday 17 August 2026.
const MON = '2026-08-17'
const TUE = '2026-08-18'
// The Saturday after it.
const SAT = '2026-08-22'

describe('the gaps in a day', () => {
  it('is the whole working day when nothing is on', () => {
    expect(gapsOn([], MON, settings)).toEqual([
      { day: MON, start: 540, end: 1050, minutes: 510 }
    ])
  })

  it('finds the hole between two things', () => {
    const gaps = gapsOn([at(MON, '09:00', '11:00'), at(MON, '14:00', '15:00')], MON, settings)
    expect(gaps).toEqual([
      { day: MON, start: 660, end: 840, minutes: 180 },
      { day: MON, start: 900, end: 1050, minutes: 150 }
    ])
  })

  it('ignores anything shorter than half an hour', () => {
    // Twenty minutes between two meetings is not availability, it is the
    // space between two meetings.
    const gaps = gapsOn(
      [at(MON, '09:00', '12:00'), at(MON, '12:20', '17:30')],
      MON,
      settings
    )
    expect(gaps).toEqual([])
  })

  it('does not let an overlapping block wind the clock backwards', () => {
    // A short meeting sitting inside a long one would otherwise make the gap
    // after it start from the short one's end — inventing free time that is
    // not free.
    const gaps = gapsOn(
      [at(MON, '09:00', '16:00'), at(MON, '10:00', '10:30')],
      MON,
      settings
    )
    expect(gaps).toEqual([{ day: MON, start: 960, end: 1050, minutes: 90 }])
  })

  it('stays inside working hours', () => {
    // A gap at 3am is not availability.
    const gaps = gapsOn([at(MON, '00:00', '23:59')], MON, settings)
    expect(gaps).toEqual([])
    expect(gapsOn([], MON, settings)[0]?.start).toBe(540)
  })

  it('has none at all on a day off', () => {
    expect(gapsOn([], SAT, settings)).toEqual([])
  })
})

describe('what counts as busy', () => {
  it('includes a dentist appointment, which is not work', () => {
    // Being at the dentist makes you unavailable without making the afternoon
    // billable. Availability and capacity are two questions sharing one grid.
    const gaps = gapsOn(
      [at(MON, '09:00', '16:00', { blockType: 'personal' })],
      MON,
      settings
    )
    expect(gaps).toEqual([{ day: MON, start: 960, end: 1050, minutes: 90 }])
  })

  it('ignores a deadline, which is a date rather than an occupation', () => {
    const gaps = gapsOn([at(MON, '09:00', '17:30', { blockType: 'deadline' })], MON, settings)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.minutes).toBe(510)
  })

  it('ignores an all-day block, which is the strip rather than the grid', () => {
    const gaps = gapsOn(
      [at(MON, '00:00', '23:59', { allDay: true })],
      MON,
      settings
    )
    expect(gaps).toHaveLength(1)
  })
})

describe('across a week', () => {
  it('skips the weekend and keeps the order', () => {
    const days = ['2026-08-17', '2026-08-18', SAT]
    const gaps = gapsAcross([at('2026-08-18', '09:00', '17:30')], days, settings)
    expect(gaps.map((gap) => gap.day)).toEqual(['2026-08-17'])
  })
})

describe('smart drop', () => {
  const gaps = [
    { day: MON, start: 540, end: 600, minutes: 60 },
    { day: MON, start: 840, end: 960, minutes: 120 },
    { day: '2026-08-18', start: 540, end: 1050, minutes: 510 }
  ]

  it('lands in the nearest hole that fits', () => {
    // Dragged roughly at half past one; the two-hour hole at 14:00 fits.
    const found = nearestGap(gaps, { day: MON, minutes: 810 }, 90)
    expect(found).toMatchObject({ start: 840 })
  })

  it('refuses a hole too small for the thing', () => {
    // Snapping into a hole it does not fit would look tidy and be wrong.
    const found = nearestGap(gaps, { day: MON, minutes: 550 }, 90)
    expect(found).toMatchObject({ start: 840 })
  })

  it('gives up rather than moving it to a different week', () => {
    expect(nearestGap(gaps, { day: MON, minutes: 550 }, 600)).toBeNull()
  })

  it('never crosses a day to find a nearer hole', () => {
    // Dropping on Tuesday must land on Tuesday, even when a Monday hole is
    // closer in minutes.
    const found = nearestGap(gaps, { day: '2026-08-18', minutes: 950 }, 60)
    expect(found?.day).toBe('2026-08-18')
  })

  it('counts a drop inside a gap as being in it', () => {
    const found = nearestGap(gaps, { day: MON, minutes: 900 }, 60)
    expect(found).toMatchObject({ start: 840 })
  })
})

describe('filling the gaps', () => {
  const gaps = [
    { day: MON, start: 540, end: 660, minutes: 120 },
    { day: TUE, start: 540, end: 1050, minutes: 510 }
  ]

  it('places work in the earliest hole it fits', () => {
    const placed = autoSchedule(
      [{ id: 1, title: 'Write the copy', estimateMinutes: 90, dueAt: null }],
      gaps,
      60
    )
    expect(placed).toEqual([
      { taskId: 1, title: 'Write the copy', day: MON, start: 540, minutes: 90 }
    ])
  })

  it('fits a second task into what is left of the same hole', () => {
    const placed = autoSchedule(
      [
        { id: 1, title: 'One', estimateMinutes: 60, dueAt: null },
        { id: 2, title: 'Two', estimateMinutes: 60, dueAt: null }
      ],
      gaps,
      60
    )
    expect(placed.map((one) => [one.day, one.start])).toEqual([
      [MON, 540],
      [MON, 600]
    ])
  })

  it('moves on to the next day when the hole is used up', () => {
    const placed = autoSchedule(
      [
        { id: 1, title: 'One', estimateMinutes: 120, dueAt: null },
        { id: 2, title: 'Two', estimateMinutes: 120, dueAt: null }
      ],
      gaps,
      60
    )
    expect(placed[1]?.day).toBe(TUE)
  })

  it('never schedules work after the day it is due', () => {
    // Putting it past the deadline is worse than leaving it unscheduled,
    // because it looks handled.
    const placed = autoSchedule(
      [{ id: 1, title: 'Late', estimateMinutes: 480, dueAt: MON }],
      gaps,
      60
    )
    expect(placed).toEqual([])
  })

  it('leaves alone anything that will not fit anywhere', () => {
    const placed = autoSchedule(
      [{ id: 1, title: 'Enormous', estimateMinutes: 900, dueAt: null }],
      gaps,
      60
    )
    expect(placed).toEqual([])
  })

  it('uses the default length for a task nobody estimated', () => {
    const placed = autoSchedule([{ id: 1, title: 'Vague', estimateMinutes: null, dueAt: null }], gaps, 45)
    expect(placed[0]?.minutes).toBe(45)
  })

  it('never touches the gaps it was given', () => {
    // The caller still needs them: the radar is drawn from the same array.
    const before = JSON.stringify(gaps)
    autoSchedule([{ id: 1, title: 'One', estimateMinutes: 60, dueAt: null }], gaps, 60)
    expect(JSON.stringify(gaps)).toBe(before)
  })
})

describe('the availability message', () => {
  const label = (day: string): string => day

  it('writes the sentence people type by hand', () => {
    const text = describeAvailability(
      [
        { day: MON, start: 540, end: 720, minutes: 180 },
        { day: MON, start: 840, end: 1020, minutes: 180 },
        { day: '2026-08-18', start: 540, end: 780, minutes: 240 }
      ],
      label,
      480
    )

    expect(text).toBe(
      `${MON} — 09:00–12:00, 14:00–17:00\n2026-08-18 — 09:00–13:00`
    )
  })

  it('says "all day" rather than reading working hours back at somebody', () => {
    const text = describeAvailability([{ day: MON, start: 540, end: 1050, minutes: 510 }], label, 480)
    expect(text).toBe(`${MON} — all day`)
  })

  it('is empty when there is nothing free', () => {
    expect(describeAvailability([], label, 480)).toBe('')
  })
})

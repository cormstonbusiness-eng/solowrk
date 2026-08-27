import { describe, expect, it } from 'vitest'
import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { alpha, blockValue, moneyFill, peakRateOf, readoutFor, surfaceFor } from './lens'
import type { LensContext } from './lens'

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
  hourHeight: 56
}

const block = (over: Partial<CalendarBlockWithContext> = {}): CalendarBlockWithContext =>
  ({
    id: 1,
    key: '1',
    title: 'Work',
    description: '',
    location: '',
    blockType: 'focus',
    startsAt: '2026-08-17T09:00',
    endsAt: '2026-08-17T11:00',
    allDay: false,
    timezone: 'Europe/London',
    projectId: null,
    clientId: null,
    taskId: null,
    colour: '',
    billable: true,
    recurrenceRule: null,
    recurrenceParentId: null,
    recurrenceExdates: [],
    source: 'local',
    sourceUid: null,
    sourceCalendarId: null,
    locked: false,
    meetingUrl: '',
    reminderMinutes: null,
    remindedAt: null,
    archived: false,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    projectName: null,
    projectColour: null,
    clientName: null,
    taskTitle: null,
    trackedMinutes: 0,
    rate: 6000,
    occurrenceOf: null,
    displayColour: '#FF7A2F',
    ...over
  }) as CalendarBlockWithContext

const context = (over: Partial<LensContext> = {}): LensContext => ({
  settings,
  focusClientId: null,
  peakRate: 10000,
  ...over
})

describe('a lens never moves anything', () => {
  it('returns paint and nothing else', () => {
    // The whole idea rests on there being one grid. A lens that could return
    // a position would eventually return the wrong one.
    const surface = surfaceFor(block(), 'money', context())
    expect(Object.keys(surface).sort()).toEqual([
      'colour',
      'fill',
      'level',
      'opacity',
      'outlined',
      'overrun'
    ])
  })
})

describe('the Money lens', () => {
  it('makes a more valuable hour louder', () => {
    const cheap = moneyFill(block({ rate: 2000 }), 10000)
    const dear = moneyFill(block({ rate: 10000 }), 10000)
    expect(dear).toBeGreaterThan(cheap)
  })

  it('never fades paid work to nothing', () => {
    // A cheap job is still a job. Fading it out would make a paid afternoon
    // look like an empty one.
    expect(moneyFill(block({ rate: 100 }), 100000)).toBeGreaterThan(0.1)
  })

  it('gives unpaid work almost nothing, but not zero', () => {
    const unpaid = moneyFill(block({ billable: false, rate: 6000 }), 10000)
    expect(unpaid).toBeLessThan(0.1)
    expect(unpaid).toBeGreaterThan(0)
  })

  it('scales against the best hour in view, not an invented number', () => {
    // £45 an hour is a good day for one person and a bad one for another.
    const modest = moneyFill(block({ rate: 4500 }), 4500)
    const same = moneyFill(block({ rate: 45000 }), 45000)
    expect(modest).toBeCloseTo(same)
  })

  it('copes with a week where nothing has a rate', () => {
    expect(moneyFill(block({ rate: 0 }), 0)).toBeGreaterThan(0)
    expect(peakRateOf([block({ billable: false })])).toBe(0)
  })

  it('values a block by its length', () => {
    // Two hours at £60 is £120.
    expect(blockValue(block())).toBe(12000)
  })

  it('values unpaid work at nothing, whatever its rate', () => {
    expect(blockValue(block({ billable: false }))).toBe(0)
  })

  it('says what a day was worth', () => {
    const readout = readoutFor([block(), block({ rate: 3000 })], '2026-08-17', 'money', context())
    // £120 and £60.
    expect(readout.text).toBe('£180')
  })

  it('says nothing at all for a day that earned nothing', () => {
    const readout = readoutFor(
      [block({ billable: false })],
      '2026-08-17',
      'money',
      context()
    )
    expect(readout.text).toBe('')
  })
})

describe('the Capacity lens', () => {
  it('sorts work into billable, other and personal', () => {
    expect(surfaceFor(block(), 'capacity', context()).colour).toBe('#FF7A2F')
    expect(surfaceFor(block({ billable: false, blockType: 'admin' }), 'capacity', context()).colour)
      .toBe('#3B82F6')
    expect(
      surfaceFor(block({ billable: false, blockType: 'personal' }), 'capacity', context()).colour
    ).toBe('#8B7BE5')
  })

  it('says when a day is over', () => {
    // Seven hours against a six-hour capacity.
    const long = block({ startsAt: '2026-08-17T09:00', endsAt: '2026-08-17T16:00' })
    const readout = readoutFor([long], '2026-08-17', 'capacity', context())
    expect(readout).toMatchObject({ text: '7h', over: true })
  })

  it('leaves a day off out of the committed figure', () => {
    // Counting a week off as sixty committed hours would make the number say
    // the opposite of the truth.
    const holiday = block({
      blockType: 'holiday',
      billable: false,
      startsAt: '2026-08-17T09:00',
      endsAt: '2026-08-17T17:00'
    })
    expect(readoutFor([holiday], '2026-08-17', 'capacity', context()).text).toBe('')
  })
})

describe('the Client lens', () => {
  it('drops everybody else back without hiding them', () => {
    // You are looking for their hours *among* everything else. Hiding the
    // rest would lose the context that makes it useful.
    const theirs = surfaceFor(block({ clientId: 7 }), 'client', context({ focusClientId: 7 }))
    const other = surfaceFor(block({ clientId: 9 }), 'client', context({ focusClientId: 7 }))

    expect(theirs.opacity).toBe(1)
    expect(other.opacity).toBeGreaterThan(0)
    expect(other.opacity).toBeLessThan(0.25)
  })

  it('dims nothing until a client is chosen', () => {
    expect(surfaceFor(block({ clientId: 9 }), 'client', context()).opacity).toBe(1)
  })

  it('reads their hours and what they are worth', () => {
    const readout = readoutFor(
      [block({ clientId: 7 }), block({ clientId: 9 })],
      '2026-08-17',
      'client',
      context({ focusClientId: 7 })
    )
    expect(readout.text).toBe('2h · £120')
  })
})

describe('the Actual lens', () => {
  it('draws an empty shell for a plan nobody has acted on', () => {
    const surface = surfaceFor(block({ trackedMinutes: 0 }), 'actual', context())
    expect(surface).toMatchObject({ outlined: true, level: 0, overrun: 0 })
  })

  it('fills it as time is logged', () => {
    // Two hours planned, one logged.
    const surface = surfaceFor(block({ trackedMinutes: 60 }), 'actual', context())
    expect(surface.level).toBeCloseTo(0.5)
    expect(surface.overrun).toBe(0)
  })

  it('caps the fill and reports the overflow separately', () => {
    // Three hours logged against two planned: the shell is full and half an
    // hour of it bleeds past the edge.
    const surface = surfaceFor(block({ trackedMinutes: 180 }), 'actual', context())
    expect(surface.level).toBe(1)
    expect(surface.overrun).toBeCloseTo(0.5)
  })

  it('reads the variance rather than the raw figures', () => {
    const readout = readoutFor([block({ trackedMinutes: 180 })], '2026-08-17', 'actual', context())
    expect(readout).toMatchObject({ text: '+1h', over: true })
  })

  it('says the plain figure when the plan held exactly', () => {
    const readout = readoutFor([block({ trackedMinutes: 120 })], '2026-08-17', 'actual', context())
    expect(readout).toMatchObject({ text: '2h', over: false })
  })
})

describe('alpha', () => {
  it('turns a fraction into two hex digits', () => {
    expect(alpha(0)).toBe('00')
    expect(alpha(1)).toBe('ff')
    expect(alpha(0.18)).toHaveLength(2)
  })

  it('clamps rather than producing something unparseable', () => {
    expect(alpha(-1)).toBe('00')
    expect(alpha(5)).toBe('ff')
  })
})

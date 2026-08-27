import { describe, expect, it } from 'vitest'
import type { CalendarBlockWithContext } from '@shared/types'
import { applyScenario, emptyScenario, scenarioDelta } from './scenario'

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
    title: 'Work',
    blockType: 'focus',
    startsAt: `${day}T${from}`,
    endsAt: `${day}T${to}`,
    allDay: false,
    billable: true,
    rate: 6000,
    clientId: null,
    ...over
  }) as CalendarBlockWithContext

const MON = '2026-08-17'
const TUE = '2026-08-18'
const week = [MON, TUE]

describe('a scenario never touches reality', () => {
  it('leaves the actual week exactly as it was', () => {
    const actual = [at(MON, '09:00', '11:00')]
    const before = JSON.stringify(actual)

    applyScenario(actual, {
      name: 'What if',
      edits: [{ kind: 'move', key: actual[0]!.key, startsAt: `${TUE}T14:00`, endsAt: `${TUE}T16:00` }]
    })

    // The real week has to still be there underneath — both to compare
    // against and to go back to.
    expect(JSON.stringify(actual)).toBe(before)
  })

  it('is the week unchanged when nothing has been done to it', () => {
    const actual = [at(MON, '09:00', '11:00')]
    expect(applyScenario(actual, emptyScenario())).toHaveLength(1)
  })
})

describe('editing a scenario', () => {
  it('adds a block', () => {
    const scenario = applyScenario([], {
      name: 'With Marsh job',
      edits: [{ kind: 'add', block: at(MON, '09:00', '17:00') }]
    })
    expect(scenario).toHaveLength(1)
  })

  it('moves one', () => {
    const actual = [at(MON, '09:00', '11:00')]
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [{ kind: 'move', key: actual[0]!.key, startsAt: `${TUE}T14:00`, endsAt: `${TUE}T16:00` }]
    })
    expect(scenario[0]).toMatchObject({ startsAt: `${TUE}T14:00`, endsAt: `${TUE}T16:00` })
  })

  it('removes one', () => {
    const actual = [at(MON, '09:00', '11:00'), at(TUE, '09:00', '11:00')]
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [{ kind: 'remove', key: actual[0]!.key }]
    })
    expect(scenario).toHaveLength(1)
  })

  it('applies edits in order, so a block added then moved lands where it was moved', () => {
    const added = at(MON, '09:00', '11:00')
    const scenario = applyScenario([], {
      name: 'x',
      edits: [
        { kind: 'add', block: added },
        { kind: 'move', key: added.key, startsAt: `${TUE}T15:00`, endsAt: `${TUE}T17:00` }
      ]
    })
    expect(scenario[0]?.startsAt).toBe(`${TUE}T15:00`)
  })

  it('comes back in time order however it was built', () => {
    const scenario = applyScenario([at(TUE, '09:00', '10:00')], {
      name: 'x',
      edits: [{ kind: 'add', block: at(MON, '09:00', '10:00') }]
    })
    expect(scenario.map((one) => one.startsAt.slice(0, 10))).toEqual([MON, TUE])
  })
})

describe('the delta', () => {
  const capacity = 360

  it('says the hours and the money', () => {
    const actual = [at(MON, '09:00', '11:00')]
    const scenario = applyScenario(actual, {
      name: 'x',
      // Six more hours at £60.
      edits: [{ kind: 'add', block: at(TUE, '09:00', '15:00') }]
    })

    const delta = scenarioDelta(actual, scenario, week, capacity)
    expect(delta.minutes).toBe(360)
    expect(delta.pence).toBe(36000)
  })

  it('goes negative when the scenario takes work away', () => {
    const actual = [at(MON, '09:00', '11:00')]
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [{ kind: 'remove', key: actual[0]!.key }]
    })

    const delta = scenarioDelta(actual, scenario, week, capacity)
    expect(delta.minutes).toBe(-120)
    expect(delta.pence).toBe(-12000)
  })

  it('names the day the scenario breaks', () => {
    const actual = [at(MON, '09:00', '11:00')]
    const scenario = applyScenario(actual, {
      // Seven hours on Monday, against a six-hour capacity.
      name: 'x',
      edits: [{ kind: 'add', block: at(MON, '11:00', '16:00') }]
    })

    const delta = scenarioDelta(actual, scenario, week, capacity)
    expect(delta.newlyOver).toEqual([{ day: MON, overBy: 60 }])
  })

  it('does not re-report a day that was already over', () => {
    // Saying it again would bury the one thing that actually changed.
    const actual = [at(MON, '09:00', '18:00')]
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [{ kind: 'add', block: at(TUE, '09:00', '10:00') }]
    })

    expect(scenarioDelta(actual, scenario, week, capacity).newlyOver).toEqual([])
  })

  it('leaves unpaid work out of the money and in the hours', () => {
    const actual: CalendarBlockWithContext[] = []
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [{ kind: 'add', block: at(MON, '09:00', '11:00', { billable: false }) }]
    })

    const delta = scenarioDelta(actual, scenario, week, capacity)
    expect(delta.minutes).toBe(120)
    expect(delta.pence).toBe(0)
  })

  it('ignores a day off, as every other figure does', () => {
    const actual: CalendarBlockWithContext[] = []
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [
        {
          kind: 'add',
          block: at(MON, '09:00', '17:00', { blockType: 'holiday', billable: false })
        }
      ]
    })

    expect(scenarioDelta(actual, scenario, week, capacity).minutes).toBe(0)
  })

  it('ignores anything outside the range being considered', () => {
    const actual: CalendarBlockWithContext[] = []
    const scenario = applyScenario(actual, {
      name: 'x',
      edits: [{ kind: 'add', block: at('2026-09-15', '09:00', '17:00') }]
    })

    expect(scenarioDelta(actual, scenario, week, capacity).minutes).toBe(0)
  })
})

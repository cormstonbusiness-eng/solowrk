import type { CalendarBlockWithContext } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import { minutesBetween } from '@shared/calendar'
import { blockValue } from './lens'

/**
 * "Can I take this on?"
 *
 * §17.4. The single most stressful question in freelancing, and the one every
 * tool in this market leaves you to answer by guessing. A scenario forks the
 * visible week into a scratch layer: drag, add and delete freely, watch the
 * difference against reality, then apply it as one undoable transaction or
 * discard it with no trace.
 *
 * The whole thing is held in memory and nothing here touches the database.
 * That is not an implementation shortcut, it is the feature: a scenario that
 * wrote as it went would be indistinguishable from just editing your calendar
 * badly, and the reason people would trust it is precisely that it cannot.
 */

export type ScenarioEdit =
  | { kind: 'add'; block: CalendarBlockWithContext }
  | { kind: 'move'; key: string; startsAt: string; endsAt: string }
  | { kind: 'remove'; key: string }

export interface Scenario {
  name: string
  edits: ScenarioEdit[]
}

export function emptyScenario(name = 'Scenario'): Scenario {
  return { name, edits: [] }
}

/**
 * The week as the scenario has it.
 *
 * Applied in order, so a block added and then moved lands where it was moved
 * to. Real blocks are copied rather than mutated — the actual week has to
 * still be there underneath, both to compare against and to go back to.
 */
export function applyScenario(
  actual: CalendarBlockWithContext[],
  scenario: Scenario
): CalendarBlockWithContext[] {
  let working = actual.map((block) => ({ ...block }))

  for (const edit of scenario.edits) {
    if (edit.kind === 'add') {
      working.push({ ...edit.block })
      continue
    }
    if (edit.kind === 'remove') {
      working = working.filter((block) => block.key !== edit.key)
      continue
    }
    working = working.map((block) =>
      block.key === edit.key
        ? { ...block, startsAt: edit.startsAt, endsAt: edit.endsAt }
        : block
    )
  }

  return working.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export interface Delta {
  /** Committed minutes, scenario minus reality. */
  minutes: number
  /** Integer pence, scenario minus reality. */
  pence: number
  /** Days that are over capacity in the scenario but were not before. */
  newlyOver: { day: string; overBy: number }[]
}

/**
 * The difference, said in the three terms that actually decide the answer.
 *
 * Hours, money, and which day breaks. "+6h committed · +£720 · Thu now 3h
 * over" is a sentence somebody can act on; two grids side by side is a puzzle
 * they have to solve first.
 */
export function scenarioDelta(
  actual: CalendarBlockWithContext[],
  scenario: CalendarBlockWithContext[],
  days: string[],
  dailyCapacity: number
): Delta {
  const before = summarise(actual, days)
  const after = summarise(scenario, days)

  const newlyOver: { day: string; overBy: number }[] = []
  for (const day of days) {
    const wasOver = (before.perDay.get(day) ?? 0) > dailyCapacity
    const nowMinutes = after.perDay.get(day) ?? 0
    // Only days the scenario *breaks*. A day that was already over stays
    // over, and reporting it again would bury the one thing that changed.
    if (!wasOver && dailyCapacity > 0 && nowMinutes > dailyCapacity) {
      newlyOver.push({ day, overBy: nowMinutes - dailyCapacity })
    }
  }

  return {
    minutes: after.minutes - before.minutes,
    pence: after.pence - before.pence,
    newlyOver
  }
}

function summarise(
  blocks: CalendarBlockWithContext[],
  days: string[]
): { minutes: number; pence: number; perDay: Map<string, number> } {
  const inRange = new Set(days)
  const perDay = new Map<string, number>()
  let minutes = 0
  let pence = 0

  for (const block of blocks) {
    const day = block.startsAt.slice(0, 10)
    if (!inRange.has(day)) continue
    if (!blockTypeMeta(block.blockType).counts) continue

    const length = minutesBetween(block.startsAt, block.endsAt)
    minutes += length
    pence += blockValue(block)
    perDay.set(day, (perDay.get(day) ?? 0) + length)
  }

  return { minutes, pence, perDay }
}

/** Whether a key names a block the scenario invented rather than a real row. */
export function isScenarioBlock(key: string): boolean {
  return key.startsWith('scenario-')
}

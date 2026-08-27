import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import { minutesBetween, segmentOn } from '@shared/calendar'
import type { Lens } from './keys'
import { durationLabel } from './grid'

/**
 * The same week, seen differently.
 *
 * There is **one grid**. Nothing here moves, resizes or reflows a block — a
 * lens changes only its surface and what the day header reads, so switching
 * reads as the same week under a different light rather than as a new screen.
 * That constraint is the whole idea, and it is why this file returns paint
 * rather than layout: there is no way for a lens to accidentally rearrange
 * anything, because it is never given the chance.
 *
 * Pure, and tested, because "high-value work is visually louder" is a claim
 * about arithmetic on a scale nobody can eyeball, and a lens that got its
 * scaling wrong would be quietly lying about somebody's week.
 */

export type { Lens }

export const LENSES: { value: Lens; label: string; hint: string }[] = [
  { value: 'time', label: 'Time', hint: 'Project colour, hours committed' },
  { value: 'money', label: 'Money', hint: 'What each day is worth' },
  { value: 'capacity', label: 'Capacity', hint: 'Billable against the rest' },
  { value: 'actual', label: 'Actual', hint: 'Planned against logged' },
  { value: 'client', label: 'Client', hint: 'One client, everything else quiet' }
]

/** How a block is painted. Never where it is or how big. */
export interface Surface {
  /** The block's colour under this lens. */
  colour: string
  /** 0–1. The fill, before it becomes an alpha channel. */
  fill: number
  /** 0–1. The whole block's opacity — what pushes others into the background. */
  opacity: number
  /**
   * How much of the block is filled from the top, 0–1, or null for a solid
   * fill. The Actual lens uses it as a liquid level.
   */
  level: number | null
  /** Over 1 when logged time ran past the plan. Drawn bleeding past the edge. */
  overrun: number
  /** A hairline shell rather than a filled block. */
  outlined: boolean
}

export interface LensContext {
  settings: CalendarSettings
  /** The client the Client lens is looking at. Null dims nothing. */
  focusClientId: number | null
  /** The most any one block is worth per hour in view, for the Money scale. */
  peakRate: number
}

/** Pence an hour of this block earns. Non-billable work earns nothing. */
export function hourlyValue(block: CalendarBlockWithContext): number {
  return block.billable ? block.rate : 0
}

/** Pence this block is worth in total. */
export function blockValue(block: CalendarBlockWithContext): number {
  if (!block.billable) return 0
  return Math.round((minutesBetween(block.startsAt, block.endsAt) / 60) * block.rate)
}

/**
 * The fill a block gets in the Money lens.
 *
 * Scaled against the most valuable hour in view rather than against an
 * absolute figure, because £45/hour is a good day for one person and a bad
 * one for another, and a scale anchored to a number we invented would be
 * meaningless to both. The floor is deliberate: work worth *something* must
 * never fade to nothing, or a cheap job would look like an empty afternoon.
 */
export function moneyFill(block: CalendarBlockWithContext, peakRate: number): number {
  const value = hourlyValue(block)
  if (value <= 0) return 0.06
  if (peakRate <= 0) return 0.35
  return 0.12 + 0.5 * Math.min(1, value / peakRate)
}

/** The colours the Capacity lens sorts work into. */
const CAPACITY_COLOURS = {
  billable: '#FF7A2F',
  other: '#3B82F6',
  personal: '#8B7BE5'
} as const

export function surfaceFor(
  block: CalendarBlockWithContext,
  lens: Lens,
  context: LensContext
): Surface {
  const base: Surface = {
    colour: block.displayColour,
    fill: 0.18,
    opacity: 1,
    level: null,
    overrun: 0,
    outlined: false
  }

  switch (lens) {
    case 'time':
      return base

    case 'money':
      return { ...base, fill: moneyFill(block, context.peakRate) }

    case 'capacity': {
      const meta = blockTypeMeta(block.blockType)
      const colour = block.billable
        ? CAPACITY_COLOURS.billable
        : meta.counts
          ? CAPACITY_COLOURS.other
          : CAPACITY_COLOURS.personal
      return { ...base, colour, fill: 0.22 }
    }

    case 'actual': {
      const planned = minutesBetween(block.startsAt, block.endsAt)
      // Nothing logged is an empty shell, which is the honest picture of a
      // plan nobody has acted on yet.
      const ratio = planned > 0 ? block.trackedMinutes / planned : 0
      return {
        ...base,
        outlined: true,
        fill: 0.3,
        level: Math.min(1, ratio),
        overrun: Math.max(0, ratio - 1)
      }
    }

    case 'client': {
      if (context.focusClientId === null) return base
      // 15%, so the rest of the week is still legible as shape without
      // competing. Hiding it would lose the context that makes the lens
      // useful — you are looking for their hours *among* everything else.
      const theirs = block.clientId === context.focusClientId
      return { ...base, opacity: theirs ? 1 : 0.15 }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The day header
 * ------------------------------------------------------------------ */

export interface DayReadout {
  /** The figure itself. Empty for a day with nothing to say. */
  text: string
  /** True when the day is over what it should be — drawn in danger. */
  over: boolean
  /** 0–1 for the bar under the figure, or null for no bar. */
  fraction: number | null
}

const money = (pence: number): string =>
  `£${Math.round(pence / 100).toLocaleString('en-GB')}`

/**
 * What one day says under a given lens.
 *
 * The day header is the only other thing a lens changes, and it is where most
 * of the value is: seeing that Tuesday was worth £480 and Wednesday £90 is
 * the whole point of the Money lens, and no report does it because a report
 * is not the thing people look at ten times a day.
 */
export function readoutFor(
  blocks: CalendarBlockWithContext[],
  day: string,
  lens: Lens,
  context: LensContext
): DayReadout {
  const onDay = blocks.filter((block) => !block.allDay)
  const minutes = (block: CalendarBlockWithContext): number => {
    const segment = segmentOn(block, day)
    return segment.end - segment.start
  }

  if (lens === 'money') {
    const pence = onDay.reduce(
      (total, block) => total + Math.round((minutes(block) / 60) * hourlyValue(block)),
      0
    )
    return { text: pence === 0 ? '' : money(pence), over: false, fraction: null }
  }

  if (lens === 'client') {
    if (context.focusClientId === null) return committed(onDay, minutes, context)
    const theirs = onDay.filter((block) => block.clientId === context.focusClientId)
    const total = theirs.reduce((sum, block) => sum + minutes(block), 0)
    const pence = theirs.reduce(
      (sum, block) => sum + Math.round((minutes(block) / 60) * hourlyValue(block)),
      0
    )
    if (total === 0) return { text: '', over: false, fraction: null }
    return {
      text: pence > 0 ? `${durationLabel(total)} · ${money(pence)}` : durationLabel(total),
      over: false,
      fraction: null
    }
  }

  if (lens === 'actual') {
    const planned = onDay.reduce((sum, block) => sum + minutes(block), 0)
    const logged = onDay.reduce((sum, block) => sum + block.trackedMinutes, 0)
    if (planned === 0 && logged === 0) return { text: '', over: false, fraction: null }
    const variance = logged - planned
    return {
      text:
        variance === 0
          ? durationLabel(planned)
          : `${variance > 0 ? '+' : '−'}${durationLabel(Math.abs(variance))}`,
      over: variance > 0,
      fraction: planned > 0 ? Math.min(1, logged / planned) : null
    }
  }

  return committed(onDay, minutes, context)
}

/**
 * Hours committed, which is what both the Time and Capacity lenses read.
 *
 * Personal and holiday blocks are left out here as everywhere else: they make
 * you unavailable, but counting a week off as sixty committed hours would
 * make the figure say the opposite of the truth.
 */
function committed(
  blocks: CalendarBlockWithContext[],
  minutes: (block: CalendarBlockWithContext) => number,
  context: LensContext
): DayReadout {
  const total = blocks
    .filter((block) => blockTypeMeta(block.blockType).counts)
    .reduce((sum, block) => sum + minutes(block), 0)

  const capacity = context.settings.dailyCapacityMinutes
  if (total === 0) return { text: '', over: false, fraction: null }

  return {
    text: durationLabel(total),
    over: capacity > 0 && total > capacity,
    fraction: capacity > 0 ? Math.min(1, total / capacity) : null
  }
}

/** The most valuable hour in view, which is what the Money lens scales against. */
export function peakRateOf(blocks: CalendarBlockWithContext[]): number {
  return blocks.reduce((highest, block) => Math.max(highest, hourlyValue(block)), 0)
}

/** An alpha suffix for a hex colour, from a 0–1 fill. */
export function alpha(fraction: number): string {
  const value = Math.round(Math.max(0, Math.min(1, fraction)) * 255)
  return value.toString(16).padStart(2, '0')
}

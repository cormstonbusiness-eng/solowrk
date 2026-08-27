/**
 * The lead pipeline.
 *
 * §12 calls this "the pipeline that stops the feast-and-famine cycle", which
 * is the whole reason it exists: freelance work arrives in clumps, and the
 * gaps are made of the fortnights nobody spent looking for the next job.
 *
 * **The one rule that matters is the next action.** A lead with no next action
 * and a date on it is not a lead, it is a memory — and it is exactly the lead
 * that goes quiet for six weeks and then turns up as somebody else's client.
 * So a lead without one is flagged, in `danger`, permanently, and nothing in
 * here lets that flag be turned off by any means other than deciding what to
 * do next. That is the entire discipline of pipeline management, and it is one
 * rule.
 */

export const STAGES = ['lead', 'contacted', 'conversation', 'proposal', 'won', 'lost'] as const
export type Stage = (typeof STAGES)[number]

/** The columns on the board. Won and lost leave it. */
export const OPEN_STAGES: Stage[] = ['lead', 'contacted', 'conversation', 'proposal']

export const STAGE_LABELS: Record<Stage, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  conversation: 'Conversation',
  proposal: 'Proposal sent',
  won: 'Won',
  lost: 'Lost'
}

/**
 * How likely each stage is to close, in basis points.
 *
 * Rules of thumb, not measurements — which is why the weighted figure is shown
 * beside the raw one rather than instead of it. A single number claiming to
 * know what a conversation is worth would be a more confident lie than a
 * freelancer with eleven leads can support.
 *
 * Exported so these can become settings later without moving the arithmetic.
 */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  lead: 1000,
  contacted: 2000,
  conversation: 4000,
  proposal: 6000,
  won: 10_000,
  lost: 0
}

/**
 * Why a lead was lost, from a fixed list.
 *
 * Fixed because free text cannot be counted, and the point of asking is the
 * count: knowing you lose 60% on price is actionable, and "we lost some" is
 * not. `other` exists so the list never forces a wrong answer, and a note
 * carries the detail.
 */
export const LOST_REASONS = [
  'price',
  'timing',
  'went-elsewhere',
  'went-quiet',
  'in-house',
  'not-a-fit',
  'other'
] as const

export type LostReason = (typeof LOST_REASONS)[number]

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: 'Too expensive',
  timing: 'Wrong time',
  'went-elsewhere': 'Went to someone else',
  'went-quiet': 'Went quiet',
  'in-house': 'Doing it in-house',
  'not-a-fit': 'Not a fit',
  other: 'Something else'
}

/* ------------------------------------------------------------------ *
 * How a lead is doing
 * ------------------------------------------------------------------ */

/**
 * `adrift` is the one that matters: no next action at all.
 *
 * Deliberately worse than `overdue`. An overdue action is a thing somebody
 * decided to do and has not done yet; no action is a lead nobody has decided
 * anything about, and that is how leads are actually lost.
 */
export type LeadHealth = 'adrift' | 'overdue' | 'today' | 'soon' | 'scheduled' | 'closed'

export interface LeadLike {
  stage: Stage
  nextActionOn: string | null
  nextAction: string
}

export function leadHealth(lead: LeadLike, asOf: string): LeadHealth {
  if (lead.stage === 'won' || lead.stage === 'lost') return 'closed'

  // A date with no action against it is not a plan, and neither is an action
  // with no date. Both are adrift.
  if (!lead.nextActionOn || lead.nextAction.trim() === '') return 'adrift'

  if (lead.nextActionOn < asOf) return 'overdue'
  if (lead.nextActionOn === asOf) return 'today'

  return daysBetween(asOf, lead.nextActionOn) <= 7 ? 'soon' : 'scheduled'
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  )
}

/* ------------------------------------------------------------------ *
 * What the pipeline is worth
 * ------------------------------------------------------------------ */

export interface StageTotal {
  stage: Stage
  count: number
  /** Sum of estimated values, in pence. */
  value: number
  /** Value × the stage's probability. */
  weighted: number
}

export interface PipelineValue {
  byStage: StageTotal[]
  /** Open stages only — won and lost are history, not pipeline. */
  total: number
  weighted: number
  /** Open leads with no next action. The number to act on. */
  adrift: number
}

export function pipelineValue(
  leads: readonly (LeadLike & { value: number | null })[],
  asOf: string
): PipelineValue {
  const byStage: StageTotal[] = STAGES.map((stage) => {
    const inStage = leads.filter((lead) => lead.stage === stage)
    const value = inStage.reduce((sum, lead) => sum + (lead.value ?? 0), 0)

    return {
      stage,
      count: inStage.length,
      value,
      weighted: Math.round((value * STAGE_PROBABILITY[stage]) / 10_000)
    }
  })

  const open = byStage.filter((one) => OPEN_STAGES.includes(one.stage))

  return {
    byStage,
    total: open.reduce((sum, one) => sum + one.value, 0),
    weighted: open.reduce((sum, one) => sum + one.weighted, 0),
    adrift: leads.filter((lead) => leadHealth(lead, asOf) === 'adrift').length
  }
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

export interface SourceTotal {
  source: string
  leads: number
  won: number
  /** Value of the won ones, in pence. */
  value: number
  /** Basis points, so 3300 is a third. Null when nothing has closed either way. */
  conversion: number | null
}

/**
 * Which sources actually produce work.
 *
 * Conversion counts only leads that have *closed* — counting open leads as
 * losses would report every source as failing for as long as it is working,
 * and would make a source that has just started look like the worst one.
 */
export function bySource(
  leads: readonly { source: string; stage: Stage; value: number | null }[]
): SourceTotal[] {
  const found = new Map<string, SourceTotal & { closed: number }>()

  for (const lead of leads) {
    const source = lead.source.trim() === '' ? 'Unknown' : lead.source
    const entry = found.get(source) ?? {
      source,
      leads: 0,
      won: 0,
      value: 0,
      conversion: null,
      closed: 0
    }

    entry.leads += 1
    if (lead.stage === 'won') {
      entry.won += 1
      entry.value += lead.value ?? 0
    }
    if (lead.stage === 'won' || lead.stage === 'lost') entry.closed += 1

    found.set(source, entry)
  }

  return [...found.values()]
    .map(({ closed, ...one }) => ({
      ...one,
      conversion: closed > 0 ? Math.round((one.won / closed) * 10_000) : null
    }))
    .sort((a, b) => b.value - a.value || b.leads - a.leads)
}

export interface LostBreakdown {
  reason: LostReason
  count: number
  /** Value walked away from, in pence. */
  value: number
  /** Share of all losses, in basis points. */
  share: number
}

export function lostReasons(
  leads: readonly { stage: Stage; lostReason: LostReason | null; value: number | null }[]
): LostBreakdown[] {
  const lost = leads.filter((lead) => lead.stage === 'lost')
  if (lost.length === 0) return []

  const found = new Map<LostReason, { count: number; value: number }>()

  for (const lead of lost) {
    // A lost lead with no reason recorded still counts, under `other`. Dropping
    // it would quietly shrink the denominator and flatter every percentage.
    const reason = lead.lostReason ?? 'other'
    const entry = found.get(reason) ?? { count: 0, value: 0 }
    entry.count += 1
    entry.value += lead.value ?? 0
    found.set(reason, entry)
  }

  return [...found.entries()]
    .map(([reason, one]) => ({
      reason,
      count: one.count,
      value: one.value,
      share: Math.round((one.count / lost.length) * 10_000)
    }))
    .sort((a, b) => b.count - a.count)
}

export interface Conversion {
  /** Leads that have closed, either way. */
  closed: number
  won: number
  /** Basis points. Null when nothing has closed. */
  rate: number | null
  /** Mean value of a won lead, in pence. Null when none have been won. */
  averageDeal: number | null
  /** Mean days from first sight to won. Null when none have been won. */
  daysToWin: number | null
}

export function conversion(
  leads: readonly {
    stage: Stage
    value: number | null
    createdAt: string
    closedAt: string | null
  }[]
): Conversion {
  const won = leads.filter((lead) => lead.stage === 'won')
  const closed = leads.filter((lead) => lead.stage === 'won' || lead.stage === 'lost')

  const durations = won
    .filter((lead) => lead.closedAt !== null)
    .map((lead) => daysBetween(lead.createdAt.slice(0, 10), lead.closedAt!.slice(0, 10)))
    // A negative duration means the dates disagree; it is not a same-day win.
    .filter((days) => days >= 0)

  return {
    closed: closed.length,
    won: won.length,
    rate: closed.length > 0 ? Math.round((won.length / closed.length) * 10_000) : null,
    averageDeal:
      won.length > 0
        ? Math.round(won.reduce((sum, lead) => sum + (lead.value ?? 0), 0) / won.length)
        : null,
    daysToWin:
      durations.length > 0
        ? Math.round(durations.reduce((sum, days) => sum + days, 0) / durations.length)
        : null
  }
}

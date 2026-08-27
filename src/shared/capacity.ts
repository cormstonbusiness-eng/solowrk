/**
 * The capacity calculator.
 *
 * Hours available × utilisation × rate = the most you can earn in a year. §11.2
 * calls it confronting and useful, and it is confronting for one reason: most
 * freelancers have never multiplied it out, and discover that the income they
 * are planning for is arithmetically impossible at the rate they charge.
 *
 * **Utilisation is where the lie lives.** Everyone assumes they bill most of
 * the hours they work. Nobody does — quoting, invoicing, chasing, admin,
 * marketing and the gaps between jobs are all unbilled, and a realistic figure
 * for a solo freelancer is somewhere between 50% and 65%. So the calculator
 * seeds itself from the user's *own tracked history* where there is any, and
 * says what that history was. A calculator run on optimism produces an
 * optimistic answer and changes nothing.
 *
 * Money is integer pence; percentages are basis points (5400 = 54%).
 */

export interface CapacityInput {
  /** Working weeks, after holiday, bank holidays and an allowance for illness. */
  weeksPerYear: number
  /** Hours available for work in one of those weeks. */
  hoursPerWeek: number
  /** Share of available hours that end up billable. */
  utilisationBasisPoints: number
  /** Charged per hour, in pence. */
  rate: number
  /** Everything the business spends in a year, in pence. */
  annualCosts: number
  /** What comes off the profit for income tax and National Insurance. */
  taxBasisPoints: number
}

export interface Capacity {
  availableHours: number
  billableHours: number
  /** Revenue at the ceiling, in pence. */
  gross: number
  costs: number
  /** Before tax. */
  profit: number
  tax: number
  takeHome: number
  /**
   * What each *available* hour is worth once the unbillable ones are counted.
   *
   * The number that makes the point: a £60 rate at 55% utilisation is £33 an
   * hour for every hour of the working week.
   */
  perAvailableHour: number
}

/** A year has 52 weeks; 5 off is a fortnight's holiday, bank holidays and a cold. */
export const DEFAULT_WEEKS = 46

/** Not optimism — what solo freelancers actually manage. */
export const DEFAULT_UTILISATION = 5500

const BASIS = 10_000

function clampBasis(value: number): number {
  return Math.max(0, Math.min(BASIS, Math.round(value)))
}

export function ceiling(input: CapacityInput): Capacity {
  const weeks = Math.max(0, input.weeksPerYear)
  const hoursPerWeek = Math.max(0, input.hoursPerWeek)
  const utilisation = clampBasis(input.utilisationBasisPoints)

  const availableHours = weeks * hoursPerWeek
  const billableHours = (availableHours * utilisation) / BASIS

  const gross = Math.round(billableHours * Math.max(0, input.rate))
  const costs = Math.max(0, input.annualCosts)
  const profit = gross - costs

  // Only ever taxed on a profit, never on a loss.
  const tax = profit > 0 ? Math.round((profit * clampBasis(input.taxBasisPoints)) / BASIS) : 0

  return {
    availableHours: round(availableHours),
    billableHours: round(billableHours),
    gross,
    costs,
    profit,
    tax,
    takeHome: profit - tax,
    perAvailableHour: availableHours > 0 ? Math.round(gross / availableHours) : 0
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/* ------------------------------------------------------------------ *
 * Working backwards from what somebody wants to earn
 * ------------------------------------------------------------------ */

export interface Verdict {
  /** Take-home the plan is aiming at, in pence. */
  target: number
  /** What the current inputs actually produce. */
  achieved: number
  reachable: boolean
  /** Billable hours needed at the current rate. */
  hoursNeeded: number
  /** Hours there actually are. */
  hoursAvailable: number
  /** The rate that would make the target reachable within the hours available. */
  rateNeeded: number
  /** Utilisation that would do it at the current rate. Over 100% means it cannot. */
  utilisationNeeded: number
  /** One sentence, said plainly. */
  summary: string
}

/**
 * Whether a target income is possible, and what would have to change.
 *
 * The useful answer is never just "no". Somebody who cannot reach £45,000 at
 * £40 an hour can reach it at £58 — and being told the number is what makes
 * this a planning tool rather than a disappointment.
 */
export function verdict(target: number, input: CapacityInput): Verdict {
  const result = ceiling(input)
  const taxRate = clampBasis(input.taxBasisPoints)

  // Working backwards: take-home → profit → gross → hours.
  const profitNeeded = target > 0 ? (target * BASIS) / (BASIS - taxRate || 1) : 0
  const grossNeeded = profitNeeded + result.costs
  const hoursNeeded = input.rate > 0 ? grossNeeded / input.rate : Infinity

  const rateNeeded =
    result.billableHours > 0 ? Math.ceil(grossNeeded / result.billableHours) : Infinity

  const utilisationNeeded =
    result.availableHours > 0 && input.rate > 0
      ? Math.round((hoursNeeded / result.availableHours) * BASIS)
      : Infinity

  const reachable = Number.isFinite(hoursNeeded) && hoursNeeded <= result.billableHours

  return {
    target,
    achieved: result.takeHome,
    reachable,
    hoursNeeded: Number.isFinite(hoursNeeded) ? round(hoursNeeded) : 0,
    hoursAvailable: result.billableHours,
    rateNeeded: Number.isFinite(rateNeeded) ? rateNeeded : 0,
    utilisationNeeded: Number.isFinite(utilisationNeeded) ? utilisationNeeded : 0,
    summary: summarise(target, result, {
      reachable,
      hoursNeeded,
      rateNeeded,
      utilisationNeeded,
      rate: input.rate
    })
  }
}

function summarise(
  target: number,
  result: Capacity,
  facts: {
    reachable: boolean
    hoursNeeded: number
    rateNeeded: number
    utilisationNeeded: number
    rate: number
  }
): string {
  if (target <= 0) {
    return `At this rate and this utilisation the most you can take home is ${money(result.takeHome)} a year.`
  }

  if (facts.reachable) {
    const spare = result.billableHours - facts.hoursNeeded
    return (
      `${money(target)} needs ${Math.round(facts.hoursNeeded)} billable hours. ` +
      `You have ${Math.round(result.billableHours)}, so it is reachable with ` +
      `${Math.round(spare)} hours to spare.`
    )
  }

  if (!Number.isFinite(facts.hoursNeeded) || facts.rate <= 0) {
    return 'Set an hourly rate to see whether this is reachable.'
  }

  /**
   * No billable hours at all — no weeks, no hours in them, or nothing
   * billable. No rate fixes that, and offering one ("charge £∞ an hour")
   * would be worse than saying nothing.
   */
  if (result.billableHours <= 0) {
    return (
      `There are no billable hours in this plan, so no rate reaches ${money(target)}. ` +
      'Set the weeks, the hours in a week, and the share of them you expect to bill.'
    )
  }

  // The whole point of the tool: not "no", but "at this rate, no — at this
  // one, yes".
  return (
    `${money(target)} is not reachable at ${money(facts.rate)} an hour. ` +
    `It needs ${Math.round(facts.hoursNeeded)} billable hours and there are only ` +
    `${Math.round(result.billableHours)}. Either charge ${money(facts.rateNeeded)} an hour, ` +
    `or find ${Math.round(facts.hoursNeeded - result.billableHours)} more billable hours — ` +
    `that is ${(facts.utilisationNeeded / 100).toFixed(0)}% utilisation, against ` +
    `${((result.billableHours / (result.availableHours || 1)) * 100).toFixed(0)}% now.`
  )
}

/** Whole pounds. This is prose, and pence in a sentence read as noise. */
export function money(pence: number): string {
  return `£${Math.round(pence / 100).toLocaleString('en-GB')}`
}

/**
 * Money arithmetic. Shared between main and renderer so an invoice total shown
 * on screen is computed by exactly the same code that stores it.
 *
 * Everything is integer pence. Floating point is never used to hold an amount —
 * 0.1 + 0.2 problems in an invoice total are the kind of bug that costs a
 * freelancer money and trust.
 */

import type { BasisPoints, Pence } from './types'

/**
 * Round half away from zero, which is what people expect and what HMRC's
 * examples use. `Math.round` rounds half *up*, so -0.5 goes to 0 rather than
 * -1, which would quietly skew credit notes.
 */
export function roundPence(value: number): Pence {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Line amount from a quantity and a unit price.
 *
 * Quantity is a float (3.25 hours), unit price is pence. The result is rounded
 * once, here — rounding each intermediate step is how totals drift a penny
 * away from the sum of their parts.
 */
export function lineAmount(quantity: number, unitPrice: Pence): Pence {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return 0
  return roundPence(quantity * unitPrice)
}

export interface Totals {
  net: Pence
  vat: Pence
  gross: Pence
}

/**
 * Totals for a set of line amounts.
 *
 * VAT is calculated on the summed net, not per line, and rounded once. Summing
 * per-line VAT would disagree with the net-times-rate figure on larger invoices.
 */
export function totalsFor(
  lineAmounts: Pence[],
  options: { vatRegistered: boolean; vatRate: BasisPoints }
): Totals {
  const net = lineAmounts.reduce((sum, amount) => sum + amount, 0)
  const vat = options.vatRegistered ? roundPence((net * options.vatRate) / 10_000) : 0
  return { net, vat, gross: net + vat }
}

/** Hours worked, from a duration in seconds, to two decimals. */
export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

/**
 * Value of a stretch of tracked time at a given rate.
 *
 * Deliberately computed from seconds rather than from rounded hours: billing
 * 1h59m as 1.98 hours rather than 2 is the honest answer, and rounding to
 * hours first would over- or under-charge on every entry.
 */
export function timeValue(seconds: number, ratePerHour: Pence): Pence {
  return roundPence((seconds / 3600) * ratePerHour)
}

/** Share of an amount to hold back for tax. */
export function taxSetAside(amount: Pence, percent: number): Pence {
  return roundPence((amount * percent) / 100)
}

/**
 * The rate that applies, most specific first: the project's own rate, then the
 * client's, then the business default. `null` at every level means "inherit",
 * which is why this cannot be a simple `??` chain at the call site.
 */
export function effectiveRate(
  projectRate: Pence | null,
  clientRate: Pence | null,
  defaultRate: Pence
): Pence {
  return projectRate ?? clientRate ?? defaultRate
}
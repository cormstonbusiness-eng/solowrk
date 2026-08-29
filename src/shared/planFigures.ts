/**
 * The numbers in a plan written in words.
 *
 * The interview asks "What do you charge?" and gets back "£65 an hour, or a
 * fixed fee for a full package". That is the right answer to the question —
 * it is what somebody would say — and it is also a figure the capacity
 * calculator at the top of the page should be using instead of a default
 * nobody chose.
 *
 * So this reads money out of prose, and is deliberately cautious about it.
 * Everything it returns is shown to the user before anything is written,
 * because the failure here is silent and expensive: an hourly rate set from
 * a day rate would quietly re-price every timer in the app.
 */

/** Pence, or null when the text says no number at all. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/,/g, '')

  // The first money-shaped run of digits, with an optional decimal part and
  // an optional "k". A leading £ is allowed but not required — people write
  // "about 4000" as often as "£4,000".
  const match = /£?\s*(\d+(?:\.\d+)?)\s*(k\b)?/i.exec(cleaned)
  if (!match) return null

  const value = Number.parseFloat(match[1]!)
  if (!Number.isFinite(value)) return null

  const scaled = match[2] ? value * 1000 : value
  const pence = Math.round(scaled * 100)

  // A figure that would overflow the integer columns money lives in is a
  // typo, not a business. Better to say nothing than to write nonsense.
  return pence >= 0 && pence <= 1_000_000_000 ? pence : null
}

/**
 * Whether a stated charge is per hour.
 *
 * The one genuinely dangerous reading in this file. "£450 a day" parses as
 * 45000 pence just as cleanly as "£65 an hour" parses as 6500, and setting
 * the first as an hourly rate would re-price every timer, quote and invoice
 * estimate in the app by a factor of seven.
 *
 * So a charge only counts as hourly when it says so, or when it is a bare
 * figure with no unit at all — which is what somebody typing into a box
 * labelled "What do you charge?" under a placeholder reading "£65 an hour"
 * has almost certainly meant.
 */
export function isHourly(text: string): boolean {
  const lower = text.toLowerCase()

  // Any other stated unit disqualifies it, including ones that contain the
  // word "hour" in a way that is not a rate — "per half day", "a day".
  if (/\b(a|per|\/)\s*(day|week|month|year|job|project|session|visit)\b/.test(lower)) return false
  if (/\bday rate\b|\bfixed fee\b|\bday\b/.test(lower)) return false

  if (/\b(hour|hr|hourly|an hour|p\/h|ph)\b/.test(lower)) return true

  // A bare number under a question about charging: take it.
  return /^[^a-z]*$/i.test(lower.replace(/[£,.\d\s]/g, '')) && /\d/.test(lower)
}

export interface PlanFigures {
  /** Pence per hour, only when the answer actually reads as an hourly rate. */
  rate: number | null
  /** Fixed costs a year, in pence. */
  annualCosts: number | null
  /** What the user says they need to take home in a year, in pence. */
  takeHome: number | null
}

/**
 * The three figures the capacity calculator can use, out of the interview.
 *
 * Null means "the plan does not say", which is different from zero and has to
 * stay different — a plan that is silent about costs must not set them to
 * nothing.
 */
export function figuresFrom(answers: Record<string, string>): PlanFigures {
  const charge = (answers.charge ?? '').trim()
  const costs = (answers.costs ?? '').trim()
  const target = (answers.target ?? '').trim()

  return {
    rate: charge !== '' && isHourly(charge) ? parseMoney(charge) : null,
    annualCosts: costs !== '' ? parseMoney(costs) : null,
    takeHome: target !== '' ? parseMoney(target) : null
  }
}

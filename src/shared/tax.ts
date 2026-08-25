import type { Pence } from './types'

/**
 * What a sole trader will actually owe.
 *
 * The app already had a flat "set aside 30%", which is what people are told
 * in the pub. It is wrong in both directions and expensively so: too high on
 * a lean year, and badly too low the moment profit crosses into the higher
 * band — which is exactly the year somebody can least afford the surprise.
 *
 * This is an estimate, not a return. It covers income tax and Class 4 National
 * Insurance on trading profit and nothing else — no employment income, no
 * dividends, no student loan, no Class 2, no payments on account. Anybody with
 * those has an accountant, and the figure here is for deciding what to move
 * into a savings account each month rather than for filing anything.
 *
 * Rates are data rather than code because they change every April and because
 * somebody in Scotland has different bands entirely. `UK_BANDS_2025_26` is the
 * default; a workspace can carry its own.
 */

export interface TaxBand {
  /** Where this band starts, as taxable profit above the allowance. */
  from: Pence
  /** Percent, as a whole number. 20 is twenty percent. */
  rate: number
}

export interface TaxRules {
  /** Which year these were published for, so the app can say so. */
  label: string
  /** Tax-free, before tapering. */
  personalAllowance: Pence
  /**
   * The allowance falls by £1 for every £2 of profit above this, to nothing.
   * A quietly brutal 60% marginal band that nobody expects.
   */
  taperFrom: Pence
  /** Income tax bands, on profit after the allowance, lowest first. */
  incomeTax: TaxBand[]
  /** Class 4 NI bands, on profit measured from zero, lowest first. */
  nationalInsurance: TaxBand[]
}

/**
 * England, Wales and Northern Ireland, 2025/26.
 *
 * Held as the default rather than the current year because rates are announced
 * each spring and a stale default that says which year it is beats a fresh one
 * that does not. The app shows the label beside the figure so nobody has to
 * guess whether it has been updated.
 */
export const UK_BANDS_2025_26: TaxRules = {
  label: '2025/26',
  personalAllowance: 12_570_00,
  taperFrom: 100_000_00,
  incomeTax: [
    { from: 0, rate: 20 },
    { from: 37_700_00, rate: 40 },
    { from: 112_570_00, rate: 45 }
  ],
  nationalInsurance: [
    { from: 12_570_00, rate: 6 },
    { from: 50_270_00, rate: 2 }
  ]
}

export interface TaxEstimate {
  /** The profit this was calculated from. */
  profit: Pence
  allowance: Pence
  incomeTax: Pence
  nationalInsurance: Pence
  total: Pence
  /**
   * Total as a percentage of profit, rounded up.
   *
   * Rounded *up* on purpose: this is the number somebody sets a standing order
   * to, and being a pound over each month is a rounding error while being a
   * pound under twelve times is a shortfall.
   */
  recommendedPercent: number
  /** What the next pound of profit would be taxed at, both taxes together. */
  marginalPercent: number
  rules: TaxRules
}

/** Tax due on `amount` under a set of bands measured from `offset`. */
function applyBands(amount: Pence, bands: TaxBand[]): Pence {
  if (amount <= 0) return 0

  let due = 0

  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index]!
    const ceiling = bands[index + 1]?.from ?? Number.POSITIVE_INFINITY

    const taxableHere = Math.min(amount, ceiling) - band.from
    if (taxableHere > 0) due += (taxableHere * band.rate) / 100
  }

  return Math.round(due)
}

/** The rate the next pound falls into. */
function marginalRate(amount: Pence, bands: TaxBand[]): number {
  let rate = 0
  for (const band of bands) if (amount >= band.from) rate = band.rate
  return rate
}

export function estimateTax(profit: Pence, rules: TaxRules = UK_BANDS_2025_26): TaxEstimate {
  const safeProfit = Math.max(0, profit)

  /**
   * The taper. Above £100,000 the allowance falls by £1 for every £2, which
   * puts a 60% marginal rate in the middle of the higher band — the single
   * most surprising thing in the UK system and the one worth getting right.
   */
  const taper = Math.max(0, safeProfit - rules.taperFrom)
  const allowance = Math.max(0, rules.personalAllowance - Math.floor(taper / 2))

  const taxable = Math.max(0, safeProfit - allowance)

  const incomeTax = applyBands(taxable, rules.incomeTax)
  const nationalInsurance = applyBands(safeProfit, rules.nationalInsurance)
  const total = incomeTax + nationalInsurance

  return {
    profit: safeProfit,
    allowance,
    incomeTax,
    nationalInsurance,
    total,
    recommendedPercent: safeProfit > 0 ? Math.ceil((total / safeProfit) * 100) : 0,
    marginalPercent:
      marginalRate(taxable, rules.incomeTax) *
        // Inside the taper each extra pound also costs the allowance, so the
        // income-tax rate on it applies one and a half times over.
        (safeProfit > rules.taperFrom && allowance > 0 ? 1.5 : 1) +
      marginalRate(safeProfit, rules.nationalInsurance),
    rules
  }
}

/**
 * Whether what is being held back will cover it.
 *
 * The whole reason this feature exists: somebody setting aside a flat 20%
 * against a 28% liability is a person who will find out in January.
 */
export function setAsideShortfall(
  estimate: TaxEstimate,
  currentPercent: number
): { held: Pence; shortfall: Pence; enough: boolean } {
  const held = Math.round((estimate.profit * currentPercent) / 100)
  const shortfall = Math.max(0, estimate.total - held)

  return { held, shortfall, enough: shortfall === 0 }
}

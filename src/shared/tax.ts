import type { Pence } from './types'

/**
 * What a sole trader will actually owe.
 *
 * The app already had a flat "set aside 30%", which is what people are told
 * in the pub. It is wrong in both directions and expensively so: too high on
 * a lean year, and badly too low the moment profit crosses into the higher
 * band — which is exactly the year somebody can least afford the surprise.
 *
 * This is an estimate, not a return. It covers tax on trading profit and
 * nothing else — no employment income, no dividends, no student loan, no
 * payments on account. Anybody with those has an accountant, and the figure
 * here is for deciding what to move into a savings account each month rather
 * than for filing anything. Each country's `note` says what its own estimate
 * assumes.
 *
 * ## Why charges and reliefs rather than fields
 *
 * The first version of this file had `personalAllowance`, `incomeTax` and
 * `nationalInsurance` as named fields, which is the shape of the UK system and
 * only the UK system. Ireland breaks it in four separate ways: it gives tax
 * *credits*, subtracted from tax due, where the UK gives an *allowance*
 * subtracted from income; it has three parallel charges rather than two; its
 * Universal Social Charge has a cliff-edge exemption, below which you pay
 * nothing and above which you pay on everything from zero; and its PRSI has an
 * annual minimum contribution.
 *
 * So a country states a list of charges and a list of reliefs, and the
 * arithmetic below is the same for all of them. Adding a country is writing a
 * table. If it ever needs a new field here, check first whether it is really a
 * charge with an unusual shape.
 */

export interface TaxBand {
  /** Where this band starts, measured from whatever the charge's basis is. */
  from: Pence
  /** Percent, as a number. May be fractional — Ireland's USC starts at 0.5. */
  rate: number
}

/**
 * One tax or contribution, charged in bands.
 *
 * The UK has income tax and Class 4 National Insurance; Ireland has income
 * tax, USC and PRSI. They differ in what they are charged on, which is what
 * `basis` is for, and two of Ireland's have edges that bands alone cannot
 * express.
 */
export interface TaxCharge {
  /** Stable key, for code and tests: 'incomeTax', 'class4', 'usc', 'prsi'. */
  id: string
  /** What the user sees: 'Income tax', 'Class 4 NI', 'USC', 'PRSI'. */
  label: string
  /**
   * What the bands are measured against.
   *
   * `gross` charges the whole profit; `afterAllowances` charges profit less
   * any allowance-style reliefs. The UK pairs the two — income tax is charged
   * after the personal allowance while Class 4 NI is charged on profit from
   * its own threshold — and subtracting the allowance from both would quietly
   * halve somebody's NI.
   */
  basis: 'gross' | 'afterAllowances'
  bands: TaxBand[]
  /**
   * Below this *whole profit*, the charge is nil; at or above it, the bands
   * apply from zero.
   *
   * A cliff, not a threshold, and tested against profit rather than against
   * the charge's own base because that is how Ireland's USC exemption works.
   * One euro over it costs hundreds, which is why `cliffAhead` exists.
   */
  exemptBelow?: Pence
  /**
   * An annual floor, once profit reaches a trigger.
   *
   * Ireland's PRSI Class S has a minimum contribution: below the floor you
   * pay the floor, not the percentage.
   */
  minimum?: { amount: Pence; whenIncomeAtLeast: Pence }
}

/**
 * Something that reduces the bill.
 *
 * `allowance` comes off income before the bands are applied. `credit` comes
 * off the tax due afterwards, and is non-refundable — it can take a charge to
 * zero and no further. The distinction is not presentational: the same figure
 * is worth more as an allowance to a higher-rate payer and the same to
 * everybody as a credit, which is most of why countries choose between them.
 */
export interface TaxRelief {
  id: string
  label: string
  kind: 'allowance' | 'credit'
  amount: Pence
  /**
   * The allowance falls away above `from`, by `lostPerPound` for each unit
   * over.
   *
   * The UK takes £1 of allowance for every £2 of profit above £100,000, which
   * puts a quietly brutal 60% marginal band in the middle of the higher band
   * that nobody expects.
   */
  taper?: { from: Pence; lostPerPound: number }
  /**
   * Credits only: which charges this may reduce, in order.
   *
   * Ireland's personal and earned-income credits apply to income tax but not
   * to USC or PRSI, so a credit that reduced everything would understate the
   * bill substantially.
   */
  appliesTo?: string[]
}

export interface TaxRules {
  /** Which year these were published for, so the app can say so. */
  label: string
  /**
   * The calendar year the tax year starts in, so lookup is mechanical.
   *
   * Matches `TaxYear.startYear`, which means finding the right table is an
   * equality check rather than parsing a label that differs by country.
   */
  startYear: number
  /**
   * When a human last checked these figures against the statute.
   *
   * The app shows this, and warns when it is old. Rates are published once a
   * year and the code around them does not change, so a table can be silently
   * wrong for a long time — which is the failure mode worth designing against
   * when somebody may act on the number.
   */
  verifiedOn: string
  /** Where the figures came from, so they can be checked again. */
  sourceUrl: string
  /**
   * The footnote shown under the figure, naming what this estimate assumes.
   *
   * Per country, because the assumptions differ and because a sentence about
   * Class 4 National Insurance means nothing to somebody in Dublin. It lives
   * here rather than in the component so that adding a country cannot leave
   * the old country's caveats on screen.
   */
  note: string
  reliefs: TaxRelief[]
  /** Display order is array order. */
  charges: TaxCharge[]
}

/**
 * England, Wales and Northern Ireland, 2025/26.
 *
 * Held as the default rather than the current year because rates are announced
 * each spring and a stale default that says which year it is beats a fresh one
 * that does not. The app shows the label beside the figure so nobody has to
 * guess whether it has been updated.
 *
 * Scotland sets its own income tax bands and is not modelled. The shape here
 * admits it as another table; presenting Scottish profit at these rates would
 * be wrong by thousands.
 */
export const UK_BANDS_2025_26: TaxRules = {
  label: '2025/26',
  startYear: 2025,
  verifiedOn: '2025-04-06',
  sourceUrl: 'https://www.gov.uk/income-tax-rates',
  note:
    'An estimate of income tax and Class 4 National Insurance on trading profit only — ' +
    'no employment income, dividends, student loan or payments on account.',
  reliefs: [
    {
      id: 'personalAllowance',
      label: 'Personal allowance',
      kind: 'allowance',
      amount: 12_570_00,
      taper: { from: 100_000_00, lostPerPound: 0.5 }
    }
  ],
  charges: [
    {
      id: 'incomeTax',
      label: 'Income tax',
      basis: 'afterAllowances',
      bands: [
        { from: 0, rate: 20 },
        { from: 37_700_00, rate: 40 },
        { from: 112_570_00, rate: 45 }
      ]
    },
    {
      id: 'class4',
      label: 'Class 4 NI',
      // On profit from its own threshold, not on profit after the allowance.
      basis: 'gross',
      bands: [
        { from: 12_570_00, rate: 6 },
        { from: 50_270_00, rate: 2 }
      ]
    }
  ]
}

/** One charge, as computed. */
export interface ChargeAmount {
  id: string
  label: string
  amount: Pence
  /** A floor produced this figure, not the bands. */
  atMinimum?: boolean
  /** An exemption zeroed it. */
  exempt?: boolean
}

/** One relief, as applied — a credit's amount is what was actually used. */
export interface ReliefAmount {
  id: string
  label: string
  kind: 'allowance' | 'credit'
  amount: Pence
}

export interface TaxEstimate {
  /** The profit this was calculated from. */
  profit: Pence
  /** Total of allowance-style reliefs, after any taper. */
  allowance: Pence
  /** Total of credit-style reliefs actually used. */
  credits: Pence
  reliefs: ReliefAmount[]
  charges: ChargeAmount[]
  total: Pence
  /**
   * Total as a percentage of profit, rounded up.
   *
   * Rounded *up* on purpose: this is the number somebody sets a standing order
   * to, and being a pound over each month is a rounding error while being a
   * pound under twelve times is a shortfall.
   */
  recommendedPercent: number
  /**
   * What the next pound of profit would cost, across every charge.
   *
   * Computed as the actual difference the next pound makes rather than by
   * reading a band's rate, which is both simpler and more honest: it picks up
   * the UK's allowance taper and every band edge in any country without a
   * special case for either. Capped at 100 — above that there is a cliff, and
   * `cliffAhead` says so in terms somebody can act on.
   */
  marginalPercent: number
  /**
   * A threshold just above current profit where the bill jumps.
   *
   * Ireland's USC exemption and PRSI minimum are cliffs: one euro of extra
   * profit can cost hundreds. That is the single most useful thing the app can
   * tell somebody near one, and it cannot be expressed as a marginal rate.
   */
  cliffAhead?: { chargeLabel: string; at: Pence; cost: Pence }
  rules: TaxRules
  /**
   * The UK's two charges, by name.
   *
   * Kept because a good deal of the app and its tests were written against
   * them. Zero where a country has no such charge, so read `charges` for
   * anything that must work in more than one country.
   */
  incomeTax: Pence
  nationalInsurance: Pence
}

/** Tax due on `amount` under a set of bands measured from the band's own base. */
export function applyBands(amount: Pence, bands: TaxBand[]): Pence {
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

interface Computed {
  allowance: Pence
  credits: Pence
  reliefs: ReliefAmount[]
  charges: ChargeAmount[]
  total: Pence
}

/**
 * The whole calculation for one profit figure.
 *
 * Separated from `estimateTax` because the marginal rate and the cliff lookup
 * both need to run it again at a different profit, and a second
 * implementation of this is how the headline figure and the marginal rate
 * would eventually disagree.
 */
function compute(profit: Pence, rules: TaxRules): Computed {
  const reliefs: ReliefAmount[] = []
  let allowance = 0

  for (const relief of rules.reliefs) {
    if (relief.kind !== 'allowance') continue

    const over = relief.taper ? Math.max(0, profit - relief.taper.from) : 0
    const lost = relief.taper ? Math.floor(over * relief.taper.lostPerPound) : 0
    const amount = Math.max(0, relief.amount - lost)

    allowance += amount
    reliefs.push({ id: relief.id, label: relief.label, kind: 'allowance', amount })
  }

  const afterAllowances = Math.max(0, profit - allowance)

  /*
    Credits are a pool rather than a per-charge figure, because one credit can
    span charges and must not be spent twice. Non-refundable throughout: a
    credit reduces a charge to zero and stops.
  */
  const pool = new Map<string, Pence>()
  for (const relief of rules.reliefs) {
    if (relief.kind === 'credit') pool.set(relief.id, relief.amount)
  }

  const charges: ChargeAmount[] = []

  for (const charge of rules.charges) {
    if (charge.exemptBelow !== undefined && profit < charge.exemptBelow) {
      charges.push({ id: charge.id, label: charge.label, amount: 0, exempt: true })
      continue
    }

    const base = charge.basis === 'gross' ? profit : afterAllowances
    let due = applyBands(base, charge.bands)

    for (const relief of rules.reliefs) {
      if (relief.kind !== 'credit') continue
      if (!relief.appliesTo?.includes(charge.id)) continue

      const remaining = pool.get(relief.id) ?? 0
      const used = Math.min(remaining, due)
      due -= used
      pool.set(relief.id, remaining - used)
    }

    let atMinimum = false
    if (
      charge.minimum &&
      profit >= charge.minimum.whenIncomeAtLeast &&
      due < charge.minimum.amount
    ) {
      due = charge.minimum.amount
      atMinimum = true
    }

    charges.push({
      id: charge.id,
      label: charge.label,
      amount: due,
      ...(atMinimum ? { atMinimum } : {})
    })
  }

  let credits = 0
  for (const relief of rules.reliefs) {
    if (relief.kind !== 'credit') continue

    const used = relief.amount - (pool.get(relief.id) ?? 0)
    credits += used
    reliefs.push({ id: relief.id, label: relief.label, kind: 'credit', amount: used })
  }

  return {
    allowance,
    credits,
    reliefs,
    charges,
    total: charges.reduce((sum, charge) => sum + charge.amount, 0)
  }
}

/** How far ahead to look for a cliff. */
const CLIFF_LOOKAHEAD: Pence = 2_000_00

/**
 * The next threshold that would cost a step rather than a rate.
 *
 * Only exemptions and minimums create one — a band edge changes the rate on
 * the next pound, which `marginalPercent` already reports properly.
 */
function cliffAhead(
  profit: Pence,
  rules: TaxRules
): { chargeLabel: string; at: Pence; cost: Pence } | undefined {
  const thresholds: { label: string; at: Pence }[] = []

  for (const charge of rules.charges) {
    if (charge.exemptBelow !== undefined) {
      thresholds.push({ label: charge.label, at: charge.exemptBelow })
    }
    if (charge.minimum) {
      thresholds.push({ label: charge.label, at: charge.minimum.whenIncomeAtLeast })
    }
  }

  const ahead = thresholds
    .filter((one) => one.at > profit && one.at <= profit + CLIFF_LOOKAHEAD)
    .sort((a, b) => a.at - b.at)[0]

  if (!ahead) return undefined

  // The cost of the single unit that crosses it, which is the figure that
  // makes the point — not the difference from where they stand now.
  const cost = compute(ahead.at, rules).total - compute(ahead.at - 100, rules).total
  if (cost <= 0) return undefined

  return { chargeLabel: ahead.label, at: ahead.at, cost }
}

export function estimateTax(profit: Pence, rules: TaxRules = UK_BANDS_2025_26): TaxEstimate {
  const safeProfit = Math.max(0, profit)
  const result = compute(safeProfit, rules)

  const byId = (id: string): Pence =>
    result.charges.find((charge) => charge.id === id)?.amount ?? 0

  /*
    One pound more, and what it costs. A pound is 100 pence, so the extra
    pence of tax *is* the percentage — which is why this needs no per-country
    quirk. It reproduces the UK's 60% taper band exactly: inside the taper an
    extra pound raises taxable income by £1.50, so 40% of that plus 2% NI is
    62p, which is what a hand-written special case used to compute.
  */
  const marginal = compute(safeProfit + 100, rules).total - result.total
  const cliff = cliffAhead(safeProfit, rules)

  return {
    profit: safeProfit,
    allowance: result.allowance,
    credits: result.credits,
    reliefs: result.reliefs,
    charges: result.charges,
    total: result.total,
    recommendedPercent:
      safeProfit > 0 ? Math.min(100, Math.ceil((result.total / safeProfit) * 100)) : 0,
    marginalPercent: Math.min(100, Math.max(0, marginal)),
    ...(cliff ? { cliffAhead: cliff } : {}),
    rules,
    incomeTax: byId('incomeTax'),
    nationalInsurance: byId('class4')
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

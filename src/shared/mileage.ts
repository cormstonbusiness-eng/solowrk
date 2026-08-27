/**
 * What a business journey is worth.
 *
 * HMRC's approved mileage rates are not one number, which is why "configurable
 * rate" is not enough on its own. A car earns **45p a mile for the first
 * 10,000 business miles in a tax year and 25p a mile after that**. Somebody
 * driving 14,000 miles who claims 45p throughout over-claims by £800 — a
 * figure large enough to matter and quiet enough to survive a whole year,
 * because every individual journey looks right.
 *
 * So the rate is not a property of a journey. It is a property of a journey's
 * *position in the tax year*, and that position moves when an earlier journey
 * is added, edited or deleted. Nothing here is stored: the value of every
 * journey is computed on the way out, in date order, from the miles that came
 * before it. A back-dated journey therefore re-rates the ones after it for
 * free, and no stored copy can drift out of step with the log.
 *
 * Distances are integer **tenths of a mile** and rates are integer **pence per
 * mile**, for the same reason money is pence: 12.7 × 45 in floating point is
 * not 571.5, and a rounding error repeated across a year's driving is a
 * discrepancy an accountant has to chase.
 */

/** Miles, as tenths. The unit everything below counts in. */
export type Tenths = number

export const TENTHS_PER_MILE = 10

/**
 * A vehicle's approved rates.
 *
 * `thresholdTenths` of 0 means there is no threshold and `secondRate` never
 * applies — motorcycles and bicycles are flat-rate, and expressing that as a
 * threshold of zero keeps one code path instead of two.
 */
export interface MileageRate {
  vehicle: Vehicle
  /** Pence per mile below the threshold. */
  firstRate: number
  /** Pence per mile above it. */
  secondRate: number
  /** Where the rate changes, in tenths of a mile. 0 = flat rate. */
  thresholdTenths: Tenths
}

export const VEHICLES = ['car', 'motorcycle', 'bicycle'] as const
export type Vehicle = (typeof VEHICLES)[number]

/**
 * HMRC's approved rates, current as at the 2025/26 tax year.
 *
 * They are seeded into a table rather than read from here at runtime, so that
 * a rate change is a setting somebody edits rather than a release they wait
 * for. These are the defaults that table starts with.
 */
export const HMRC_RATES: Record<Vehicle, Omit<MileageRate, 'vehicle'>> = {
  car: { firstRate: 45, secondRate: 25, thresholdTenths: 10_000 * TENTHS_PER_MILE },
  motorcycle: { firstRate: 24, secondRate: 24, thresholdTenths: 0 },
  bicycle: { firstRate: 20, secondRate: 20, thresholdTenths: 0 }
}

export const VEHICLE_LABELS: Record<Vehicle, string> = {
  car: 'Car or van',
  motorcycle: 'Motorcycle',
  bicycle: 'Bicycle'
}

/** One journey, reduced to the only two things its value depends on. */
export interface Journey {
  vehicle: Vehicle
  tenths: Tenths
}

export interface Valuation {
  /** Integer pence. */
  amount: number
  /** Tenths of this journey earning the lower rate. */
  atFirstRate: Tenths
  /** Tenths earning the higher-mileage rate. */
  atSecondRate: Tenths
  /**
   * The single rate that applies, or null when the journey straddles the
   * threshold and there genuinely isn't one. A column of numbers should not
   * quietly average two rates into a third that appears on no HMRC page.
   */
  rate: number | null
}

/**
 * Value one journey, given the miles already driven in that vehicle this year.
 *
 * A journey that straddles the threshold is split across it, because HMRC
 * works on the annual total rather than on whole trips — the 9,990th mile is
 * worth 45p and the 10,010th is worth 25p even when they are the same
 * afternoon.
 */
export function valueJourney(
  journey: Journey,
  rate: MileageRate,
  alreadyDriven: Tenths
): Valuation {
  const tenths = Math.max(0, Math.round(journey.tenths))

  const atFirstRate =
    rate.thresholdTenths <= 0
      ? tenths
      : Math.min(tenths, Math.max(0, rate.thresholdTenths - alreadyDriven))
  const atSecondRate = tenths - atFirstRate

  // Rounded once, at the end. Rounding each band separately would put a
  // stray penny on every journey that happens to straddle the threshold.
  const amount = Math.round(
    (atFirstRate * rate.firstRate + atSecondRate * rate.secondRate) / TENTHS_PER_MILE
  )

  return {
    amount,
    atFirstRate,
    atSecondRate,
    rate:
      atSecondRate === 0
        ? rate.firstRate
        : atFirstRate === 0
          ? rate.secondRate
          : null
  }
}

/**
 * Value a whole year's journeys.
 *
 * The order given is the order they are counted in, so the caller must sort by
 * date first — the threshold is reached on a date, not on a row id. Each
 * vehicle keeps its own running total, since the 10,000-mile limit is a limit
 * on car miles and cycling to a meeting does not consume any of it.
 */
export function valueYear<T extends Journey>(
  journeys: readonly T[],
  rates: Record<Vehicle, MileageRate>
): (T & Valuation)[] {
  const driven: Record<string, Tenths> = {}

  return journeys.map((journey) => {
    const rate = rates[journey.vehicle]
    const before = driven[journey.vehicle] ?? 0
    const valuation = valueJourney(journey, rate, before)
    driven[journey.vehicle] = before + valuation.atFirstRate + valuation.atSecondRate
    return { ...journey, ...valuation }
  })
}

/* ------------------------------------------------------------------ *
 * Reading and writing distances
 * ------------------------------------------------------------------ */

/** `12.7` ⇄ `127`. Anything unparseable is null rather than a silent zero. */
export function toTenths(miles: string | number): Tenths | null {
  if (typeof miles === 'string') {
    // `Number('')` is 0, not NaN — so an empty box would otherwise be read as
    // a journey of no distance rather than as no journey at all.
    const text = miles.trim().replace(',', '.')
    if (text === '') return null
    const value = Number(text)
    return Number.isFinite(value) && value >= 0 ? Math.round(value * TENTHS_PER_MILE) : null
  }
  if (!Number.isFinite(miles) || miles < 0) return null
  return Math.round(miles * TENTHS_PER_MILE)
}

export function milesLabel(tenths: Tenths): string {
  // One decimal place always, so a column of distances lines up on the point.
  return (tenths / TENTHS_PER_MILE).toFixed(1)
}

/** `45` → `45p`, `100` → `£1.00`. Rates are quoted in pence and read that way. */
export function rateLabel(pence: number | null): string {
  if (pence === null) return 'Mixed'
  return pence < 100 ? `${pence}p` : `£${(pence / 100).toFixed(2)}`
}

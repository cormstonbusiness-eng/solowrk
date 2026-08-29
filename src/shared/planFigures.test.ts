import { describe, expect, it } from 'vitest'
import { figuresFrom, isHourly, parseMoney } from './planFigures'

/**
 * Reading money out of prose.
 *
 * The dangerous case has its own describe block: an hourly rate taken from a
 * day rate would re-price every timer, quote and estimate in the app by a
 * factor of seven, and it would do it silently.
 */

describe('parsing a figure', () => {
  it('reads the ways people actually write money', () => {
    expect(parseMoney('£65 an hour')).toBe(6500)
    expect(parseMoney('£48,000')).toBe(4_800_000)
    expect(parseMoney('About £4,000')).toBe(400_000)
    expect(parseMoney('£62.50 an hour')).toBe(6250)
    expect(parseMoney('65')).toBe(6500)
    expect(parseMoney('£48k')).toBe(4_800_000)
  })

  it('takes the first figure when an answer names several', () => {
    // "£65 an hour, or £450 for a full package" — the rate is the first one,
    // which is how somebody says it.
    expect(parseMoney('£65 an hour, or £450 for a full package')).toBe(6500)
  })

  it('says nothing when the answer has no number in it', () => {
    // Null rather than zero, because "the plan does not say" and "the plan
    // says nothing is spent" are different facts.
    expect(parseMoney('It varies')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })

  it('refuses a figure that is obviously a typo', () => {
    expect(parseMoney('£99,999,999,999')).toBeNull()
  })
})

describe('whether a charge is hourly', () => {
  it('takes an answer that says so', () => {
    expect(isHourly('£65 an hour')).toBe(true)
    expect(isHourly('£65/hr')).toBe(true)
    expect(isHourly('65 hourly')).toBe(true)
  })

  it('takes a bare figure, because of the question it answers', () => {
    // The box is labelled "What do you charge?" under a placeholder reading
    // "£65 an hour". A bare number there means an hourly rate.
    expect(isHourly('£65')).toBe(true)
    expect(isHourly('65')).toBe(true)
  })

  it('refuses a day rate', () => {
    // The whole reason this function exists. £450 a day parses just as
    // cleanly as £65 an hour, and setting it as an hourly rate would be a
    // seven-fold silent mis-pricing of everything in the app.
    expect(isHourly('£450 a day')).toBe(false)
    expect(isHourly('£450 per day')).toBe(false)
    expect(isHourly('£450 day rate')).toBe(false)
  })

  it('refuses anything else priced by the job', () => {
    expect(isHourly('£2,000 a project')).toBe(false)
    expect(isHourly('A fixed fee, usually £1,200')).toBe(false)
    expect(isHourly('£300 per visit')).toBe(false)
  })
})

describe('the figures a plan offers the calculator', () => {
  it('takes all three when the plan states all three', () => {
    expect(
      figuresFrom({ charge: '£65 an hour', costs: 'About £4,000', target: '£36,000' })
    ).toEqual({ rate: 6500, annualCosts: 400_000, takeHome: 3_600_000 })
  })

  it('leaves the rate alone when the charge is not hourly', () => {
    // Costs and target still come through: a day rate says nothing about
    // either of them, and dropping all three over one bad unit would be
    // throwing away two good answers.
    const figures = figuresFrom({ charge: '£450 a day', costs: '£4,000', target: '£36,000' })

    expect(figures.rate).toBeNull()
    expect(figures.annualCosts).toBe(400_000)
    expect(figures.takeHome).toBe(3_600_000)
  })

  it('says nothing about what the plan did not answer', () => {
    expect(figuresFrom({})).toEqual({ rate: null, annualCosts: null, takeHome: null })
    expect(figuresFrom({ costs: '   ' }).annualCosts).toBeNull()
  })
})

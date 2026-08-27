import { describe, expect, it } from 'vitest'
import { ceiling, money, verdict, type CapacityInput } from './capacity'

/**
 * The capacity calculator.
 *
 * The arithmetic is simple and the consequences are not: somebody is going to
 * decide whether to raise their rates on this. So the tests pin the numbers
 * exactly, and pin the two places the answer could mislead — a loss being
 * taxed, and a target being called impossible without saying what would make
 * it possible.
 */

const base: CapacityInput = {
  weeksPerYear: 46,
  hoursPerWeek: 35,
  utilisationBasisPoints: 5500,
  rate: 5000,
  annualCosts: 600_000,
  taxBasisPoints: 3000
}

const input = (over: Partial<CapacityInput> = {}): CapacityInput => ({ ...base, ...over })

describe('the ceiling', () => {
  it('multiplies out the year', () => {
    const result = ceiling(base)

    // 46 × 35 = 1,610 available; 55% of that is 885.5 billable.
    expect(result.availableHours).toBe(1610)
    expect(result.billableHours).toBe(885.5)
    // 885.5 hours at £50.
    expect(result.gross).toBe(4_427_500)
  })

  it('takes costs off before tax, and tax off after', () => {
    const result = ceiling(base)

    expect(result.profit).toBe(4_427_500 - 600_000)
    expect(result.tax).toBe(Math.round(result.profit * 0.3))
    expect(result.takeHome).toBe(result.profit - result.tax)
  })

  it('does not tax a loss', () => {
    // Costs above the ceiling is a bad year, not a tax bill.
    const result = ceiling(input({ annualCosts: 9_000_000 }))

    expect(result.profit).toBeLessThan(0)
    expect(result.tax).toBe(0)
    expect(result.takeHome).toBe(result.profit)
  })

  it('says what an available hour is worth, not just a billable one', () => {
    // The number that makes the point: £50 an hour at 55% is £27.50 for every
    // hour of the working week.
    expect(ceiling(base).perAvailableHour).toBe(2750)
  })

  it('is nothing when no hours are worked', () => {
    const result = ceiling(input({ hoursPerWeek: 0 }))
    expect(result.gross).toBe(0)
    expect(result.perAvailableHour).toBe(0)
  })

  it('refuses a utilisation above everything', () => {
    // Nobody bills 120% of the hours they have.
    expect(ceiling(input({ utilisationBasisPoints: 12_000 })).billableHours).toBe(1610)
  })

  it('treats negative inputs as nothing rather than as income', () => {
    expect(ceiling(input({ rate: -5000 })).gross).toBe(0)
    expect(ceiling(input({ weeksPerYear: -5 })).availableHours).toBe(0)
  })
})

describe('whether a target is reachable', () => {
  it('says so when it is, and how much room there is', () => {
    const answer = verdict(1_000_000, base)

    expect(answer.reachable).toBe(true)
    expect(answer.summary).toContain('reachable')
    expect(answer.summary).toContain('to spare')
  })

  it('does not simply say no', () => {
    // The whole point of the tool: not "no", but "at this rate, no — at this
    // one, yes".
    const answer = verdict(6_000_000, input({ rate: 4000 }))

    expect(answer.reachable).toBe(false)
    expect(answer.rateNeeded).toBeGreaterThan(4000)
    expect(answer.summary).toContain('Either charge')
  })

  it('works the rate back through tax and costs', () => {
    // £30,000 take-home at 30% tax is £42,857 profit, plus £6,000 of costs is
    // £48,857 of revenue, over 885.5 billable hours.
    const answer = verdict(3_000_000, base)
    expect(answer.rateNeeded).toBe(Math.ceil((3_000_000 / 0.7 + 600_000) / 885.5))
  })

  it('says what utilisation would be needed instead of a rate rise', () => {
    const answer = verdict(6_000_000, input({ rate: 4000 }))
    expect(answer.utilisationNeeded).toBeGreaterThan(5500)
    expect(answer.summary).toContain('% utilisation')
  })

  it('asks for a rate rather than dividing by nothing', () => {
    const answer = verdict(3_000_000, input({ rate: 0 }))

    expect(answer.reachable).toBe(false)
    expect(answer.summary).toContain('Set an hourly rate')
    expect(answer.summary).not.toContain('Infinity')
    expect(answer.summary).not.toContain('NaN')
  })

  it('reports the ceiling when no target has been set', () => {
    const answer = verdict(0, base)
    expect(answer.summary).toContain('the most you can take home')
  })

  it('never puts Infinity or NaN in front of anybody', () => {
    const awkward: CapacityInput[] = [
      input({ rate: 0, hoursPerWeek: 0 }),
      input({ weeksPerYear: 0 }),
      input({ utilisationBasisPoints: 0 }),
      input({ taxBasisPoints: 10_000 })
    ]

    for (const one of awkward) {
      const answer = verdict(3_000_000, one)
      expect(answer.summary).not.toMatch(/Infinity|NaN|undefined/)
      expect(Number.isFinite(answer.rateNeeded)).toBe(true)
      expect(Number.isFinite(answer.hoursNeeded)).toBe(true)
    }
  })
})

describe('saying money', () => {
  it('rounds to the pound', () => {
    expect(money(4_427_500)).toBe('£44,275')
    expect(money(0)).toBe('£0')
    expect(money(-150_000)).toBe('£-1,500')
  })
})

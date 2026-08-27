import { describe, expect, it } from 'vitest'
import {
  bySource,
  conversion,
  leadHealth,
  lostReasons,
  pipelineValue,
  type Stage
} from './pipeline'

/**
 * The lead pipeline.
 *
 * Most of these are about the app declining to flatter somebody: an open lead
 * is not a loss, a source that has just started is not a bad source, and a
 * lead nobody has decided anything about is worse than one whose action is
 * late.
 */

const TODAY = '2026-08-24'

const lead = (over: Partial<Parameters<typeof leadHealth>[0]> = {}) => ({
  stage: 'lead' as Stage,
  nextAction: 'Call them',
  nextActionOn: '2026-09-01',
  ...over
})

describe('how a lead is doing', () => {
  it('is adrift with no next action at all', () => {
    // The one rule: a lead with nothing planned is not a lead, it is a memory.
    expect(leadHealth(lead({ nextActionOn: null }), TODAY)).toBe('adrift')
  })

  it('is adrift with a date but nothing to do on it', () => {
    // A date with no action against it is not a plan.
    expect(leadHealth(lead({ nextAction: '   ' }), TODAY)).toBe('adrift')
  })

  it('separates late from unplanned', () => {
    // An overdue action is a thing somebody decided and has not done. No
    // action is a thing nobody decided, and that is how leads are lost.
    expect(leadHealth(lead({ nextActionOn: '2026-08-01' }), TODAY)).toBe('overdue')
    expect(leadHealth(lead({ nextActionOn: null }), TODAY)).toBe('adrift')
  })

  it('knows today from soon from later', () => {
    expect(leadHealth(lead({ nextActionOn: TODAY }), TODAY)).toBe('today')
    expect(leadHealth(lead({ nextActionOn: '2026-08-30' }), TODAY)).toBe('soon')
    expect(leadHealth(lead({ nextActionOn: '2026-10-01' }), TODAY)).toBe('scheduled')
  })

  it('stops nagging about a lead that has closed', () => {
    // Won or lost, there is nothing left to plan.
    expect(leadHealth(lead({ stage: 'won', nextActionOn: null }), TODAY)).toBe('closed')
    expect(leadHealth(lead({ stage: 'lost', nextActionOn: null }), TODAY)).toBe('closed')
  })
})

describe('what the pipeline is worth', () => {
  const leads = [
    { ...lead({ stage: 'lead' }), value: 100_000 },
    { ...lead({ stage: 'proposal' }), value: 500_000 },
    { ...lead({ stage: 'won' }), value: 900_000 },
    { ...lead({ stage: 'lost' }), value: 400_000 }
  ]

  it('counts only what is still open', () => {
    // Won and lost are history, not pipeline. Counting them would make a good
    // quarter look like a full diary.
    const value = pipelineValue(leads, TODAY)

    expect(value.total).toBe(600_000)
    expect(value.weighted).toBe(100_000 * 0.1 + 500_000 * 0.6)
  })

  it('reports every stage, including the closed ones', () => {
    const value = pipelineValue(leads, TODAY)
    const won = value.byStage.find((one) => one.stage === 'won')!

    expect(won.count).toBe(1)
    expect(won.value).toBe(900_000)
  })

  it('counts the leads nobody has planned anything for', () => {
    const value = pipelineValue(
      [...leads, { ...lead({ nextActionOn: null }), value: null }],
      TODAY
    )
    expect(value.adrift).toBe(1)
  })

  it('handles a lead with no value on it', () => {
    const value = pipelineValue([{ ...lead(), value: null }], TODAY)
    expect(value.total).toBe(0)
    expect(Number.isNaN(value.weighted)).toBe(false)
  })

  it('is all zeroes on an empty pipeline rather than undefined', () => {
    const value = pipelineValue([], TODAY)
    expect(value.total).toBe(0)
    expect(value.adrift).toBe(0)
    expect(value.byStage).toHaveLength(6)
  })
})

describe('where the work comes from', () => {
  it('does not count an open lead as a loss', () => {
    // Otherwise a source reports as failing for exactly as long as it is
    // working, and one that has just started looks like the worst.
    const [source] = bySource([
      { source: 'Referral', stage: 'lead', value: 100_000 },
      { source: 'Referral', stage: 'won', value: 200_000 }
    ])

    // One closed, one won.
    expect(source!.conversion).toBe(10_000)
    expect(source!.leads).toBe(2)
  })

  it('reports no conversion at all until something closes', () => {
    // Zero would read as "this never works", which is a different claim.
    const [source] = bySource([{ source: 'LinkedIn', stage: 'contacted', value: 100_000 }])
    expect(source!.conversion).toBeNull()
  })

  it('groups a lead with no source rather than dropping it', () => {
    const [source] = bySource([{ source: '  ', stage: 'won', value: 100_000 }])
    expect(source!.source).toBe('Unknown')
  })

  it('puts the source that earns most at the top', () => {
    const sources = bySource([
      { source: 'LinkedIn', stage: 'won', value: 100_000 },
      { source: 'Referral', stage: 'won', value: 900_000 }
    ])
    expect(sources.map((one) => one.source)).toEqual(['Referral', 'LinkedIn'])
  })
})

describe('why work is lost', () => {
  it('adds the reasons up as shares', () => {
    // Knowing you lose 60% on price is actionable; "we lost some" is not.
    const breakdown = lostReasons([
      { stage: 'lost', lostReason: 'price', value: 100_000 },
      { stage: 'lost', lostReason: 'price', value: 200_000 },
      { stage: 'lost', lostReason: 'timing', value: 50_000 },
      { stage: 'won', lostReason: null, value: 900_000 }
    ])

    expect(breakdown[0]).toMatchObject({ reason: 'price', count: 2, value: 300_000 })
    expect(breakdown[0]!.share).toBe(6667)
  })

  it('counts a loss with no reason rather than shrinking the total', () => {
    // Dropping it would flatter every other percentage.
    const breakdown = lostReasons([
      { stage: 'lost', lostReason: 'price', value: 0 },
      { stage: 'lost', lostReason: null, value: 0 }
    ])

    expect(breakdown).toHaveLength(2)
    expect(breakdown.find((one) => one.reason === 'other')!.count).toBe(1)
  })

  it('says nothing at all when nothing has been lost', () => {
    expect(lostReasons([{ stage: 'won', lostReason: null, value: 0 }])).toEqual([])
  })
})

describe('conversion', () => {
  const closed = [
    { stage: 'won' as Stage, value: 400_000, createdAt: '2026-01-01', closedAt: '2026-02-01' },
    { stage: 'won' as Stage, value: 600_000, createdAt: '2026-03-01', closedAt: '2026-03-11' },
    { stage: 'lost' as Stage, value: 100_000, createdAt: '2026-01-01', closedAt: '2026-01-15' },
    { stage: 'lead' as Stage, value: 900_000, createdAt: '2026-08-01', closedAt: null }
  ]

  it('rates against what has closed, not against everything', () => {
    const result = conversion(closed)

    expect(result.closed).toBe(3)
    expect(result.won).toBe(2)
    expect(result.rate).toBe(6667)
  })

  it('averages the deals that were actually won', () => {
    expect(conversion(closed).averageDeal).toBe(500_000)
  })

  it('works out how long a win takes', () => {
    // 31 days and 10 days.
    expect(conversion(closed).daysToWin).toBe(21)
  })

  it('says nothing rather than zero when nothing has been won', () => {
    const result = conversion([
      { stage: 'lost', value: 100_000, createdAt: '2026-01-01', closedAt: '2026-01-15' }
    ])

    expect(result.averageDeal).toBeNull()
    expect(result.daysToWin).toBeNull()
    expect(result.rate).toBe(0)
  })

  it('is empty rather than dividing by nothing', () => {
    const result = conversion([])
    expect(result.rate).toBeNull()
    expect(result.averageDeal).toBeNull()
  })

  it('ignores a win whose dates disagree', () => {
    // A closed date before the created date is bad data, not a same-day win.
    const result = conversion([
      { stage: 'won', value: 100_000, createdAt: '2026-03-01', closedAt: '2026-01-01' }
    ])
    expect(result.daysToWin).toBeNull()
  })
})

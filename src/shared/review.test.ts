import { describe, expect, it } from 'vitest'
import { buildReview, pounds, type ReviewFacts } from './review'

/**
 * The weekly review.
 *
 * This is the page somebody reads on a Monday and believes without checking,
 * which is exactly why none of it is written by a language model. The tests
 * are about the two ways a trusted page goes wrong: saying something untrue,
 * and saying something useless.
 */

const blank: ReviewFacts = {
  from: '2026-08-17',
  to: '2026-08-23',
  writtenOn: '2026-08-24',
  hoursThisWeek: 0,
  hoursLastWeek: 0,
  paidThisWeek: 0,
  raisedThisWeek: 0,
  tasksCompleted: 0,
  projectsMoved: [],
  overdue: [],
  slipping: [],
  overBudget: [],
  bestClient: null,
  worstClient: null,
  unbilledValue: 0,
  unbilledHours: 0,
  plannedNextWeek: 0,
  capacityHours: 30
}

const facts = (over: Partial<ReviewFacts> = {}): ReviewFacts => ({ ...blank, ...over })

describe('what moved', () => {
  it('reports the week in pounds and hours', () => {
    const review = buildReview(facts({ hoursThisWeek: 22.5, paidThisWeek: 150_000 }))

    expect(review.body).toContain('22.5 hours')
    expect(review.body).toContain('£1,500')
  })

  it('compares against the week before', () => {
    expect(buildReview(facts({ hoursThisWeek: 30, hoursLastWeek: 20 })).body).toContain(
      'up 50% on the week before'
    )
    expect(buildReview(facts({ hoursThisWeek: 15, hoursLastWeek: 20 })).body).toContain(
      'down 25% on the week before'
    )
  })

  it('does not invent a comparison against a week with nothing in it', () => {
    // "up infinity per cent" is not a sentence.
    const review = buildReview(facts({ hoursThisWeek: 10, hoursLastWeek: 0 }))
    expect(review.body).toContain('up from nothing')
    expect(review.body).not.toContain('Infinity')
    expect(review.body).not.toContain('NaN')
  })

  it('says a quiet week was quiet rather than padding it', () => {
    const review = buildReview(blank)
    expect(review.quiet).toBe(true)
    expect(review.body).toContain('No time was tracked')
  })

  it('does not call a week quiet when money arrived', () => {
    // A week spent entirely on a client call that got an invoice paid is not
    // a quiet week.
    expect(buildReview(facts({ paidThisWeek: 90_000 })).quiet).toBe(false)
  })
})

describe('what is at risk', () => {
  it('names the invoice, the client and how late it is', () => {
    const review = buildReview(
      facts({
        overdue: [{ number: 'INV-0012', client: 'Northgate', amount: 150_000, daysLate: 47 }]
      })
    )

    expect(review.body).toContain('INV-0012')
    expect(review.body).toContain('Northgate')
    expect(review.body).toContain('47 days late')
  })

  it('says plainly when there is nothing wrong', () => {
    // A section that goes blank on a good week reads as broken.
    expect(buildReview(blank).body).toContain('Nothing overdue')
  })

  it('flags a deadline that has already passed as past, not as negative days', () => {
    const review = buildReview(
      facts({ slipping: [{ project: 'Ashfield', dueOn: '2026-08-01', daysLeft: -6, openTasks: 3 }] })
    )

    expect(review.body).toContain('already past')
    expect(review.body).not.toContain('-6')
  })

  it('reports a project that has run past its budget', () => {
    const review = buildReview(
      facts({ overBudget: [{ project: 'Ashfield', budget: 400_000, spent: 520_000 }] })
    )
    expect(review.body).toContain('£5,200 of work against £4,000')
  })
})

describe('what to chase', () => {
  it('adds the overdue invoices up and starts with the oldest', () => {
    const review = buildReview(
      facts({
        overdue: [
          { number: 'INV-0012', client: 'Northgate', amount: 100_000, daysLate: 12 },
          { number: 'INV-0009', client: 'Brightwell', amount: 50_000, daysLate: 61 }
        ]
      })
    )

    expect(review.body).toContain('£1,500 across 2 invoices')
    // The oldest, not the largest: the longer it sits the harder it gets.
    expect(review.body).toContain('Start with Brightwell')
  })

  it('leaves the section out entirely when nobody owes anything', () => {
    expect(buildReview(blank).body).not.toContain('What to chase')
  })
})

describe('where the money is', () => {
  it('works out the effective rate on the worst client', () => {
    // The single most useful number a freelancer can see, and almost none of
    // them know it.
    const review = buildReview(
      facts({ worstClient: { name: 'Brightwell', amount: 60_000, hours: 40 } })
    )
    expect(review.body).toContain('£15 an hour')
  })

  it('does not divide by no hours', () => {
    const review = buildReview(
      facts({ worstClient: { name: 'Brightwell', amount: 60_000, hours: 0 } })
    )
    expect(review.body).not.toContain('Infinity')
    expect(review.body).not.toContain('NaN')
  })

  it('mentions work already earned but not billed', () => {
    const review = buildReview(facts({ unbilledValue: 220_000, unbilledHours: 44 }))
    expect(review.body).toContain('£2,200 of tracked work you have not billed')
  })
})

describe('the three things to do', () => {
  it('always gives exactly three', () => {
    expect(buildReview(blank).focus).toHaveLength(3)
    expect(
      buildReview(
        facts({
          overdue: [{ number: 'A', client: 'B', amount: 1, daysLate: 1 }],
          unbilledValue: 100,
          slipping: [{ project: 'P', dueOn: '2026-09-01', daysLeft: 3, openTasks: 2 }],
          overBudget: [{ project: 'Q', budget: 1, spent: 2 }],
          plannedNextWeek: 0
        })
      ).focus
    ).toHaveLength(3)
  })

  it('puts money already earned before anything general', () => {
    const review = buildReview(facts({ unbilledValue: 220_000, unbilledHours: 44 }))
    expect(review.focus[0]).toContain('£2,200')
  })

  it('chases before it invoices', () => {
    // Money asked for and not arriving is worse than money not yet asked for.
    const review = buildReview(
      facts({
        overdue: [{ number: 'INV-0009', client: 'Brightwell', amount: 50_000, daysLate: 61 }],
        unbilledValue: 220_000
      })
    )
    expect(review.focus[0]).toContain('Chase Brightwell')
  })

  it('says something specific rather than encouraging', () => {
    // A review that says "keep up the good work" is one nobody opens twice.
    const review = buildReview(
      facts({ overdue: [{ number: 'INV-0009', client: 'Brightwell', amount: 50_000, daysLate: 61 }] })
    )
    expect(review.focus[0]).toContain('£500')
  })

  it('notices a week planned beyond capacity', () => {
    const review = buildReview(facts({ plannedNextWeek: 44, capacityHours: 30 }))
    expect(review.focus.join(' ')).toContain('Something will slip')
  })

  it('notices an empty calendar', () => {
    expect(buildReview(blank).focus.join(' ')).toContain('Nothing is in the calendar')
  })
})

describe('saying money', () => {
  it('rounds to the pound, because this is prose', () => {
    expect(pounds(150_049)).toBe('£1,500')
    expect(pounds(0)).toBe('£0')
  })
})

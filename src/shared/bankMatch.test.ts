import { describe, expect, it } from 'vitest'
import {
  isClearWinner,
  matchesFor,
  mentionsReference,
  scoreCandidate,
  significantWords,
  type MatchCandidate
} from './bankMatch'

/**
 * Matching a statement line to an invoice.
 *
 * The mistake being guarded against is a confident wrong answer. Marking an
 * invoice paid that was not stops the chasing on money still owed *and* puts
 * income in the accounts that never arrived, and neither shows up afterwards.
 * So the tests are mostly about the cases where the app should decline to be
 * sure.
 */

const invoice = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: 1,
  amount: 150_000,
  reference: 'INV-0012',
  name: 'Acme Ltd',
  date: '2026-04-01',
  ...over
})

const line = (over: Partial<{ date: string; text: string; amount: number }> = {}) => ({
  date: '2026-04-01',
  text: 'ACME LTD INV-0012',
  amount: 150_000,
  ...over
})

describe('references', () => {
  it('finds one however the bank mangled it', () => {
    expect(mentionsReference('FPS ACME LTD INV-0012', 'INV-0012')).toBe(true)
    expect(mentionsReference('ACME INV0012 PAYMENT', 'INV-0012')).toBe(true)
    expect(mentionsReference('ACME INV 0012', 'INV-0012')).toBe(true)
  })

  it('finds it by its digits when the prefix was cut off', () => {
    // Banks truncate the reference field, and the number is what survives.
    expect(mentionsReference('ACME 0012 BACS', 'INV-0012')).toBe(true)
  })

  it('does not match on a digit or two', () => {
    // Otherwise "INV-1" matches a sort code, an account number and a date.
    expect(mentionsReference('ACME 12 BACS', 'INV-12')).toBe(false)
    expect(mentionsReference('anything', '')).toBe(false)
  })
})

describe('names', () => {
  it('ignores the words every company has', () => {
    // Otherwise "The Design Company" matches most of a business account.
    expect(significantWords('The Design Company Ltd')).toEqual([])
    expect(significantWords('Acme Ltd')).toEqual(['acme'])
    expect(significantWords('Northgate Studio Limited')).toEqual(['northgate'])
  })
})

describe('scoring one candidate', () => {
  it('is certain when the amount and the reference both agree', () => {
    const match = scoreCandidate(line(), invoice())!
    expect(match.confidence).toBe('strong')
    expect(match.reasons).toContain('Exactly the right amount')
  })

  it('is only possible on the amount alone', () => {
    // A round number and nothing else is a coincidence as often as not.
    const match = scoreCandidate(
      line({ text: 'TRANSFER RECEIVED', date: '2026-06-20' }),
      invoice()
    )!
    expect(match.confidence).toBe('possible')
  })

  it('still finds an invoice paid three months late', () => {
    // Which is exactly when somebody is reconciling a statement.
    const match = scoreCandidate(line({ date: '2026-07-15' }), invoice())!
    expect(match).not.toBeNull()
    expect(match.confidence).toBe('strong')
  })

  it('will connect a wrong amount when the reference is unmistakable', () => {
    // A client who short-paid by fifty pounds still paid this invoice, and
    // hiding it would leave somebody hunting for a payment they can see.
    const match = scoreCandidate(
      line({ amount: 145_000, text: 'ACME LTD INV-0012' }),
      invoice()
    )!
    expect(match).not.toBeNull()
    expect(match.reasons).toContain('INV-0012 is in the reference')
  })

  it('offers nothing when there is no reason at all', () => {
    expect(
      scoreCandidate(line({ amount: 700, text: 'TESCO STORES 4471' }), invoice())
    ).toBeNull()
  })

  it('reads a payment as its size, not its direction', () => {
    // Statement debits are negative; an invoice is not.
    const match = scoreCandidate(line({ amount: -150_000 }), invoice())!
    expect(match.reasons).toContain('Exactly the right amount')
  })
})

describe('choosing between candidates', () => {
  it('puts the best first', () => {
    const matches = matchesFor(line(), [
      invoice({ id: 2, reference: 'INV-0099', name: 'Someone Else' }),
      invoice({ id: 1 })
    ])
    expect(matches[0]!.id).toBe(1)
  })

  it('refuses to pick between two invoices that look the same', () => {
    // Same client, same amount, two invoices. Either answer is a coin toss
    // dressed up as a suggestion, and the person has to choose.
    const matches = matchesFor(line({ text: 'ACME LTD BACS' }), [
      invoice({ id: 1, reference: 'INV-0012' }),
      invoice({ id: 2, reference: 'INV-0013' })
    ])

    expect(matches).toHaveLength(2)
    expect(isClearWinner(matches)).toBe(false)
  })

  it('is sure when one of them carries the reference', () => {
    const matches = matchesFor(line({ text: 'ACME LTD INV-0013' }), [
      invoice({ id: 1, reference: 'INV-0012' }),
      invoice({ id: 2, reference: 'INV-0013' })
    ])

    expect(matches[0]!.id).toBe(2)
    expect(isClearWinner(matches)).toBe(true)
  })

  it('is never sure on a merely possible match', () => {
    const matches = matchesFor(line({ text: 'TRANSFER', date: '2026-06-20' }), [invoice()])
    expect(isClearWinner(matches)).toBe(false)
  })

  it('is not sure of nothing', () => {
    expect(isClearWinner([])).toBe(false)
  })

  it('shows a shortlist rather than everything', () => {
    const many = Array.from({ length: 12 }, (_, index) => invoice({ id: index + 1 }))
    expect(matchesFor(line(), many)).toHaveLength(4)
  })
})

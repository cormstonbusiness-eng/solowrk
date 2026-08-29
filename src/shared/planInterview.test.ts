import { describe, expect, it } from 'vitest'
import {
  INTERVIEW_SECTIONS,
  QUESTIONS,
  composePlan,
  composeSection,
  composeSummary,
  progress,
  questionsFor,
  sectionsAnswered,
  type Answers
} from './planInterview'
import { PLAN_SECTIONS, classify, parsePlan } from './plan'

/**
 * The interview, and what it writes.
 *
 * The composition is a join rather than a rewrite, which is what lets this
 * work with no model — so the tests are mostly about the joins reading like
 * English, and about the one rule that matters most: nothing the user did not
 * say ends up in their plan, and nothing they skipped becomes an empty
 * heading.
 */

describe('the question set', () => {
  it('has unique ids, because an answer is keyed by one', () => {
    const ids = QUESTIONS.map((question) => question.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only asks about sections the plan outline knows', () => {
    // A question filed under a section that does not exist would compose into
    // a heading the Contents panel could never match.
    const keys = new Set(PLAN_SECTIONS.map((spec) => spec.key))
    for (const question of QUESTIONS) expect(keys.has(question.section)).toBe(true)
  })

  it('never asks for the executive summary', () => {
    // It is written last and from the rest. Asking for it first is asking
    // somebody to summarise a document that does not exist yet.
    expect(questionsFor('summary')).toEqual([])
    expect(INTERVIEW_SECTIONS.map((spec) => spec.key)).not.toContain('summary')
  })

  it('never ends a lead with an article', () => {
    // "It is set up as a " plus "an LLP" is how this goes wrong, and it is
    // invisible until somebody who is not a sole trader uses the feature.
    for (const question of QUESTIONS) {
      expect(question.lead ?? '', question.id).not.toMatch(/\b(a|an|the)\s+$/)
    }
  })

  it('gives every short question a lead, so the answer becomes a sentence', () => {
    // A short answer is a fragment by design — "sole trader", "£65 an hour".
    // Without a lead it lands in the plan as a fragment.
    for (const question of QUESTIONS.filter((one) => one.kind === 'short')) {
      expect(question.lead, question.id).toBeTruthy()
    }
  })
})

describe('composing a section', () => {
  it('says nothing when nothing was answered', () => {
    expect(composeSection('business', {})).toBe('')
    expect(composeSection('business', { setup: '   ' })).toBe('')
  })

  it('runs short answers together into one paragraph', () => {
    const answers: Answers = { setup: 'a sole trader', since: 'March 2021' }

    expect(composeSection('business', answers)).toBe(
      'It is set up as a sole trader. It has been trading since March 2021.'
    )
  })

  it('does not double a full stop the user already wrote', () => {
    expect(composeSection('business', { setup: 'a sole trader.' })).toBe(
      'It is set up as a sole trader.'
    )
  })

  it('lets the answer carry its own article', () => {
    // The lead cannot know whether the answer starts with a vowel, and both
    // of these are real answers to the same question.
    expect(composeSection('business', { setup: 'a sole trader' })).toBe(
      'It is set up as a sole trader.'
    )
    expect(composeSection('business', { setup: 'an LLP' })).toBe('It is set up as an LLP.')
  })

  it('gives a long answer a paragraph of its own', () => {
    const answers: Answers = { what: 'I draw planning applications.', setup: 'a sole trader' }

    expect(composeSection('business', answers)).toBe(
      'I draw planning applications.\n\nIt is set up as a sole trader.'
    )
  })

  it('turns a list answer into bullets, and tolerates the ones people type', () => {
    // Somebody handed a box and told "one per line" will still type dashes.
    const answers: Answers = { sell: '- Planning drawings\n• Surveys\n\n  Building regs  ' }

    expect(composeSection('services', answers)).toBe(
      '- Planning drawings\n- Surveys\n- Building regs'
    )
  })
})

describe('the document', () => {
  it('leaves out a section nobody answered, rather than writing an empty heading', () => {
    // An outline of blank headings is the artefact this whole feature exists
    // to avoid — and worse from the app than from a template, because the app
    // implied it had helped.
    const text = composePlan('Test — business plan', { what: 'I draw planning applications.' })

    expect(text).toContain('## The business')
    expect(text).not.toContain('## Risks')
    expect(text).not.toContain('## Financials')
  })

  it('parses back into the sections the plan page reads', () => {
    // The round trip is the point: what the interview writes has to be a plan
    // the rest of the app already understands, not a private format.
    const answers: Answers = {
      what: 'I draw planning applications.',
      who: 'Small architecture practices.',
      'why-you': 'I turn a set round in a week.',
      target: '£48,000'
    }

    const parsed = parsePlan(composePlan('Test — business plan', answers))
    const keys = parsed.map((section) => classify(section.heading))

    expect(keys).toContain('market')
    expect(keys).toContain('financials')
    expect(keys).toContain('summary')
  })

  it('writes a summary out of the answers that carry the most', () => {
    const answers: Answers = {
      what: 'I draw planning applications.',
      who: 'Small architecture practices.',
      'why-you': 'I turn a set round in a week.',
      threeYears: 'Two retainers covering my costs.'
    }

    expect(composeSummary(answers)).toBe(
      'I draw planning applications. Small architecture practices. I turn a set round in a week. Two retainers covering my costs.'
    )
  })

  it('writes no summary when none of those were answered', () => {
    expect(composeSummary({ setup: 'a sole trader' })).toBe('')
    expect(composePlan('Test', { setup: 'a sole trader' })).not.toContain('Executive summary')
  })

  it('is a plan even when almost nothing was said', () => {
    // Every question is skippable, and eight good sections beat twelve where
    // four say "N/A". The floor is that it still produces a real document.
    const text = composePlan('Test — business plan', { what: 'I draw planning applications.' })

    expect(text.startsWith('# Test — business plan')).toBe(true)
    expect(parsePlan(text).length).toBeGreaterThan(0)
  })
})

describe('progress', () => {
  it('counts only answers with something in them', () => {
    expect(progress({}).answered).toBe(0)
    expect(progress({ what: '  ' }).answered).toBe(0)
    expect(progress({ what: 'Something' }).answered).toBe(1)
    expect(progress({}).total).toBe(QUESTIONS.length)
  })

  it('reports which sections would end up with something in them', () => {
    expect(sectionsAnswered({ what: 'I draw planning applications.' })).toEqual(['business'])
    expect(sectionsAnswered({})).toEqual([])
  })
})

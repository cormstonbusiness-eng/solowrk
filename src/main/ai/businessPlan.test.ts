import { describe, expect, it } from 'vitest'
import { planSection } from './businessPlan'

describe('planSection', () => {
  it('sends a real-sized plan in full', () => {
    // 35,703 characters is an actual plan someone attached, and the previous
    // 20,000 cap silently sent them a little over half of it.
    const plan = Array.from(
      { length: 600 },
      (_, index) =>
        `## Section ${index}\n\nSomething substantive about the business here, at ` +
        'roughly the length a real paragraph runs to.\n'
    ).join('\n')

    expect(plan.length).toBeGreaterThan(35_000)
    expect(planSection(plan)).toContain('Section 399')
  })

  it('keeps the blank lines that make markdown readable', () => {
    // Headings, tables and lists all need the blank line above them. Stripping
    // them turned a structured document into one undifferentiated wall.
    const plan = '# Plan\n\n## Clients\n\n| Name | Rate |\n| --- | --- |\n| Acme | 500 |\n'
    const section = planSection(plan)

    expect(section).toContain('# Plan\n\n## Clients')
    expect(section).toContain('| Name | Rate |')
  })

  it('strips template comments the user never filled in', () => {
    const section = planSection('## What I do\n<!-- Be specific here -->\nBrand identity.')
    expect(section).not.toContain('Be specific here')
    expect(section).toContain('Brand identity.')
  })

  it('returns nothing for a plan that is only comments', () => {
    expect(planSection('<!-- nothing filled in -->\n\n')).toBe('')
  })

  it('returns nothing for an empty plan', () => {
    expect(planSection('   \n\n  ')).toBe('')
  })

  it('wraps the plan in a tag the model can find', () => {
    const section = planSection('We do design.')
    expect(section).toContain('<business_plan>')
    expect(section).toContain('</business_plan>')
  })

  it('says so in the text when a document is too large to send whole', () => {
    const huge = 'x'.repeat(500_000)
    const section = planSection(huge)

    expect(section).toContain('was cut here')
    // Still bounded, so one oversized attachment cannot break every turn.
    expect(section.length).toBeLessThan(420_000)
  })
})

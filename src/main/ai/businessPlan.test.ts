import { describe, expect, it } from 'vitest'
import { isEditablePlan, isNewerThan, planSection } from './businessPlan'

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

describe('isNewerThan', () => {
  it('does not re-extract a file that has not changed since it was read', () => {
    // The bug this replaced: `toISOString` writes `2026-08-16T18:40:29Z` while
    // SQLite writes `2026-08-16 18:40:29`, and `T` sorts above a space. Every
    // same-day file therefore looked newer than its own read timestamp, so a
    // forty-page PDF was re-parsed before every single reply.
    expect(isNewerThan(new Date('2026-08-16T18:40:29Z'), '2026-08-16 18:40:29')).toBe(false)
    expect(isNewerThan(new Date('2026-08-16T09:00:00Z'), '2026-08-16 18:40:29')).toBe(false)
  })

  it('re-extracts a file edited since', () => {
    expect(isNewerThan(new Date('2026-08-16T18:40:30Z'), '2026-08-16 18:40:29')).toBe(true)
    expect(isNewerThan(new Date('2026-08-17T00:00:00Z'), '2026-08-16 18:40:29')).toBe(true)
  })

  it('ignores sub-second precision on either side', () => {
    // SQLite's datetime() truncates to the second, so a millisecond difference
    // is not a change — it is the same read.
    expect(isNewerThan(new Date('2026-08-16T18:40:29.998Z'), '2026-08-16 18:40:29')).toBe(false)
    expect(isNewerThan(new Date('2026-08-16T18:40:29Z'), '2026-08-16 18:40:29.500')).toBe(false)
  })
})

describe('isEditablePlan', () => {
  it('allows the formats SoloWrk can write back to', () => {
    expect(isEditablePlan('Documents/Business/Business Plan.md')).toBe(true)
    expect(isEditablePlan('plan.TXT')).toBe(true)
  })

  it('refuses the ones it can only read', () => {
    // Rewriting a PDF or a Word file would mean regenerating a document the
    // user formatted themselves.
    expect(isEditablePlan('plan.pdf')).toBe(false)
    expect(isEditablePlan('plan.docx')).toBe(false)
    expect(isEditablePlan('')).toBe(false)
  })
})

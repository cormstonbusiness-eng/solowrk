import { describe, expect, it } from 'vitest'
import {
  PLAN_SECTIONS,
  appendSection,
  classify,
  coverage,
  parsePlan,
  planTemplate,
  replaceSection,
  wordCount
} from './plan'

const PLAN = `# Acme Design — business plan

Written January 2026.

## Executive summary
A one-person design studio serving small manufacturers.

## Target market
Manufacturers in the Midlands turning over £1m to £10m.

### Segments
Two: contract manufacturers and own-brand.

## Financials
Day rate £450. Target turnover £68,000.
`

describe('classify', () => {
  it('matches a plain heading', () => {
    expect(classify('Financials')).toBe('financials')
    expect(classify('Risks')).toBe('risks')
  })

  it('sees through numbering, case and punctuation', () => {
    // Real plans number their headings, and a bank template capitalises them.
    expect(classify('4. Marketing & Sales')).toBe('marketing')
    expect(classify('SECTION 2 — THE BUSINESS')).toBe('business')
    expect(classify('## Competition:')).toBe('competition')
  })

  it('prefers the longest alias when two could match', () => {
    // "market research" contains "market", and the specific one is right.
    expect(classify('Market research')).toBe('market')
    expect(classify('Marketing strategy')).toBe('marketing')
  })

  it('returns null for a heading that is not a standard section', () => {
    expect(classify('Appendix C')).toBeNull()
    expect(classify('')).toBeNull()
  })
})

describe('parsePlan', () => {
  it('splits on markdown headings and keeps the body', () => {
    const sections = parsePlan(PLAN)
    const headings = sections.map((section) => section.heading)

    expect(headings).toEqual([
      'Acme Design — business plan',
      'Executive summary',
      'Target market',
      'Segments',
      'Financials'
    ])
    expect(sections[4]!.body).toContain('Day rate £450')
  })

  it('keeps text above the first heading rather than dropping it', () => {
    const sections = parsePlan('Some preamble.\n\n## Risks\nA few.')
    expect(sections[0]!.heading).toBe('Introduction')
    expect(sections[0]!.body).toBe('Some preamble.')
  })

  it('records the heading depth so an edit can write it back the same way', () => {
    const sections = parsePlan(PLAN)
    expect(sections[1]!.level).toBe(2)
    expect(sections[3]!.level).toBe(3)
  })

  it('finds headings in a plan extracted from Word, which has no hashes', () => {
    // Extraction loses the markdown, so without the fallback a Word plan is one
    // undivided wall of text and every section reads as missing.
    const sections = parsePlan(
      ['Executive summary', '', 'We sell things.', '', 'Financials', '', 'Day rate £450.'].join('\n')
    )
    expect(sections.map((section) => section.heading)).toEqual([
      'Executive summary',
      'Financials'
    ])
    expect(sections[1]!.body.trim()).toBe('Day rate £450.')
  })

  it('does not chop prose into headings on a plan that has real ones', () => {
    // The heuristic must not run at all once markdown is present, or a short
    // line inside a paragraph becomes a section break.
    const sections = parsePlan('## Risks\n\nCash flow\n\nis the main one.')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.body).toContain('Cash flow')
  })

  it('leaves a bullet list alone in a document with no headings', () => {
    const sections = parsePlan('- Cash flow\n- Illness\n- One client')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.heading).toBe('Business plan')
  })

  it('survives a PDF that came back as one long line', () => {
    // A PDF extracts a page at a time with no line breaks, so there is nothing
    // to find. It must still come back as a readable whole rather than empty.
    const sections = parsePlan('Executive summary We sell things. Financials Day rate £450.')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.body).toContain('Day rate')
  })

  it('returns nothing for an empty document', () => {
    expect(parsePlan('')).toEqual([])
    expect(parsePlan('   \n\n  ')).toEqual([])
  })
})

describe('coverage', () => {
  it('reports every standard section, found or not', () => {
    const found = coverage(parsePlan(PLAN))
    expect(found).toHaveLength(PLAN_SECTIONS.length)

    const byKey = Object.fromEntries(found.map((entry) => [entry.spec.key, entry.section !== null]))
    expect(byKey.summary).toBe(true)
    expect(byKey.market).toBe(true)
    expect(byKey.financials).toBe(true)
    expect(byKey.risks).toBe(false)
  })
})

describe('replaceSection', () => {
  it('replaces one section and touches nothing else', () => {
    const next = replaceSection(PLAN, 'Financials', 'Day rate £500 from April.')!

    expect(next).toContain('Day rate £500 from April.')
    expect(next).not.toContain('£450')
    // The point of editing a section rather than the document.
    expect(next).toContain('Manufacturers in the Midlands')
    expect(next).toContain('# Acme Design — business plan')
  })

  it('stops at the next heading of the same level', () => {
    const next = replaceSection(PLAN, 'Executive summary', 'Replaced.')!
    expect(next).toContain('## Target market')
    expect(next).toContain('Manufacturers in the Midlands')
    expect(next).not.toContain('A one-person design studio')
  })

  it('takes subheadings with the section they belong to', () => {
    const next = replaceSection(PLAN, 'Target market', 'Rewritten.')!
    expect(next).not.toContain('### Segments')
    expect(next).not.toContain('contract manufacturers')
    expect(next).toContain('## Financials')
  })

  it('replaces the last section without eating the end of the file', () => {
    const next = replaceSection(PLAN, 'Financials', 'New numbers.')!
    expect(next.trimEnd().endsWith('New numbers.')).toBe(true)
  })

  it('matches a heading loosely, as the assistant will write it', () => {
    expect(replaceSection(PLAN, 'financials', 'x')).not.toBeNull()
    expect(replaceSection(PLAN, '  Financials  ', 'x')).not.toBeNull()
  })

  it('returns null rather than guessing when the heading is not there', () => {
    // The caller appends instead. Guessing at the nearest heading would let a
    // model overwrite a section the user never named.
    expect(replaceSection(PLAN, 'Risks', 'Cash flow.')).toBeNull()
  })
})

describe('appendSection', () => {
  it('adds the section at the end', () => {
    const next = appendSection(PLAN, 'Risks', 'Cash flow, illness, one big client.')
    expect(next).toContain('## Risks')
    expect(next.indexOf('## Risks')).toBeGreaterThan(next.indexOf('## Financials'))
    expect(parsePlan(next).some((section) => section.key === 'risks')).toBe(true)
  })

  it('matches the depth the document already uses', () => {
    // A plan written entirely in `#` should not sprout a `##` at the bottom.
    const flat = '# Summary\n\nWe sell things.\n'
    expect(appendSection(flat, 'Risks', 'Cash flow.')).toContain('\n# Risks\n')
  })

  it('does not run the previous section into the new heading', () => {
    const next = appendSection('# Summary\nWe sell things.', 'Risks', 'Cash flow.')
    expect(next).toContain('We sell things.\n\n# Risks')
  })
})

describe('planTemplate', () => {
  it('lays out every standard section', () => {
    const sections = parsePlan(planTemplate('Acme Design'))
    const keys = sections.map((section) => section.key).filter(Boolean)

    for (const spec of PLAN_SECTIONS) expect(keys).toContain(spec.key)
  })

  it('names the business in the title', () => {
    expect(planTemplate('Acme Design')).toContain('# Acme Design — business plan')
    expect(planTemplate('  ')).toContain('# Business plan')
  })

  it('puts the hints in comments so the assistant never reads them', () => {
    // planSection strips HTML comments. An unfilled prompt reaching the model
    // is worse than an empty section, because it works around it earnestly.
    const template = planTemplate('Acme')
    for (const spec of PLAN_SECTIONS) expect(template).toContain(`<!-- ${spec.hint} -->`)
  })
})

describe('wordCount', () => {
  it('counts words, not characters', () => {
    expect(wordCount('Day rate £450.')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
})
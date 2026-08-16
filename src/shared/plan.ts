/**
 * The shape of a business plan.
 *
 * The plan is a markdown file in the workspace, not rows in a table. That is
 * deliberate and worth stating once: it stays readable in any editor, it can be
 * a document the user already had, and it survives this app being uninstalled.
 * Everything here is a *view* of that text — parsing headings out of it, saying
 * which of the usual sections are missing, and putting an edited section back.
 *
 * Shared between the main and renderer processes so the page and the
 * assistant's editing tool agree on what a section is. If they disagreed, the
 * assistant would write a heading the page could not find.
 */

/** One of the sections a plan is usually expected to have. */
export interface PlanSectionSpec {
  key: string
  title: string
  /** Shown under the heading when the section is empty — what belongs here. */
  hint: string
  /** Other names for the same thing, so an existing plan is recognised. */
  aliases: string[]
}

/**
 * The standard outline, in the order a plan is normally read.
 *
 * Kept close to what a bank or a grant application expects rather than
 * invented, because the point of the outline is that someone else recognises
 * it. Aliases matter more than they look: almost nobody writes "Market" — they
 * write "Target market", "Who I sell to", "Customers".
 */
export const PLAN_SECTIONS: PlanSectionSpec[] = [
  {
    key: 'summary',
    title: 'Executive summary',
    hint: 'The whole plan in a paragraph. Written last, read first.',
    aliases: ['summary', 'overview', 'introduction', 'executive summary', 'at a glance']
  },
  {
    key: 'business',
    title: 'The business',
    hint: 'What the business is, when it started, how it is set up, and where it trades.',
    aliases: ['the business', 'business', 'about', 'about us', 'company', 'background']
  },
  {
    key: 'vision',
    title: 'Vision and mission',
    hint: 'Where this is going, and what it is for beyond the money.',
    aliases: ['vision', 'mission', 'purpose', 'values', 'vision and mission', 'goals']
  },
  {
    key: 'services',
    title: 'Products and services',
    hint: 'What you actually sell, and what each thing costs.',
    aliases: [
      'products',
      'services',
      'products and services',
      'what i do',
      'what we do',
      'offering',
      'offer'
    ]
  },
  {
    key: 'market',
    title: 'Target market',
    hint: 'Who buys this, how many of them there are, and why they need it.',
    aliases: [
      'market',
      'target market',
      'customers',
      'clients',
      'audience',
      'market research',
      'who i sell to'
    ]
  },
  {
    key: 'competition',
    title: 'Competition',
    hint: 'Who else does this, and the honest reason someone picks you instead.',
    aliases: ['competition', 'competitors', 'competitive analysis', 'the market', 'swot']
  },
  {
    key: 'marketing',
    title: 'Marketing and sales',
    hint: 'How people find out you exist, and how an enquiry becomes a paying job.',
    aliases: ['marketing', 'sales', 'marketing and sales', 'marketing strategy', 'promotion']
  },
  {
    key: 'operations',
    title: 'How it runs',
    hint: 'The day to day: your process, your tools, suppliers, and how work gets delivered.',
    aliases: ['operations', 'how it runs', 'delivery', 'process', 'day to day', 'logistics']
  },
  {
    key: 'team',
    title: 'People',
    hint: 'You, anyone you work with, and the skills you buy in.',
    aliases: ['people', 'team', 'staff', 'management', 'about me', 'who we are']
  },
  {
    key: 'financials',
    title: 'Financials',
    hint: 'What you charge, what you expect to turn over, your costs, and your break-even.',
    aliases: [
      'financials',
      'finance',
      'finances',
      'financial plan',
      'forecast',
      'projections',
      'budget',
      'pricing',
      'cash flow'
    ]
  },
  {
    key: 'risks',
    title: 'Risks',
    hint: 'What could go wrong, how likely it is, and what you would do about it.',
    aliases: ['risks', 'risk', 'threats', 'challenges', 'contingency', 'what could go wrong']
  },
  {
    key: 'milestones',
    title: 'Milestones',
    hint: 'The next few things that have to happen, with dates against them.',
    aliases: ['milestones', 'roadmap', 'plan', 'next steps', 'timeline', 'objectives', 'targets']
  }
]

/** A heading found in the plan, with everything under it. */
export interface PlanSection {
  /** The heading exactly as written, so writing it back matches. */
  heading: string
  /** Markdown heading depth: 1 for `#`, 2 for `##`. 0 for a plan with none. */
  level: number
  body: string
  /** The `PLAN_SECTIONS` key this heading matched, when it matched one. */
  key: string | null
}

/** Lowercase, no punctuation, no numbering — the form headings are matched in. */
function normalise(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/^[\s\d.)#*_-]+/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Which standard section a heading is, or null.
 *
 * Substring matching in both directions, because "4. Marketing & Sales Plan"
 * and "Marketing" are the same section and an exact match would find neither.
 * Longest alias wins so "market research" is not claimed by "market".
 */
export function classify(heading: string): string | null {
  const text = normalise(heading)
  if (text === '') return null

  let best: { key: string; length: number } | null = null

  for (const spec of PLAN_SECTIONS) {
    for (const alias of spec.aliases) {
      if (text === alias || text.includes(alias) || alias.includes(text)) {
        if (!best || alias.length > best.length) best = { key: spec.key, length: alias.length }
      }
    }
  }

  return best?.key ?? null
}

const MARKDOWN_HEADING = /^(#{1,4})\s+(.+?)\s*#*$/

/**
 * Does this line read as a heading in a document that has no markdown in it?
 *
 * Word and PDF extraction loses the `#`, so without this a plan pasted out of
 * Word is one undivided wall. The test is deliberately conservative — a short
 * line, no full stop, not a bullet — because a false positive chops a paragraph
 * in half, which is far more annoying than a heading that was missed.
 */
function looksLikeHeading(line: string): boolean {
  const text = line.trim()
  if (text.length === 0 || text.length > 60) return false
  if (/^[-*+•>|]/.test(text)) return false
  if (/[.,;:?]$/.test(text)) return false
  if (text.split(/\s+/).length > 8) return false

  // Either it is one of the sections we know, or it is styled like a heading:
  // numbered, or in capitals.
  return (
    classify(text) !== null ||
    /^\d+[.)]\s+\S/.test(text) ||
    (text === text.toUpperCase() && /[A-Z]{3}/.test(text))
  )
}

/**
 * Split plan text into its sections.
 *
 * Markdown headings win outright when the document has any. Only a document
 * with none falls back to the heuristic, so a real markdown plan is never at
 * the mercy of a guess.
 */
export function parsePlan(text: string): PlanSection[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const hasMarkdown = lines.some((line) => MARKDOWN_HEADING.test(line))

  const sections: PlanSection[] = []
  const preamble: string[] = []

  for (const line of lines) {
    const markdown = hasMarkdown ? MARKDOWN_HEADING.exec(line) : null

    if (markdown) {
      sections.push({
        heading: markdown[2]!,
        level: markdown[1]!.length,
        body: '',
        key: classify(markdown[2]!)
      })
      continue
    }

    if (!hasMarkdown && looksLikeHeading(line)) {
      const heading = line.trim()
      sections.push({ heading, level: 2, body: '', key: classify(heading) })
      continue
    }

    const current = sections.at(-1)
    if (current) current.body += `${line}\n`
    else preamble.push(line)
  }

  for (const section of sections) section.body = section.body.replace(/\s+$/, '')

  // Text above the first heading is real content — usually the title block —
  // and dropping it would lose part of the user's document.
  const opening = preamble.join('\n').trim()
  if (opening !== '') {
    sections.unshift({
      heading: sections.length === 0 ? 'Business plan' : 'Introduction',
      level: 0,
      body: opening,
      key: null
    })
  }

  return sections
}

/** Every standard section, paired with the one in the plan that covers it. */
export function coverage(sections: PlanSection[]): {
  spec: PlanSectionSpec
  section: PlanSection | null
}[] {
  return PLAN_SECTIONS.map((spec) => ({
    spec,
    section: sections.find((section) => section.key === spec.key) ?? null
  }))
}

/**
 * The section a heading names, matched the loose way the assistant will write
 * it — "financials", "Financials", "  Financials  " are all the same section.
 * Never matched to the *nearest* heading, only an equal one: guessing would let
 * a model overwrite a section the user never named.
 */
export function findSection(text: string, heading: string): PlanSection | null {
  const target = normalise(heading)
  return parsePlan(text).find((section) => normalise(section.heading) === target) ?? null
}

/** Rough word count, for the "how long is this" line on the page. */
export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g)
  return words ? words.length : 0
}

/**
 * Replace one section's body, leaving every other byte of the file alone.
 *
 * A whole-document rewrite is never offered anywhere in this feature: the plan
 * can be tens of thousands of characters the user wrote by hand, and a single
 * bad edit that replaced all of it would be unrecoverable. Editing a named
 * section is the largest operation worth allowing.
 *
 * Returns null when the heading is not in the document, so the caller can
 * decide between appending and reporting it rather than guessing.
 */
export function replaceSection(text: string, heading: string, body: string): string | null {
  const found = findSection(text, heading)
  if (!found || found.level === 0) return null

  const marker = `${'#'.repeat(found.level)} ${found.heading}`
  const index = text.indexOf(marker)
  if (index === -1) return null

  const after = index + marker.length
  const rest = text.slice(after)
  // The next heading at this level or shallower ends the section. A deeper one
  // belongs to it and gets replaced with it.
  const next = rest.search(new RegExp(`\\n#{1,${found.level}}\\s`))

  const tail = next === -1 ? '' : rest.slice(next)
  return `${text.slice(0, after)}\n\n${body.trim()}\n${tail}`
}

/** Add a section at the end, at the depth the rest of the document uses. */
export function appendSection(text: string, heading: string, body: string): string {
  const sections = parsePlan(text)

  // The level most of the headings use, rather than the shallowest. Nearly
  // every plan opens with a single `#` title above `##` sections, and taking
  // the minimum would file the new section alongside the title instead of
  // alongside its siblings. Ties go to the shallower level.
  const counts = new Map<number, number>()
  for (const section of sections) {
    if (section.level > 0) counts.set(section.level, (counts.get(section.level) ?? 0) + 1)
  }

  let level = 2
  let most = 0
  for (const [candidate, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > most) {
      most = count
      level = candidate
    }
  }

  return `${text.replace(/\s+$/, '')}\n\n${'#'.repeat(level)} ${heading.trim()}\n\n${body.trim()}\n`
}

/**
 * A blank plan with every standard section, headed but empty.
 *
 * The hints go in as HTML comments because `planSection` in the main process
 * strips those before the assistant sees them — an unfilled prompt is worse
 * than an empty section, since the model will earnestly work around it.
 */
export function planTemplate(businessName: string): string {
  const title = businessName.trim() === '' ? 'Business plan' : `${businessName.trim()} — business plan`

  return [
    `# ${title}`,
    '',
    ...PLAN_SECTIONS.flatMap((spec) => [`## ${spec.title}`, '', `<!-- ${spec.hint} -->`, '']),
    ''
  ].join('\n')
}
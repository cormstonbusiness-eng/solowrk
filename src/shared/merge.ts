/**
 * Merge fields.
 *
 * `{{client.company}}` in a template becomes the client's name when the
 * document is generated. The whole point of a template library is that the
 * paperwork comes out already addressed to the right person for the right
 * project at the right price.
 *
 * **An unresolved field is never left blank.** A contract with an empty space
 * where the client's name should be is a document somebody sends without
 * noticing; one that still says `{{client.company}}` is a document nobody
 * sends by accident. So a missing value stays visible, and the generator
 * reports which fields it could not fill so the user is told before the PDF
 * exists rather than after the client has read it.
 */

/** What a template can ask for, flattened into one lookup. */
export type MergeContext = Record<string, string | number | null | undefined>

export interface MergeResult {
  text: string
  /** Fields the template asked for that the records could not answer. */
  unresolved: string[]
  /** Fields that resolved, for the "this is what it filled in" summary. */
  filled: string[]
}

/**
 * `{{ client.company }}` — whitespace tolerated, because people type it.
 *
 * Deliberately narrow: letters, digits, dots and underscores only. A template
 * is user-supplied text and this pattern is the boundary between "a field" and
 * "two braces somebody typed in a sentence about braces".
 */
const FIELD = /\{\{\s*([a-z0-9_]+(?:\.[a-z0-9_]+)*)\s*\}\}/gi

/**
 * Conditional blocks: `{{#if project.value}}…{{/if}}`.
 *
 * One construct, not a language. A contract that mentions a deposit only when
 * there is one needs this; anything more and a template becomes a program
 * somebody has to debug, which is not what was bought.
 */
const CONDITIONAL = /\{\{#if\s+([a-z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/if\s*\}\}/gi

function has(context: MergeContext, key: string): boolean {
  const value = context[key.toLowerCase()]
  if (value === null || value === undefined) return false
  if (typeof value === 'number') return value !== 0
  return value.trim() !== ''
}

/**
 * Fill a template.
 *
 * Conditionals first, so a field inside a block that is being dropped is never
 * counted as unresolved — a deposit clause that does not apply is not a
 * missing deposit.
 */
export function merge(template: string, context: MergeContext): MergeResult {
  const lower: MergeContext = {}
  for (const [key, value] of Object.entries(context)) lower[key.toLowerCase()] = value

  const withoutBlocks = template.replace(CONDITIONAL, (_whole, key: string, body: string) =>
    has(lower, key) ? body : ''
  )

  const unresolved = new Set<string>()
  const filled = new Set<string>()

  const text = withoutBlocks.replace(FIELD, (whole, key: string) => {
    const value = lower[key.toLowerCase()]
    if (value === null || value === undefined || String(value).trim() === '') {
      unresolved.add(key)
      // Left standing, on purpose. See the note at the top of this file.
      return whole
    }
    filled.add(key)
    return String(value)
  })

  return {
    text,
    unresolved: [...unresolved].sort(),
    filled: [...filled].sort()
  }
}

/**
 * Every field a template mentions, without needing any data.
 *
 * Used to tell somebody what a template will ask for before they pick a
 * project for it — and to show, while they are writing one, which of the
 * fields they have typed are real.
 */
export function fieldsIn(template: string): string[] {
  const found = new Set<string>()

  for (const match of template.matchAll(FIELD)) found.add(match[1]!)
  for (const match of template.matchAll(CONDITIONAL)) found.add(match[1]!)

  return [...found].sort()
}

/* ------------------------------------------------------------------ *
 * The vocabulary
 * ------------------------------------------------------------------ */

/**
 * What a template may use, and what each one means.
 *
 * Listed rather than left to be discovered, because a merge field that turns
 * out not to exist is only discovered at the moment somebody generates a
 * contract — and the whole set has to be pickable from a menu, or nobody will
 * ever type `{{project.value}}` correctly on the first go.
 */
export interface MergeField {
  key: string
  label: string
  /** Shown in the picker so the shape is obvious before it is used. */
  example: string
}

export const MERGE_FIELDS: MergeField[] = [
  { key: 'client.company', label: 'Client name', example: 'Northgate Studio Ltd' },
  { key: 'client.contact', label: 'Client contact', example: 'Jane Powell' },
  { key: 'client.email', label: 'Client email', example: 'jane@northgate.co.uk' },
  { key: 'client.phone', label: 'Client phone', example: '0113 496 0000' },
  { key: 'client.address', label: 'Client address', example: '14 Kirkgate, Leeds' },

  { key: 'project.name', label: 'Project name', example: 'Ashfield House visuals' },
  { key: 'project.value', label: 'Project value', example: '£4,800.00' },
  { key: 'project.description', label: 'Project description', example: 'Six exterior CGIs' },
  { key: 'project.start', label: 'Project start', example: '1 April 2026' },
  { key: 'project.due', label: 'Project deadline', example: '30 April 2026' },
  { key: 'project.rate', label: 'Project rate', example: '£50.00' },

  { key: 'user.business_name', label: 'Your business name', example: 'Blockout Digital' },
  { key: 'user.contact', label: 'Your name', example: 'Craig Ormston' },
  { key: 'user.email', label: 'Your email', example: 'craig@example.com' },
  { key: 'user.phone', label: 'Your phone', example: '07000 000000' },
  { key: 'user.address', label: 'Your address', example: '1 High Street, Leeds' },
  { key: 'user.vat_number', label: 'Your VAT number', example: 'GB123456789' },
  { key: 'user.payment_terms', label: 'Your payment terms', example: '14 days' },

  { key: 'today', label: "Today's date", example: '27 August 2026' },
  { key: 'tax_year', label: 'Tax year', example: '2026/27' }
]

const KNOWN = new Set(MERGE_FIELDS.map((field) => field.key))

/**
 * Fields a template uses that are not in the vocabulary at all.
 *
 * Different from unresolved: `{{clint.company}}` is a typo that will never
 * resolve for any project, and saying so while somebody is *writing* the
 * template is far more use than saying it while they are generating a contract
 * for a client who is waiting.
 */
export function unknownFields(template: string): string[] {
  return fieldsIn(template).filter((key) => !KNOWN.has(key.toLowerCase()))
}

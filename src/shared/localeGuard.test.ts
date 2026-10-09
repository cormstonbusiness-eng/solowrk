import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The guard that stops nineteen money formatters growing back.
 *
 * Before `@shared/currency` existed, `£` and `'en-GB'` were re-implemented in
 * nineteen places. Each one was added by somebody reasonably deciding that
 * formatting a number inline was simpler than finding the shared helper, and
 * collectively they meant the app could only ever be British. Collapsing them
 * was a day's work; keeping them collapsed is what this file is for.
 *
 * It fails on a *new* hard-coded currency symbol or locale. If you are adding
 * one deliberately — a country pack naming its own locale, say — the right move
 * is to add the file to `ALLOWED` with a reason, not to widen the pattern.
 */

const ROOT = join(import.meta.dirname, '..')

/**
 * Files permitted to name a locale or a currency symbol directly.
 *
 * Every entry is somewhere the string is the subject rather than an accident:
 * the formatters themselves, the tables they read from, and the tests that pin
 * their output.
 */
const ALLOWED = new Set([
  // The formatters. This is where a symbol and a locale are supposed to live.
  'shared/currency.ts',
  'shared/dateFormat.ts',
  // Parsers, which must accept what a bank or a receipt actually writes.
  'shared/bankCsv.ts',
  'shared/receipts.ts',
  'shared/planFigures.ts',
  // Prose and examples shown to the user, swapped per jurisdiction wholesale.
  'shared/merge.ts',
  'shared/starterTemplates.ts',
  'shared/planInterview.ts',
  'shared/changelog.ts',
  /*
    Mileage is a per-country *scheme* rather than a formatting choice, and
    `rateLabel` writes "45p" — the subunit suffix, which only the UK and
    Ireland even have, and which Ireland does not use because its scheme ships
    as `null`. The label belongs with the scheme that defines it, so when a
    metric country arrives this file gains a unit rather than losing a literal.
  */
  'shared/mileage.ts',
  /*
    The occurrences here are inside SQL `--` comments within template literals,
    which the JS comment stripper cannot see. They are prose about why a column
    exists, not formatting.
  */
  'main/db/migrations.ts'
])

/**
 * Directories where naming a locale or a currency is the entire job.
 *
 * A prefix rather than a list of files, so adding a country is writing a pack
 * and nothing else. Needing to edit a guard in order to add a country would
 * make the guard an obstacle to the thing it exists to enable.
 */
const ALLOWED_DIRS = ['shared/countries/']

function isAllowed(relative: string): boolean {
  return ALLOWED.has(relative) || ALLOWED_DIRS.some((dir) => relative.startsWith(dir))
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'out' || entry === 'dist') continue

    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      sources(path, found)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.(ts|tsx)$/.test(entry)) continue
    found.push(path)
  }
  return found
}

/** Comments are prose about the code, not code, so they do not count. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offenders(pattern: RegExp): string[] {
  const hits: string[] = []

  for (const path of sources(ROOT)) {
    const relative = path.slice(ROOT.length + 1).split('\\').join('/')
    if (isAllowed(relative)) continue

    const code = stripComments(readFileSync(path, 'utf8'))
    for (const [index, line] of code.split('\n').entries()) {
      if (pattern.test(line)) hits.push(`${relative}:${index + 1}  ${line.trim().slice(0, 90)}`)
    }
  }
  return hits
}

describe('locale and currency stay in one place', () => {
  it('has no hand-rolled locale formatting', () => {
    /*
      `toLocaleString('en-GB')` and friends. Forty of these existed, which is
      why a date on the dashboard and the same date on an invoice could
      disagree about what day it was.
    */
    expect(offenders(/toLocale(?:Date|Time)?String\(\s*['"]en-/)).toEqual([])
  })

  it('names no locale outside the formatters', () => {
    // A bare 'en-GB' anywhere else is a decision being made in the wrong place.
    expect(offenders(/['"]en-GB['"]/)).toEqual([])
  })

  it('hard-codes no currency symbol', () => {
    /*
      The pound sign as a literal. Excluded by `ALLOWED` where it is genuinely
      the subject: a parser that must read `£12.34` off a receipt, and the
      starter contracts, whose prose is replaced per jurisdiction rather than
      formatted.
    */
    expect(offenders(/['"`][^'"`]*£/)).toEqual([])
  })
})

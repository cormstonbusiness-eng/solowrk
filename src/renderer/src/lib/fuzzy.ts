/**
 * Subsequence matching for the command palette.
 *
 * The rule people expect from a palette is that typing the initials of a thing
 * finds it — "ra" should reach "Rebrand 2026 — Acme" — while a run of letters
 * that happens to appear scattered through a long name should rank far below a
 * real prefix. So this scores rather than just filtering:
 *
 *   - matching at the start of a word is worth much more than mid-word
 *   - consecutive matches compound, so "reb" beats "r…e…b"
 *   - a shorter haystack wins ties, because it is the more specific answer
 *
 * Case is folded, but the returned indices point into the original string so
 * the caller can highlight what matched.
 */

export interface FuzzyMatch {
  score: number
  /** Indices in the original text that matched, for highlighting. */
  indices: number[]
}

const WORD_START = 12
const CONSECUTIVE = 8
const BASE = 1
/** Penalty per skipped character, so distant matches sink. */
const GAP = 0.4

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  const previous = text[index - 1] ?? ''
  return /[\s\-_/\\.,:#(]/.test(previous)
}

/**
 * Score `query` against `text`, or null when the query is not a subsequence.
 * An empty query matches everything with a score of 0, which keeps unfiltered
 * lists in their natural order.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query === '') return { score: 0, indices: [] }

  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()

  const indices: number[] = []
  let score = 0
  let cursor = 0
  let previousIndex = -1

  for (const character of needle) {
    // Spaces in the query are separators, not something to find.
    if (character === ' ') continue

    const found = haystack.indexOf(character, cursor)
    if (found === -1) return null

    score += BASE
    if (isBoundary(text, found)) score += WORD_START
    if (found === previousIndex + 1) score += CONSECUTIVE
    else if (previousIndex !== -1) score -= Math.min(GAP * (found - previousIndex - 1), 6)

    indices.push(found)
    previousIndex = found
    cursor = found + 1
  }

  // A whole-string prefix is almost always what was meant.
  if (haystack.startsWith(needle.replace(/ /g, ''))) score += 20

  // Shorter is more specific: "Acme" should beat "Acme Holdings Group" for "acme".
  score -= Math.min(text.length / 20, 5)

  return { score, indices }
}

export interface Scored<T> {
  item: T
  score: number
  indices: number[]
}

/** Filter and rank `items` by `query`, best first. */
export function fuzzyRank<T>(
  items: T[],
  query: string,
  text: (item: T) => string,
  limit = Infinity
): Scored<T>[] {
  const ranked: Scored<T>[] = []

  for (const item of items) {
    const match = fuzzyMatch(query, text(item))
    if (match) ranked.push({ item, score: match.score, indices: match.indices })
  }

  // A stable sort keeps the caller's ordering for equal scores, which is what
  // makes an empty query leave a list exactly as it was given.
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Split `text` into matched and unmatched runs, for rendering highlights. */
export function highlight(text: string, indices: number[]): { text: string; match: boolean }[] {
  if (indices.length === 0) return [{ text, match: false }]

  const marked = new Set(indices)
  const parts: { text: string; match: boolean }[] = []
  let current = ''
  let currentMatch = marked.has(0)

  for (let index = 0; index < text.length; index++) {
    const isMatch = marked.has(index)
    if (isMatch !== currentMatch) {
      if (current) parts.push({ text: current, match: currentMatch })
      current = ''
      currentMatch = isMatch
    }
    current += text[index]
  }
  if (current) parts.push({ text: current, match: currentMatch })

  return parts
}
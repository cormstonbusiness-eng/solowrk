import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzyRank, highlight } from './fuzzy'

const score = (query: string, text: string): number => fuzzyMatch(query, text)?.score ?? -Infinity

describe('fuzzyMatch', () => {
  it('matches a prefix', () => {
    expect(fuzzyMatch('reb', 'Rebrand 2026')).not.toBeNull()
  })

  it('matches a subsequence', () => {
    expect(fuzzyMatch('rbd', 'Rebrand')).not.toBeNull()
  })

  it('rejects letters that are not present in order', () => {
    expect(fuzzyMatch('dnarber', 'Rebrand')).toBeNull()
    expect(fuzzyMatch('rebz', 'Rebrand')).toBeNull()
  })

  it('ignores case', () => {
    expect(fuzzyMatch('REB', 'rebrand')).not.toBeNull()
  })

  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
  })

  it('treats spaces in the query as separators', () => {
    // "ac re" should reach "Acme Rebrand" without needing the space to exist.
    expect(fuzzyMatch('ac re', 'Acme Rebrand')).not.toBeNull()
  })

  it('reports where it matched, for highlighting', () => {
    expect(fuzzyMatch('br', 'Rebrand')?.indices).toEqual([2, 3])
  })
})

describe('ranking', () => {
  it('prefers a prefix over a mid-word match', () => {
    expect(score('ren', 'Renewal')).toBeGreaterThan(score('ren', 'Client Renewals'))
  })

  it('prefers word starts, so initials find things', () => {
    expect(score('ar', 'Acme Rebrand')).toBeGreaterThan(score('ar', 'Carpark survey'))
  })

  it('prefers consecutive letters over scattered ones', () => {
    expect(score('inv', 'Invoice')).toBeGreaterThan(score('inv', 'Interesting novel view'))
  })

  it('prefers the shorter of two equally good matches', () => {
    expect(score('acme', 'Acme')).toBeGreaterThan(score('acme', 'Acme Holdings Group Limited'))
  })

  it('ranks the obvious answer first in a realistic list', () => {
    const names = [
      'Carpark resurfacing',
      'Rebrand 2026',
      'Website refresh',
      'Acme Ltd — retainer'
    ]
    const [best] = fuzzyRank(names, 'reb', (name) => name)
    expect(best?.item).toBe('Rebrand 2026')
  })
})

describe('fuzzyRank', () => {
  it('drops items that do not match', () => {
    const ranked = fuzzyRank(['Alpha', 'Beta', 'Sundry'], 'a', (name) => name)
    expect(ranked.map((entry) => entry.item)).toEqual(['Alpha', 'Beta'])
  })

  it('puts the word-start match above the mid-word one', () => {
    const ranked = fuzzyRank(['Beta', 'Alpha'], 'a', (name) => name)
    expect(ranked[0]?.item).toBe('Alpha')
  })

  it('keeps the original order when the query is empty', () => {
    const names = ['Zebra', 'Apple', 'Mango']
    expect(fuzzyRank(names, '', (name) => name).map((entry) => entry.item)).toEqual(names)
  })

  it('honours the limit', () => {
    expect(fuzzyRank(['aa', 'ab', 'ac'], 'a', (name) => name, 2)).toHaveLength(2)
  })
})

describe('highlight', () => {
  it('splits into matched and unmatched runs', () => {
    expect(highlight('Rebrand', [0, 1, 2])).toEqual([
      { text: 'Reb', match: true },
      { text: 'rand', match: false }
    ])
  })

  it('handles a match in the middle', () => {
    expect(highlight('Rebrand', [2, 3])).toEqual([
      { text: 'Re', match: false },
      { text: 'br', match: true },
      { text: 'and', match: false }
    ])
  })

  it('returns the whole string when nothing matched', () => {
    expect(highlight('Rebrand', [])).toEqual([{ text: 'Rebrand', match: false }])
  })

  it('never loses characters', () => {
    const parts = highlight('Acme Rebrand 2026', [0, 5, 6, 13])
    expect(parts.map((part) => part.text).join('')).toBe('Acme Rebrand 2026')
  })
})
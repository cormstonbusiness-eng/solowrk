import { describe, expect, it } from 'vitest'
import { regionOf } from './suggestCountry'

/**
 * `suggestedCountry` itself needs Electron's `app`, so what is tested here is
 * the part with the logic in it: pulling a region out of a locale string.
 */
describe('regionOf', () => {
  it('finds the region in an ordinary locale', () => {
    expect(regionOf('en-IE')).toBe('IE')
    expect(regionOf('en-GB')).toBe('GB')
  })

  it('accepts an underscore, which some platforms use', () => {
    expect(regionOf('en_IE')).toBe('IE')
  })

  it('normalises case', () => {
    // Electron is consistent, but the value comes from the OS underneath it.
    expect(regionOf('en-ie')).toBe('IE')
  })

  it('skips a script subtag rather than reading it as a region', () => {
    /*
      Why the region is found by shape rather than by position. In
      `zh-Hans-CN` the second subtag is the script, so taking "the part after
      the dash" would yield `HANS` — not a country, and the fallback would
      then look like a deliberate choice rather than a parsing failure.
    */
    expect(regionOf('zh-Hans-CN')).toBe('CN')
    expect(regionOf('sr-Latn-RS')).toBe('RS')
  })

  it('finds nothing in a bare language', () => {
    expect(regionOf('en')).toBeNull()
    expect(regionOf('')).toBeNull()
  })

  it('finds nothing where there is no two-letter subtag', () => {
    expect(regionOf('en-Latn')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { composePost, overLimit } from './content'

/**
 * The join between a hook and a body.
 *
 * Small enough to look not worth testing, and exactly the thing that goes
 * wrong quietly: the count says 279 and the paste is 281, which nobody notices
 * until a platform refuses it.
 */

describe('composing a post', () => {
  it('separates the hook from the body by a blank line', () => {
    expect(composePost({ hook: 'A line', body: 'The rest.' })).toBe('A line\n\nThe rest.')
  })

  it('leaves no blank line when there is only one of them', () => {
    // A hook on its own is a whole post. A trailing pair of newlines would be
    // two invisible characters counted against a limit for nothing.
    expect(composePost({ hook: 'A line', body: '' })).toBe('A line')
    expect(composePost({ hook: '', body: 'The rest.' })).toBe('The rest.')
    expect(composePost({ hook: '   ', body: '  ' })).toBe('')
  })

  it('trims each part, so trailing whitespace is never counted', () => {
    expect(composePost({ hook: '  A line  ', body: '  The rest.  ' })).toBe('A line\n\nThe rest.')
  })
})

describe('the character limit', () => {
  it('says nothing when the channel set none', () => {
    // Most channels set none. A blog post has no maximum, and inventing one
    // would put a warning on writing at length.
    expect(overLimit('x'.repeat(10_000), null)).toBe(false)
  })

  it('counts the composed post, not the body alone', () => {
    // The two newlines between hook and body are characters the platform
    // counts, so this must too.
    const post = composePost({ hook: 'ab', body: 'cd' })
    expect(post).toHaveLength(6)
    expect(overLimit(post, 6)).toBe(false)
    expect(overLimit(post, 5)).toBe(true)
  })
})

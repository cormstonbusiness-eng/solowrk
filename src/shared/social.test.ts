import { describe, expect, it } from 'vitest'
import {
  PLATFORMS,
  canPublish,
  countHashtags,
  mediaKind,
  previewText,
  validateTarget,
  type Platform,
  type TargetDraft
} from './social'

const draft = (overrides: Partial<TargetDraft> = {}): TargetDraft => ({
  body: 'A perfectly ordinary post.',
  media: [],
  ...overrides
})

const errors = (platform: Platform, input: Partial<TargetDraft>): string[] =>
  validateTarget(platform, draft(input))
    .filter((problem) => problem.level === 'error')
    .map((problem) => problem.message)

const warnings = (platform: Platform, input: Partial<TargetDraft>): string[] =>
  validateTarget(platform, draft(input))
    .filter((problem) => problem.level === 'warning')
    .map((problem) => problem.message)

describe('mediaKind', () => {
  it('recognises images and video by extension, case-insensitively', () => {
    expect(mediaKind('shot.JPG')).toBe('image')
    expect(mediaKind('reel.mp4')).toBe('video')
    expect(mediaKind('brief.pdf')).toBe('other')
  })

  it('uses the last extension, not the first', () => {
    expect(mediaKind('archive.mp4.zip')).toBe('other')
  })

  it('treats a file with no extension as unusable rather than guessing', () => {
    expect(mediaKind('README')).toBe('other')
  })
})

describe('countHashtags', () => {
  it('counts hashtags at the start and after whitespace', () => {
    expect(countHashtags('#design and #branding')).toBe(2)
  })

  it('does not count a # inside a word', () => {
    // Otherwise "C# developer" reads as a hashtag, and a URL fragment reads as
    // several.
    expect(countHashtags('I write C# for a living')).toBe(0)
    expect(countHashtags('see https://example.com/page#section')).toBe(0)
  })

  it('counts a hashtag after an opening bracket', () => {
    expect(countHashtags('a post (#sponsored)')).toBe(1)
  })

  it('handles accented and non-Latin hashtags', () => {
    expect(countHashtags('#diseño #デザイン')).toBe(2)
  })

  it('ignores a bare hash', () => {
    expect(countHashtags('number # 5')).toBe(0)
  })
})

describe('previewText', () => {
  it('leaves short captions alone', () => {
    expect(previewText('Short', 'instagram')).toBe('Short')
  })

  it('truncates at the platform’s fold', () => {
    const long = 'x'.repeat(200)
    expect(previewText(long, 'instagram')).toHaveLength(PLATFORMS.instagram.previewLimit! + 1)
  })
})

describe('body limits', () => {
  it('accepts a caption at exactly the limit', () => {
    expect(errors('linkedin', { body: 'x'.repeat(3000) })).toEqual([])
  })

  it('rejects one character over, and says by how much', () => {
    expect(errors('linkedin', { body: 'x'.repeat(3001) })[0]).toContain('1 characters over')
  })

  it('applies each platform’s own limit', () => {
    // The same caption is too long for Instagram and fine for LinkedIn. The
    // image is supplied so the only difference between the two is the limit.
    const caption = 'x'.repeat(2500)
    expect(errors('instagram', { body: caption, media: ['a.jpg'] })).toHaveLength(1)
    expect(errors('linkedin', { body: caption })).toEqual([])
  })

  it('rejects a Pinterest title over 100 characters', () => {
    expect(
      errors('pinterest', {
        title: 'x'.repeat(101),
        media: ['a.jpg'],
        boardId: 'b1'
      })
    ).toContainEqual(expect.stringContaining('Title'))
  })
})

describe('media requirements', () => {
  it('lets LinkedIn post text alone', () => {
    expect(errors('linkedin', {})).toEqual([])
  })

  it('requires Instagram to have an image or video', () => {
    expect(errors('instagram', {})).toContainEqual(expect.stringContaining('at least 1'))
    expect(errors('instagram', { media: ['shot.jpg'] })).toEqual([])
  })

  it('requires TikTok to have a video, not an image', () => {
    expect(errors('tiktok', { media: ['shot.jpg'] })).toContainEqual(
      expect.stringContaining('exactly one video')
    )
    expect(errors('tiktok', { media: ['reel.mp4'] })).toEqual([])
  })

  it('holds TikTok to one video', () => {
    expect(errors('tiktok', { media: ['a.mp4', 'b.mp4'] })).toContainEqual(
      expect.stringContaining('at most 1')
    )
  })

  it('requires Pinterest to have exactly one image and a board', () => {
    expect(errors('pinterest', { media: ['a.jpg'] })).toEqual(['Choose a Pinterest board to pin to.'])
    expect(errors('pinterest', { media: ['a.jpg'], boardId: 'b1' })).toEqual([])
    expect(errors('pinterest', { media: ['a.mp4'], boardId: 'b1' })).toContainEqual(
      expect.stringContaining('exactly one image')
    )
  })

  it('warns about attachments the platform cannot use, without blocking', () => {
    const problems = validateTarget('linkedin', draft({ media: ['brief.pdf'] }))
    expect(problems.every((problem) => problem.level === 'warning')).toBe(true)
    expect(problems[0]?.message).toContain('will be skipped')
  })

  it('does not count an unusable file towards the minimum', () => {
    // A PDF attached to an Instagram post is not an image, so the post is still
    // missing its required media rather than satisfying it.
    expect(errors('instagram', { media: ['brief.pdf'] })).toContainEqual(
      expect.stringContaining('at least 1')
    )
  })
})

describe('platform quirks', () => {
  it('rejects more than 30 hashtags on Instagram', () => {
    const tags = Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(' ')
    expect(errors('instagram', { body: tags, media: ['a.jpg'] })[0]).toContain('31 hashtags')
  })

  it('allows exactly 30', () => {
    const tags = Array.from({ length: 30 }, (_, index) => `#tag${index}`).join(' ')
    expect(errors('instagram', { body: tags, media: ['a.jpg'] })).toEqual([])
  })

  it('does not count hashtags on platforms that do not limit them', () => {
    const tags = Array.from({ length: 50 }, (_, index) => `#tag${index}`).join(' ')
    expect(errors('linkedin', { body: tags })).toEqual([])
  })

  it('warns that Instagram links are not clickable', () => {
    expect(warnings('instagram', { body: 'Read more at https://example.com', media: ['a.jpg'] }))
      .toContainEqual(expect.stringContaining('not clickable'))
  })

  it('warns that a connected TikTok posts privately until the audit passes', () => {
    expect(warnings('tiktok', { media: ['a.mp4'], connected: true })).toContainEqual(
      expect.stringContaining('visible only to you')
    )
  })

  it('warns when a caption runs past the fold', () => {
    expect(warnings('linkedin', { body: 'x'.repeat(400) })).toContainEqual(
      expect.stringContaining('first 210 characters')
    )
  })

  it('does not warn about the fold on a short caption', () => {
    expect(warnings('linkedin', { body: 'Short and sharp.' })).toEqual([])
  })
})

describe('empty posts', () => {
  it('refuses a post with neither caption nor media', () => {
    expect(errors('linkedin', { body: '   ' })).toContainEqual(
      expect.stringContaining('Nothing to post')
    )
  })

  it('accepts an image with no caption', () => {
    expect(errors('instagram', { body: '', media: ['a.jpg'] })).toEqual([])
  })
})

describe('ordering and canPublish', () => {
  it('puts errors above warnings', () => {
    const problems = validateTarget(
      'instagram',
      draft({ body: `${'x'.repeat(3000)} https://example.com` })
    )
    expect(problems[0]?.level).toBe('error')
    expect(problems.at(-1)?.level).toBe('warning')
  })

  it('blocks only on errors', () => {
    expect(canPublish('linkedin', draft({ body: 'x'.repeat(3001) }))).toBe(false)
    // Long enough to warn about the fold, but perfectly publishable.
    expect(canPublish('linkedin', draft({ body: 'x'.repeat(400) }))).toBe(true)
  })
})

describe('the registry itself', () => {
  it('agrees with itself about which platforms schedule natively', () => {
    // These two are why a post can be handed over and published while SoloWrk
    // is closed; the rest are jobs the app has to run itself.
    expect(PLATFORM_IDS_WITH_NATIVE_SCHEDULING()).toEqual(['facebook', 'pinterest'])
  })

  it('gives every platform a sane media range', () => {
    for (const spec of Object.values(PLATFORMS)) {
      expect(spec.media.min).toBeLessThanOrEqual(spec.media.max)
      expect(spec.media.kinds.length).toBeGreaterThan(0)
    }
  })
})

function PLATFORM_IDS_WITH_NATIVE_SCHEDULING(): string[] {
  return Object.values(PLATFORMS)
    .filter((spec) => spec.nativeSchedule)
    .map((spec) => spec.id)
}
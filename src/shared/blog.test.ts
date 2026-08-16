import { describe, expect, it } from 'vitest'
import {
  canPublish,
  isValidSlug,
  parseFrontmatter,
  parsePost,
  postPath,
  readingMinutes,
  serialisePost,
  slugify,
  validatePost,
  type BlogPost
} from './blog'

const post = (patch: Partial<BlogPost> = {}): BlogPost => ({
  slug: 'what-a-fixed-price-covers',
  title: 'What a fixed price actually covers',
  excerpt: 'What is in a quote, and what is not.',
  date: '2026-08-16',
  updated: '',
  category: 'Working with me',
  image: '',
  imageAlt: '',
  author: 'Craig Ormston',
  draft: true,
  body: 'The short answer is everything we agreed.',
  published: false,
  modifiedAt: '',
  ...patch
})

describe('slugify', () => {
  it('makes a URL segment out of a title', () => {
    expect(slugify('What a fixed price actually covers')).toBe(
      'what-a-fixed-price-actually-covers'
    )
  })

  it('drops apostrophes rather than replacing them', () => {
    // "what-s-it-cost" is the classic slug bug, and it looks broken forever
    // because the URL can never be changed after publication.
    expect(slugify("What's it cost?")).toBe('whats-it-cost')
    expect(slugify('The client’s brief')).toBe('the-clients-brief')
  })

  it('strips accents to their base letters', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume')
  })

  it('collapses punctuation and runs of spaces', () => {
    expect(slugify('Fixed prices — really?   Yes.')).toBe('fixed-prices-really-yes')
  })

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugify('  ...Hello!  ')).toBe('hello')
    expect(slugify('£££')).toBe('')
  })

  it('truncates without leaving a trailing hyphen', () => {
    // Slicing mid-word can land exactly on a separator, and "post-" is not a
    // slug anyone would type.
    const slug = slugify(`${'word '.repeat(40)}end`)
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
    expect(isValidSlug(slug)).toBe(true)
  })
})

describe('isValidSlug', () => {
  it('accepts what slugify produces', () => {
    expect(isValidSlug('what-a-fixed-price-covers')).toBe(true)
    expect(isValidSlug('post2026')).toBe(true)
  })

  it('rejects anything a route or a filesystem would choke on', () => {
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('Has-Capitals')).toBe(false)
    expect(isValidSlug('trailing-')).toBe(false)
    expect(isValidSlug('-leading')).toBe(false)
    expect(isValidSlug('double--hyphen')).toBe(false)
    expect(isValidSlug('has spaces')).toBe(false)
    expect(isValidSlug('../escape')).toBe(false)
    expect(isValidSlug('sub/path')).toBe(false)
  })
})

describe('readingMinutes', () => {
  it('never reports zero', () => {
    expect(readingMinutes('One word')).toBe(1)
    expect(readingMinutes('')).toBe(1)
  })

  it('counts at 200 words a minute', () => {
    expect(readingMinutes('word '.repeat(600))).toBe(3)
  })
})

describe('parseFrontmatter', () => {
  it('reads a block and returns the body after it', () => {
    const { data, body } = parseFrontmatter('---\ntitle: "Hello"\ndraft: false\n---\n\nBody here.')
    expect(data.title).toBe('Hello')
    expect(data.draft).toBe(false)
    expect(body.trim()).toBe('Body here.')
  })

  it('handles CRLF line endings', () => {
    // These files live in a git repo on Windows, so core.autocrlf decides how
    // they arrive. A parser that only knows \n leaves a \r on every value.
    const { data, body } = parseFrontmatter('---\r\ntitle: "Hello"\r\n---\r\n\r\nBody.')
    expect(data.title).toBe('Hello')
    expect(body.trim()).toBe('Body.')
  })

  it('tolerates unquoted and single-quoted values from a hand edit', () => {
    const { data } = parseFrontmatter("---\ntitle: Plain text\ncategory: 'Websites'\n---\n")
    expect(data.title).toBe('Plain text')
    expect(data.category).toBe('Websites')
  })

  it('keeps a colon inside a quoted value', () => {
    const { data } = parseFrontmatter('---\ntitle: "Pricing: the honest version"\n---\n')
    expect(data.title).toBe('Pricing: the honest version')
  })

  it('returns the whole file as body when there is no frontmatter', () => {
    expect(parseFrontmatter('Just text.').body).toBe('Just text.')
    expect(parseFrontmatter('Just text.').data).toEqual({})
  })

  it('ignores a line with no colon rather than guessing', () => {
    const { data } = parseFrontmatter('---\ntitle: "A"\nnonsense\n---\n')
    expect(data.title).toBe('A')
    expect(Object.keys(data)).toEqual(['title'])
  })
})

describe('serialisePost and parsePost round-trip', () => {
  it('survives a title containing a colon', () => {
    const original = post({ title: 'Pricing: the honest version' })
    const parsed = parsePost(original.slug, serialisePost(original))
    expect(parsed.title).toBe('Pricing: the honest version')
  })

  it('survives quotes and backslashes', () => {
    // Unescaped, either one truncates the value or breaks the YAML entirely.
    const original = post({ title: 'He said "no" \\ then left', excerpt: 'A "quoted" thing' })
    const parsed = parsePost(original.slug, serialisePost(original))
    expect(parsed.title).toBe('He said "no" \\ then left')
    expect(parsed.excerpt).toBe('A "quoted" thing')
  })

  it('preserves every field', () => {
    const original = post({
      image: '/blog/hero.webp',
      imageAlt: 'A workbench',
      updated: '2026-09-01',
      draft: false
    })
    const parsed = parsePost(original.slug, serialisePost(original))

    expect(parsed.title).toBe(original.title)
    expect(parsed.excerpt).toBe(original.excerpt)
    expect(parsed.date).toBe('2026-08-16')
    expect(parsed.updated).toBe('2026-09-01')
    expect(parsed.category).toBe('Working with me')
    expect(parsed.image).toBe('/blog/hero.webp')
    expect(parsed.imageAlt).toBe('A workbench')
    expect(parsed.author).toBe('Craig Ormston')
    expect(parsed.draft).toBe(false)
    expect(parsed.body).toBe(original.body)
  })

  it('normalises CRLF in the body', () => {
    // A file checked out with CRLF would otherwise be written back with mixed
    // endings, and every save would show as a whole-file diff in git.
    const parsed = parsePost('x', '---\r\ntitle: "A"\r\n---\r\n\r\nOne.\r\nTwo.\r\n')
    expect(parsed.body).toBe('One.\nTwo.')
  })

  it('writes an identical file when nothing changed', () => {
    // Otherwise every open-and-close shows up as a diff in git, and the publish
    // step cannot tell a real edit from having looked at the post.
    const once = serialisePost(post())
    expect(serialisePost(parsePost('x', once))).toBe(once)
  })

  it('omits the image fields entirely when there is no image', () => {
    // `image: ""` is a path that resolves to the site root, not "no image".
    expect(serialisePost(post())).not.toContain('image:')
  })

  it('treats a missing draft field as a draft', () => {
    // The safe direction. A mistyped field must not publish a post.
    expect(parsePost('x', '---\ntitle: "A"\n---\nBody').draft).toBe(true)
    expect(parsePost('x', '---\ntitle: "A"\ndraft: false\n---\nBody').draft).toBe(false)
  })

  it('ends with exactly one newline', () => {
    const file = serialisePost(post({ body: 'Text.\n\n\n' }))
    expect(file.endsWith('Text.\n')).toBe(true)
  })
})

describe('validatePost', () => {
  it('passes a complete post', () => {
    expect(validatePost(post())).toEqual([])
    expect(canPublish(post())).toBe(true)
  })

  it('catches the fields that would render as undefined on a live page', () => {
    const problems = validatePost(post({ title: '', excerpt: '', category: '', body: '' }))
    const fields = problems.map((problem) => problem.field)

    expect(fields).toContain('title')
    expect(fields).toContain('excerpt')
    expect(fields).toContain('category')
    expect(fields).toContain('body')
    expect(canPublish(post({ title: '' }))).toBe(false)
  })

  it('rejects a slug that would not resolve as a route', () => {
    expect(canPublish(post({ slug: 'Not A Slug' }))).toBe(false)
    expect(canPublish(post({ slug: '../escape' }))).toBe(false)
  })

  it('rejects a malformed date', () => {
    expect(canPublish(post({ date: '16/08/2026' }))).toBe(false)
    expect(canPublish(post({ date: '' }))).toBe(false)
  })

  it('warns but does not block on a long excerpt', () => {
    const long = post({ excerpt: 'x'.repeat(240) })
    expect(validatePost(long).some((p) => p.field === 'excerpt' && p.level === 'warning')).toBe(true)
    expect(canPublish(long)).toBe(true)
  })

  it('warns about a hero image with no alt text', () => {
    const problems = validatePost(post({ image: '/blog/hero.webp', imageAlt: '' }))
    expect(problems.some((p) => p.field === 'imageAlt' && p.level === 'warning')).toBe(true)
    expect(canPublish(post({ image: '/blog/hero.webp' }))).toBe(true)
  })

  it('puts errors before warnings', () => {
    const problems = validatePost(post({ title: '', excerpt: 'x'.repeat(240) }))
    expect(problems[0]!.level).toBe('error')
  })
})

describe('postPath', () => {
  it('puts posts where the site reads them from', () => {
    expect(postPath('a-post')).toBe('content/blog/a-post.md')
  })
})

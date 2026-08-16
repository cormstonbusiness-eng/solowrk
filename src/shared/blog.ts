/**
 * Blog posts as they exist on disk: a markdown file with YAML frontmatter.
 *
 * The file is the record. SoloWrk does not keep a database table of posts —
 * the site repository is already the source of truth and already versioned by
 * git, and a second copy would only ever drift out of step with it. This is
 * the same reasoning as Notes, where a note *is* its file.
 *
 * Everything here is pure and runs in both processes, so the editor and the
 * publisher agree byte for byte on what a post file looks like.
 */

/** Where posts live inside the site repository. */
export const POSTS_DIR = 'content/blog'

/** Words per minute. Matches `lib/posts.ts` on the site, so estimates agree. */
const READING_SPEED = 200

/** Suggested in the editor. Free text — the site does not restrict it. */
export const SUGGESTED_CATEGORIES = [
  'Websites',
  'Custom software',
  'Working with me',
  'Running a business',
  'Behind the build'
]

export interface BlogPost {
  slug: string
  title: string
  excerpt: string
  /** yyyy-mm-dd */
  date: string
  updated: string
  category: string
  /** Path under the site's /public, e.g. "/blog/why-fixed-prices.webp". */
  image: string
  imageAlt: string
  author: string
  draft: boolean
  body: string
  /** True once the post has been committed — the slug is frozen from then on. */
  published: boolean
  /** Set from the file's mtime, for sorting drafts by what you touched last. */
  modifiedAt: string
}

export interface BlogProblem {
  field: string
  message: string
  level: 'error' | 'warning'
}

/* ------------------------------------------------------------------ slugs */

/**
 * A title turned into a URL segment.
 *
 * Apostrophes are removed rather than replaced, so "What's it cost" becomes
 * `whats-it-cost` and not `what-s-it-cost`. Accented letters are decomposed to
 * their base form first, because a URL with a literal é in it is a URL that
 * gets mangled somewhere between an email client and a browser.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/** A slug the site can turn into a route, and a filesystem can hold. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80
}

export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length
  // Never "0 min read".
  return Math.max(1, Math.round(words / READING_SPEED))
}

/* ------------------------------------------------------- frontmatter I/O */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Read the frontmatter block and the body after it.
 *
 * Deliberately not a general YAML parser — it reads the subset this app
 * writes, and tolerates the ways a human hand-editing the file might differ
 * (unquoted values, single quotes, stray spaces). Anything it does not
 * understand is left as a string rather than guessed at.
 *
 * CRLF is handled throughout. These files live in a git repository on Windows,
 * so they will arrive with either ending depending on `core.autocrlf`, and a
 * parser that only knows `\n` would leave a trailing `\r` on every value.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, string | boolean>
  body: string
} {
  const match = FRONTMATTER.exec(raw)
  if (!match) return { data: {}, body: raw.replace(/^\r?\n/, '') }

  const data: Record<string, string | boolean> = {}

  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    // A line with no colon is not a field. Skipped rather than guessed at.
    if (separator <= 0) continue

    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()

    if (value === 'true' || value === 'false') {
      data[key] = value === 'true'
      continue
    }

    data[key] = unquote(value)
  }

  return { data, body: raw.slice(match[0].length) }
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    // Double-quoted YAML scalars escape with a backslash.
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/**
 * Always double-quoted, always escaped.
 *
 * A title is arbitrary text — it will eventually contain a colon, a quote or a
 * hash, and every one of those changes what unquoted YAML means. Quoting
 * unconditionally costs two characters and removes the whole class of problem.
 */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function asDate(value: unknown): string {
  return typeof value === 'string' && ISO_DATE.test(value.trim()) ? value.trim() : ''
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parsePost(
  slug: string,
  raw: string,
  meta: { modifiedAt?: string; published?: boolean } = {}
): BlogPost {
  const { data, body } = parseFrontmatter(raw)

  return {
    slug,
    title: asText(data.title),
    excerpt: asText(data.excerpt),
    date: asDate(data.date),
    updated: asDate(data.updated),
    category: asText(data.category),
    image: asText(data.image),
    imageAlt: asText(data.imageAlt),
    author: asText(data.author),
    // Anything other than an explicit `false` is a draft. Getting this the
    // wrong way round would publish a post the moment the field was mistyped.
    draft: data.draft !== false,
    // Normalised on the way in: line endings to \n, and no leading or trailing
    // blank lines. Without this a file checked out with CRLF would be written
    // back with mixed endings, and every save would show as a whole-file diff.
    body: body.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, ''),
    published: meta.published ?? false,
    modifiedAt: meta.modifiedAt ?? ''
  }
}

/** The complete file contents for a post. */
export function serialisePost(post: BlogPost): string {
  const lines = ['---', `title: ${quote(post.title)}`, `excerpt: ${quote(post.excerpt)}`]

  lines.push(`date: ${quote(post.date)}`)
  if (post.updated !== '') lines.push(`updated: ${quote(post.updated)}`)
  lines.push(`category: ${quote(post.category)}`)

  // Omitted rather than written empty: the site treats an absent image as "no
  // hero", and `image: ""` would be a path that resolves to the site root.
  if (post.image !== '') {
    lines.push(`image: ${quote(post.image)}`)
    lines.push(`imageAlt: ${quote(post.imageAlt)}`)
  }

  if (post.author !== '') lines.push(`author: ${quote(post.author)}`)
  lines.push(`draft: ${post.draft ? 'true' : 'false'}`)
  lines.push('---', '')

  // Exactly one trailing newline, so re-saving an untouched post produces an
  // identical file and does not show up as a change in git.
  return `${lines.join('\n')}\n${post.body.replace(/\s+$/, '')}\n`
}

/* -------------------------------------------------------------- validation */

/** How long an excerpt can run before search engines cut it off. */
const EXCERPT_LIMIT = 200

export function validatePost(post: BlogPost): BlogProblem[] {
  const problems: BlogProblem[] = []

  const error = (field: string, message: string): void => {
    problems.push({ field, message, level: 'error' })
  }
  const warn = (field: string, message: string): void => {
    problems.push({ field, message, level: 'warning' })
  }

  if (post.title.trim() === '') error('title', 'A post needs a title.')
  if (post.excerpt.trim() === '') {
    error('excerpt', 'The excerpt is the description search engines show.')
  } else if (post.excerpt.length > EXCERPT_LIMIT) {
    warn('excerpt', `${post.excerpt.length} characters — Google shows about ${EXCERPT_LIMIT}.`)
  }

  if (post.category.trim() === '') error('category', 'Pick a category.')
  if (!ISO_DATE.test(post.date)) error('date', 'A post needs a publication date.')
  if (!isValidSlug(post.slug)) {
    error('slug', 'Lowercase letters, numbers and hyphens only.')
  }

  if (post.body.trim() === '') error('body', 'There is nothing written yet.')

  // A hero image without alt text is the single most common accessibility
  // failure on a blog, and it is invisible until someone cannot see the page.
  if (post.image !== '' && post.imageAlt.trim() === '') {
    warn('imageAlt', 'Describe the image for anyone who cannot see it.')
  }

  return problems.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}

/** Errors stop a publish; warnings do not. */
export function canPublish(post: BlogPost): boolean {
  return !validatePost(post).some((problem) => problem.level === 'error')
}

/** Where a post's file sits inside the site repository. */
export function postPath(slug: string): string {
  return `${POSTS_DIR}/${slug}.md`
}

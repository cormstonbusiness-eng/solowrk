import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Database, Row } from '../db'
import type { BlogPost } from '@shared/blog'
import type { WebsiteDeploy } from '@shared/types'
import {
  POSTS_DIR,
  canPublish as postCanPublish,
  parsePost,
  postPath,
  serialisePost,
  slugify,
  validatePost
} from '@shared/blog'
import { commitFiles, deployState } from './github'
import { modifiedAt, parseRepo, resolveInSite, siteConnection } from './site'
import { today } from '@shared/taxYear'

/**
 * Blog posts, read from and written to the site repository.
 *
 * There is no posts table. The markdown files are the record, git is the
 * history, and a database cache would only ever be a second version of the
 * truth that disagrees with the first. What *is* stored is the publish log —
 * what was committed and when — because that is SoloWrk's own knowledge and
 * nothing in the repository records it.
 */

function root(db: Database): string {
  const { path } = siteConnection(db)
  if (path === '') {
    throw new Error('No website folder is set. Connect your site in Settings → Website.')
  }
  return path
}

/** Slugs that have been committed, so the editor knows to freeze them. */
function publishedSlugs(db: Database): Set<string> {
  const rows = db.all<Row & { slug: string }>('SELECT DISTINCT slug FROM website_deploys')
  return new Set(rows.map((row) => row.slug))
}

export async function listPosts(db: Database): Promise<BlogPost[]> {
  const folder = resolveInSite(root(db), POSTS_DIR)
  const published = publishedSlugs(db)

  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    // The folder does not exist yet — a site connected before the blog was
    // added. An empty list is the honest answer, not an error.
    return []
  }

  const posts = await Promise.all(
    names
      .filter((name) => name.endsWith('.md'))
      .map(async (name) => {
        const slug = basename(name, '.md')
        const file = join(folder, name)
        return parsePost(slug, await readFile(file, 'utf8'), {
          modifiedAt: await modifiedAt(file),
          published: published.has(slug)
        })
      })
  )

  // Drafts first — they are the ones needing attention — then newest by date.
  return posts.sort((a, b) => {
    if (a.draft !== b.draft) return a.draft ? -1 : 1
    return b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
  })
}

export async function getPost(db: Database, slug: string): Promise<BlogPost> {
  const file = resolveInSite(root(db), postPath(slug))
  return parsePost(slug, await readFile(file, 'utf8'), {
    modifiedAt: await modifiedAt(file),
    published: publishedSlugs(db).has(slug)
  })
}

/**
 * Create a post as a draft.
 *
 * The slug is derived from the title and made unique against what is already
 * there, because two posts sharing a filename means one silently overwrites
 * the other.
 */
export async function createPost(db: Database, title: string): Promise<BlogPost> {
  const folder = resolveInSite(root(db), POSTS_DIR)
  await mkdir(folder, { recursive: true })

  const existing = new Set((await listPosts(db)).map((post) => post.slug))
  const base = slugify(title) || 'untitled'

  let slug = base
  for (let suffix = 2; existing.has(slug); suffix++) slug = `${base}-${suffix}`

  const post: BlogPost = {
    slug,
    title,
    excerpt: '',
    date: today(),
    updated: '',
    category: '',
    image: '',
    imageAlt: '',
    author: '',
    draft: true,
    body: '',
    published: false,
    modifiedAt: ''
  }

  await writeFile(resolveInSite(root(db), postPath(slug)), serialisePost(post), 'utf8')
  return getPost(db, slug)
}

/**
 * Save a post.
 *
 * A rename moves the file, but only while the post is unpublished — the slug is
 * the live URL, and changing it after publication breaks every link to it and
 * anything already indexed.
 */
export async function savePost(
  db: Database,
  slug: string,
  patch: Partial<BlogPost>
): Promise<BlogPost> {
  const current = await getPost(db, slug)
  const next: BlogPost = { ...current, ...patch, slug: patch.slug ?? current.slug }

  if (next.slug !== current.slug) {
    if (current.published) {
      throw new Error(
        'This post is already published, so its address cannot change — every link to it ' +
          'and anything Google has indexed would break.'
      )
    }

    const taken = (await listPosts(db)).some((post) => post.slug === next.slug)
    if (taken) throw new Error(`There is already a post at “${next.slug}”.`)

    await unlink(resolveInSite(root(db), postPath(current.slug)))
  }

  await writeFile(resolveInSite(root(db), postPath(next.slug)), serialisePost(next), 'utf8')
  return getPost(db, next.slug)
}

/** Deletes the markdown file. A published post has to be unpublished first. */
export async function deletePost(db: Database, slug: string): Promise<void> {
  const post = await getPost(db, slug)
  if (post.published) {
    throw new Error(
      'This post is live. Removing it from the site is a publish of its own — ' +
        'unpublish it first so the change reaches the website.'
    )
  }
  await unlink(resolveInSite(root(db), postPath(slug)))
}

/**
 * Publish: commit the post to the site repository, and let the host rebuild.
 *
 * `draft` is flipped to false in the committed file rather than in the local
 * one first, so a failed publish leaves nothing half-changed on disk.
 */
export async function publishPost(
  db: Database,
  slug: string,
  options: { unpublish?: boolean } = {}
): Promise<WebsiteDeploy> {
  const connection = siteConnection(db)
  const repo = parseRepo(connection.repo)
  if (!repo) {
    throw new Error(`“${connection.repo}” is not a repository name. Use owner/repo.`)
  }

  const post = await getPost(db, slug)
  const going = options.unpublish === true

  if (!going) {
    const problems = validatePost(post).filter((problem) => problem.level === 'error')
    if (problems.length > 0) {
      throw new Error(`This post is not ready: ${problems[0]!.message}`)
    }
    if (!postCanPublish(post)) throw new Error('This post is not ready to publish.')
  }

  // A post that has been live and is being edited records when it changed.
  const wasPublished = post.published && !post.draft
  const published: BlogPost = {
    ...post,
    draft: going,
    updated: wasPublished && !going ? today() : post.updated
  }

  const message = going
    ? `Unpublish “${post.title}”`
    : wasPublished
      ? `Update “${post.title}”`
      : `Publish “${post.title}”`

  const result = await commitFiles(repo.owner, repo.name, connection.branch, message, [
    { path: postPath(slug), content: serialisePost(published), encoding: 'utf-8' }
  ])

  // Only once the commit landed. If the network failed above, the file on disk
  // still says draft, which is the truth.
  await writeFile(resolveInSite(root(db), postPath(slug)), serialisePost(published), 'utf8')

  return record(db, {
    slug,
    title: post.title,
    sha: result.sha,
    url: result.url,
    action: going ? 'unpublish' : wasPublished ? 'update' : 'publish'
  })
}

function record(
  db: Database,
  entry: { slug: string; title: string; sha: string; url: string; action: string }
): WebsiteDeploy {
  db.run(
    `INSERT INTO website_deploys (slug, title, sha, commit_url, action, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [entry.slug, entry.title, entry.sha, entry.url, entry.action]
  )

  return listDeploys(db, 1)[0]!
}

export function listDeploys(db: Database, limit = 20): WebsiteDeploy[] {
  return db
    .all<Row & {
      id: number
      slug: string
      title: string
      sha: string
      commit_url: string
      action: string
      created_at: string
    }>('SELECT * FROM website_deploys ORDER BY id DESC LIMIT ?', [limit])
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      sha: row.sha,
      commitUrl: row.commit_url,
      action: row.action as WebsiteDeploy['action'],
      createdAt: row.created_at
    }))
}

/** The state of the most recent publish, for the overview page. */
export async function lastDeploy(
  db: Database
): Promise<{ deploy: WebsiteDeploy | null; state: string; url: string }> {
  const [deploy] = listDeploys(db, 1)
  if (!deploy) return { deploy: null, state: 'none', url: '' }

  const repo = parseRepo(siteConnection(db).repo)
  if (!repo) return { deploy, state: 'none', url: '' }

  const status = await deployState(repo.owner, repo.name, deploy.sha)
  return { deploy, state: status.state, url: status.url }
}
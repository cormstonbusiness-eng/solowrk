import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import type { Dirent } from 'node:fs'
import type { Database } from '../db'
import type { SiteImage } from '@shared/types'
import { commitFiles } from './github'
import { parseRepo, resolveInSite, siteConnection } from './site'

/**
 * The images on the user's website.
 *
 * Everything lives in the site's `public/` folder and is committed to the
 * repository like any other file — there is no CDN and no upload endpoint, so
 * "add an image" means write it into `public/` and include it in the next
 * commit.
 *
 * Resizing and WebP encoding deliberately do NOT happen here. They happen in
 * the renderer, on a canvas: Chromium already has a first-class WebP encoder,
 * so doing it there means no `sharp` and no native module, which is a hard
 * rule in this app rather than a preference. This module only ever handles
 * bytes that are already in their final form.
 */

const PUBLIC_DIR = 'public'

/** Where the source lives, for working out which images nothing references. */
const SOURCE_DIRS = ['app', 'components', 'lib', 'content', 'src', 'pages']

const IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.avif']

function root(db: Database): string {
  const { path } = siteConnection(db)
  if (path === '') {
    throw new Error('No website folder is set. Connect your site in Settings → Website.')
  }
  return path
}

/** Every file under a folder, as paths relative to it. */
async function walk(base: string, current = ''): Promise<string[]> {
  // Typed explicitly: `Awaited<ReturnType<typeof readdir>>` resolves to the
  // Buffer overload rather than the string one.
  let entries: Dirent[]
  try {
    entries = await readdir(join(base, current), { withFileTypes: true })
  } catch {
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    // posix.join throughout: these become web paths and repository paths, and
    // a backslash is valid in neither.
    const relative = current === '' ? entry.name : posix.join(current, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await walk(base, relative)))
    } else {
      found.push(relative)
    }
  }
  return found
}

/**
 * Which image filenames appear anywhere in the site's source.
 *
 * Matched on the filename rather than the full path, because a component may
 * build a path from a variable. That makes this deliberately generous: it is
 * far better to call an unused image used than to tell someone it is safe to
 * delete something the site is actually rendering.
 */
async function referencedNames(sitePath: string): Promise<Set<string>> {
  const names = new Set<string>()

  for (const dir of SOURCE_DIRS) {
    const base = resolveInSite(sitePath, dir)
    for (const file of await walk(base)) {
      if (/\.(tsx?|jsx?|mjs|md|mdx|json|css|html)$/i.test(file)) {
        try {
          const contents = await readFile(join(base, file), 'utf8')
          for (const match of contents.matchAll(/[\w.-]+\.(?:webp|png|jpe?g|gif|svg|avif)/gi)) {
            names.add(match[0].toLowerCase())
          }
        } catch {
          // Unreadable file — it simply contributes no references.
        }
      }
    }
  }

  return names
}

export async function listImages(db: Database): Promise<SiteImage[]> {
  const sitePath = root(db)
  const base = resolveInSite(sitePath, PUBLIC_DIR)

  const files = (await walk(base)).filter((file) =>
    IMAGE_EXTENSIONS.includes(extname(file).toLowerCase())
  )

  const referenced = await referencedNames(sitePath)

  const images = await Promise.all(
    files.map(async (file) => {
      const info = await stat(join(base, file)).catch(() => null)
      const name = posix.basename(file)

      return {
        // The path the site uses in markup, which is what makes it useful to
        // copy into a post's hero field.
        webPath: `/${file}`,
        repoPath: `${PUBLIC_DIR}/${file}`,
        name,
        bytes: info?.size ?? 0,
        modifiedAt: info?.mtime.toISOString() ?? '',
        used: referenced.has(name.toLowerCase())
      }
    })
  )

  // Largest first: the ones worth attention are the ones slowing the site down.
  return images.sort((a, b) => b.bytes - a.bytes)
}

/** A data URL, because the renderer is sandboxed and cannot read the folder. */
export async function imageDataUrl(db: Database, repoPath: string): Promise<string> {
  const absolute = resolveInSite(root(db), repoPath)
  const bytes = await readFile(absolute)
  return `data:${mimeFor(repoPath)};base64,${bytes.toString('base64')}`
}

/** The same bridge, for a file being imported from outside the site. */
export async function sourceDataUrl(absolutePath: string): Promise<string> {
  const bytes = await readFile(absolutePath)
  return `data:${mimeFor(absolutePath)};base64,${bytes.toString('base64')}`
}

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return `image/${extension.slice(1)}`
}

/**
 * Write an already-encoded image into `public/`.
 *
 * The name is made unique rather than overwriting, because replacing an image
 * that a published post already points at changes that post silently.
 */
export async function addImage(
  db: Database,
  options: { folder: string; name: string; base64: string }
): Promise<SiteImage> {
  const sitePath = root(db)

  const folder = options.folder.replace(/^\/+|\/+$/g, '')
  const safeName = options.name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (safeName === '' || !IMAGE_EXTENSIONS.includes(extname(safeName))) {
    throw new Error('That is not an image filename.')
  }

  const target = folder === '' ? PUBLIC_DIR : posix.join(PUBLIC_DIR, folder)
  await mkdir(resolveInSite(sitePath, target), { recursive: true })

  const existing = new Set(await walk(resolveInSite(sitePath, target)))
  const stem = safeName.slice(0, safeName.lastIndexOf('.'))
  const extension = extname(safeName)

  let name = safeName
  for (let suffix = 2; existing.has(name); suffix++) name = `${stem}-${suffix}${extension}`

  const repoPath = posix.join(target, name)
  await writeFile(resolveInSite(sitePath, repoPath), Buffer.from(options.base64, 'base64'))

  return {
    webPath: `/${repoPath.slice(PUBLIC_DIR.length + 1)}`,
    repoPath,
    name,
    bytes: Buffer.from(options.base64, 'base64').length,
    modifiedAt: new Date().toISOString(),
    used: false
  }
}

export async function deleteImage(db: Database, repoPath: string): Promise<void> {
  await unlink(resolveInSite(root(db), repoPath))
}

/** Commit a set of images, as one commit, so the site can use them. */
export async function publishImages(
  db: Database,
  repoPaths: string[]
): Promise<{ sha: string; url: string }> {
  const connection = siteConnection(db)
  const repo = parseRepo(connection.repo)
  if (!repo) throw new Error(`“${connection.repo}” is not a repository name. Use owner/repo.`)

  const files = await Promise.all(
    repoPaths.map(async (repoPath) => ({
      path: repoPath,
      content: (await readFile(resolveInSite(connection.path, repoPath))).toString('base64'),
      encoding: 'base64' as const
    }))
  )

  const message =
    files.length === 1
      ? `Add ${posix.basename(files[0]!.path)}`
      : `Add ${files.length} images`

  const result = await commitFiles(repo.owner, repo.name, connection.branch, message, files)
  return { sha: result.sha, url: result.url }
}

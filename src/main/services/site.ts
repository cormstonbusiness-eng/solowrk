import { access, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Database } from '../db'
import type { SiteConnection, SiteStatus } from '@shared/types'
import { getSettings } from './settings'
import { hasSecret } from './credentials'

/**
 * The connection to the user's website repository.
 *
 * This is the one place SoloWrk reaches outside its own workspace, so it gets
 * its own containment boundary rather than borrowing the workspace's. The site
 * is a separate git repository the user points us at, and everything we do to
 * it — reading a post, writing one, listing images — goes through
 * `resolveInSite`.
 */

/**
 * Resolve `relativePath` inside the site repository, refusing anything that
 * escapes it.
 *
 * Deliberately identical in shape to `resolveInWorkspace`. Two boundaries that
 * behave differently is how one of them ends up weaker than the other, and this
 * one guards a folder that is not ours and that git will happily commit.
 */
export function resolveInSite(root: string, relativePath: string): string {
  if (root.trim() === '') {
    throw new Error('No website folder is set. Connect your site in Settings first.')
  }
  if (isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`)
  }

  const rootResolved = resolve(root)
  const target = resolve(rootResolved, relativePath)
  const rel = relative(rootResolved, target)

  if (rel.startsWith('..') || (rel !== '' && isAbsolute(rel))) {
    throw new Error(`Path escapes the website folder: ${relativePath}`)
  }
  // A sibling that merely shares a prefix is not inside: `…-website-backup`
  // must never be treated as part of `…-website`.
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    throw new Error(`Path escapes the website folder: ${relativePath}`)
  }

  return target
}

export function siteConnection(db: Database): SiteConnection {
  const settings = getSettings(db)

  return {
    path: settings.sitePath,
    repo: settings.siteRepo,
    branch: settings.siteBranch === '' ? 'main' : settings.siteBranch,
    url: settings.siteUrl
  }
}

/** `owner/repo` split, or null when it is not in that form. */
export function parseRepo(repo: string): { owner: string; name: string } | null {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repo.trim())
  return match ? { owner: match[1]!, name: match[2]! } : null
}

/**
 * Everything the UI needs to say whether the site is properly connected.
 *
 * Each part is reported separately rather than as one boolean, because "it
 * does not work" is a useless message when the fix is different depending on
 * which piece is missing.
 */
export async function siteStatus(db: Database): Promise<SiteStatus> {
  const connection = siteConnection(db)

  let folderExists = false
  let isRepo = false
  let hasContentDir = false

  if (connection.path !== '') {
    folderExists = await exists(connection.path)

    if (folderExists) {
      // A `.git` that is a file rather than a folder is a worktree or a
      // submodule, which is still a repository.
      isRepo = await exists(join(connection.path, '.git'))
      hasContentDir = await exists(resolveInSite(connection.path, 'content/blog'))
    }
  }

  return {
    ...connection,
    folderExists,
    isRepo,
    hasContentDir,
    repoValid: parseRepo(connection.repo) !== null,
    tokenSet: await hasSecret('github.token')
  }
}

/** True when everything needed to publish is in place. */
export function canPublish(status: SiteStatus): boolean {
  return status.folderExists && status.isRepo && status.repoValid && status.tokenSet
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Last-modified time as an ISO string, or empty when it cannot be read. */
export async function modifiedAt(path: string): Promise<string> {
  try {
    return (await stat(path)).mtime.toISOString()
  } catch {
    return ''
  }
}
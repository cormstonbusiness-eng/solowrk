import { basename } from 'node:path'
import type { Database } from '../db'
import type { KnownWorkspace } from '@shared/types'
import { isUnlimited, limitOf } from '@shared/entitlements'
import { LimitReachedError } from '@shared/limitError'
import { requiresFor } from '@shared/entitlements'
import { readConfig, updateConfig } from './config'
import { currentTier } from './entitlements'
import { isWorkspace } from './workspace'

/**
 * More than one business, in more than one folder.
 *
 * A workspace is a folder with its own database, so two businesses share
 * nothing: separate clients, separate invoice numbering, separate tax
 * settings, separate everything. That is the only honest way to do it —
 * a single database with a "business" column would leak the moment anybody
 * ran a report, and would make the invoice sequence a nightmare.
 *
 * What they *do* share is the licence, because that belongs to the person
 * rather than to the business. One subscription, however many businesses the
 * tier allows.
 *
 * **The cap is on adding, never on opening.** Somebody who drops from Pro to
 * Free with three workspaces keeps all three and can still open any of them —
 * they simply cannot make a fourth. §4.3 of the pricing spec is not a
 * nicety: holding somebody's own business records hostage is the exact
 * behaviour this product is sold against, and it would be at its worst here,
 * where the hostage is an entire company's books.
 *
 * It is also not DRM. The list lives in a JSON file the user owns, and
 * pointing the app at a folder is not a thing software can prevent. Like the
 * trial, this is a product boundary that works because most people are not
 * trying to get around it.
 */

/** Everything this installation knows about, most recently opened first. */
export async function knownWorkspaces(): Promise<KnownWorkspace[]> {
  const config = await readConfig()

  return Promise.all(
    config.workspaces.map(async (path) => ({
      path,
      name: basename(path),
      current: path === config.workspacePath,
      // Checked rather than assumed. A workspace on a drive that is not
      // plugged in should be shown and greyed, not silently dropped.
      missing: !(await isWorkspace(path))
    }))
  )
}

/** How many are known, for the meter on Settings → Account. */
export async function workspaceCount(): Promise<number> {
  return (await readConfig()).workspaces.length
}

/**
 * Refuse a new workspace when the tier has no room for one.
 *
 * Called before anything is created on disk, so a refusal never leaves a
 * half-made folder behind — the same order `createClient` uses for the same
 * reason.
 *
 * A path already in the list is never refused, whatever the tier. That is
 * what makes the cap a limit on adding rather than a lock on opening.
 */
export async function requireRoomForWorkspace(db: Database | null, path: string): Promise<void> {
  const config = await readConfig()
  if (config.workspaces.includes(path)) return

  const tier = await currentTier(db)
  const cap = limitOf(tier, 'workspaces')
  if (isUnlimited(cap)) return

  const used = config.workspaces.length
  if (used < cap) return

  throw new LimitReachedError({
    limit: 'workspaces',
    used,
    cap,
    tier,
    needs: requiresFor('workspaces', used + 1)
  })
}

/**
 * Record a workspace as known, and as the current one.
 *
 * Most recently opened first, so the switcher lists them in the order
 * somebody actually moves between them rather than the order they were made.
 */
export async function rememberWorkspace(path: string): Promise<void> {
  const config = await readConfig()
  const others = config.workspaces.filter((known) => known !== path)

  await updateConfig({ workspacePath: path, workspaces: [path, ...others] })
}

/**
 * Take a workspace off the list without touching the folder.
 *
 * Forgetting is not deleting and must never become it: the folder holds
 * somebody's invoices and client records, and this app has no business
 * removing it. They can add it back by pointing at the folder again.
 *
 * The one currently open cannot be forgotten — there would be nothing to
 * fall back to, and the app would be left holding a database it does not
 * admit to knowing.
 */
export async function forgetWorkspace(path: string): Promise<KnownWorkspace[]> {
  const config = await readConfig()

  if (config.workspacePath === path) {
    throw new Error('Switch to another workspace before removing this one from the list.')
  }

  await updateConfig({ workspaces: config.workspaces.filter((known) => known !== path) })
  return knownWorkspaces()
}

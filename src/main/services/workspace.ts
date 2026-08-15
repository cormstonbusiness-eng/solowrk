import { constants } from 'node:fs'
import { access, mkdir, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FolderInspection } from '@shared/types'

/** Folder the database and app internals live in, inside the workspace. */
export const APP_DIR = '_app'
export const DB_FILENAME = 'solo.db'

/**
 * The folder tree Solo creates. Top-level names are user-facing — they show up
 * in Explorer, so they read as folders a person would have made themselves.
 */
export const WORKSPACE_TREE = [
  APP_DIR,
  join(APP_DIR, 'backups'),
  join(APP_DIR, 'logs'),
  'Clients',
  'Documents',
  join('Documents', 'Business'),
  join('Documents', 'Contracts'),
  join('Documents', 'Insurance'),
  join('Documents', 'Tax'),
  'Invoices',
  'Quotes',
  'Expenses',
  'Templates'
]

export function databasePath(workspacePath: string): string {
  return join(workspacePath, APP_DIR, DB_FILENAME)
}

/**
 * Resolve `relativePath` inside `root`, refusing anything that escapes it.
 *
 * This is the containment boundary for every file operation in the app,
 * including the ones the AI assistant will drive in phase 7. `..` traversal,
 * absolute paths and symlink-style escapes all fail here rather than deeper in
 * the call stack.
 */
export function resolveInWorkspace(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`)
  }

  const rootResolved = resolve(root)
  const target = resolve(rootResolved, relativePath)
  const rel = relative(rootResolved, target)

  if (rel.startsWith('..') || (rel !== '' && isAbsolute(rel))) {
    throw new Error(`Path escapes the workspace: ${relativePath}`)
  }
  // Guard against a sibling folder that merely shares a prefix, e.g.
  // C:\Solo-backup being treated as inside C:\Solo.
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    throw new Error(`Path escapes the workspace: ${relativePath}`)
  }

  return target
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Report on a folder the user picked, so the wizard can explain what will happen. */
export async function inspectFolder(path: string): Promise<FolderInspection> {
  const folderExists = await exists(path)

  if (!folderExists) {
    // A folder we would create — writable if its nearest existing ancestor is.
    return {
      path,
      exists: false,
      isEmpty: true,
      hasExistingWorkspace: false,
      writable: await nearestAncestorWritable(path)
    }
  }

  const info = await stat(path)
  if (!info.isDirectory()) {
    return { path, exists: true, isEmpty: false, hasExistingWorkspace: false, writable: false }
  }

  const entries = await readdir(path)
  return {
    path,
    exists: true,
    isEmpty: entries.length === 0,
    hasExistingWorkspace: await exists(databasePath(path)),
    writable: await isWritable(path)
  }
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function nearestAncestorWritable(path: string): Promise<boolean> {
  let current = resolve(path)
  while (!(await exists(current))) {
    const parent = resolve(current, '..')
    if (parent === current) return false
    current = parent
  }
  return isWritable(current)
}

/**
 * Create the folder tree. Safe to re-run: existing folders are left alone, so
 * this doubles as a repair for a workspace someone has tidied up by hand.
 */
export async function scaffoldWorkspace(workspacePath: string): Promise<void> {
  await mkdir(workspacePath, { recursive: true })
  for (const folder of WORKSPACE_TREE) {
    await mkdir(resolveInWorkspace(workspacePath, folder), { recursive: true })
  }
}

/** True when the folder holds a usable Solo workspace. */
export async function isWorkspace(workspacePath: string): Promise<boolean> {
  return exists(databasePath(workspacePath))
}
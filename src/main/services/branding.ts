import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Database } from '../db'
import { getSettings, updateSettings } from './settings'
import { resolveInWorkspace } from './workspace'

/**
 * The business logo.
 *
 * Filed with the user's own documents rather than hidden in `_app`: it is their
 * asset, not app state, and they will want it to hand when someone asks for
 * their logo. The database stores only the workspace-relative path, as with
 * every other file.
 */
const LOGO_FOLDER = join('Documents', 'Business')

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}

export async function setLogo(
  db: Database,
  workspacePath: string,
  sourcePath: string
): Promise<string> {
  const extension = extname(sourcePath).toLowerCase()
  if (!ALLOWED.has(extension)) {
    throw new Error(`${extension || 'That file'} is not an image SoloWrk can show`)
  }

  // A fixed name, so replacing the logo replaces the file rather than leaving a
  // trail of logo, logo 2, logo 3 behind every time it is changed.
  const relative = join(LOGO_FOLDER, `logo${extension}`)
  const absolute = resolveInWorkspace(workspacePath, relative)

  await mkdir(resolveInWorkspace(workspacePath, LOGO_FOLDER), { recursive: true })
  await copyFile(sourcePath, absolute)

  updateSettings(db, { logoFile: relative })
  return relative
}

export function clearLogo(db: Database): void {
  // The file stays on disk. Deleting a record must never delete an image the
  // user may be using elsewhere.
  updateSettings(db, { logoFile: '' })
}

/**
 * The logo as a data URL.
 *
 * The renderer is sandboxed and cannot read the workspace, and a `file://` URL
 * would be blocked by the CSP — so the bytes come across the bridge already
 * encoded. Logos are a few KB, so this is cheaper than it sounds.
 */
export async function logoDataUrl(db: Database, workspacePath: string): Promise<string | null> {
  const { logoFile } = getSettings(db)
  if (logoFile === '') return null

  try {
    const bytes = await readFile(resolveInWorkspace(workspacePath, logoFile))
    const mime = MIME[extname(logoFile).toLowerCase()] ?? 'image/png'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    // Deleted from disk since it was set. Showing nothing beats a broken image.
    return null
  }
}

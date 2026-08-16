import { copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import type { FileEntry } from '@shared/types'
import { uniqueFileName, uniqueFolderName } from './naming'
import { APP_DIR, resolveInWorkspace } from './workspace'

/**
 * Browsing and editing the workspace on disk.
 *
 * Every path argument is relative to the workspace root and passes through
 * `resolveInWorkspace()`, which throws on absolute paths and anything that
 * escapes the root. Nothing here accepts an absolute path from the renderer,
 * and the same guard will contain the AI's file tools in phase 7.
 */

/** Folders SoloWrk owns and the browser should not offer to edit. */
const HIDDEN = new Set([APP_DIR.toLowerCase()])

export async function listDirectory(
  workspacePath: string,
  relativePath: string
): Promise<FileEntry[]> {
  const absolute = resolveInWorkspace(workspacePath, relativePath)
  const dirents = await readdir(absolute, { withFileTypes: true })

  const entries = await Promise.all(
    dirents
      .filter((dirent) => !(relativePath === '' && HIDDEN.has(dirent.name.toLowerCase())))
      .map(async (dirent): Promise<FileEntry | null> => {
        const childRelative = relativePath === '' ? dirent.name : join(relativePath, dirent.name)
        try {
          const info = await stat(join(absolute, dirent.name))
          return {
            name: dirent.name,
            path: childRelative,
            isDirectory: dirent.isDirectory(),
            size: dirent.isDirectory() ? 0 : info.size,
            modifiedAt: info.mtime.toISOString(),
            extension: dirent.isDirectory() ? '' : (dirent.name.split('.').pop() ?? '').toLowerCase()
          }
        } catch {
          // A file that vanished between readdir and stat, or one we cannot
          // read — skip it rather than failing the whole listing.
          return null
        }
      })
  )

  // Folders first, then files, each alphabetically — the order Explorer uses,
  // so the two views agree.
  return entries
    .filter((entry): entry is FileEntry => entry !== null)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' })
    })
}

export async function createFolder(
  workspacePath: string,
  parentRelative: string,
  name: string
): Promise<string> {
  const parent = resolveInWorkspace(workspacePath, parentRelative)
  const taken = (await readdir(parent, { withFileTypes: true })).map((d) => d.name)
  const folderName = uniqueFolderName(name, taken)

  const relative = parentRelative === '' ? folderName : join(parentRelative, folderName)
  await mkdir(resolveInWorkspace(workspacePath, relative), { recursive: true })
  return relative
}

export async function renameEntry(
  workspacePath: string,
  relativePath: string,
  newName: string
): Promise<string> {
  const absolute = resolveInWorkspace(workspacePath, relativePath)
  const parentRelative = relativePath.includes('\\')
    ? relativePath.slice(0, relativePath.lastIndexOf('\\'))
    : ''
  const parent = resolveInWorkspace(workspacePath, parentRelative)

  const info = await stat(absolute)
  const siblings = (await readdir(parent)).filter(
    (name) => name.toLowerCase() !== basename(relativePath).toLowerCase()
  )

  const finalName = info.isDirectory()
    ? uniqueFolderName(newName, siblings)
    : uniqueFileName(newName, siblings)

  const nextRelative = parentRelative === '' ? finalName : join(parentRelative, finalName)
  await rename(absolute, resolveInWorkspace(workspacePath, nextRelative))
  return nextRelative
}

/**
 * Sends to the Recycle Bin rather than unlinking. Deleting a client's
 * deliverable from a file browser should always be recoverable.
 */
export async function trashEntry(workspacePath: string, relativePath: string): Promise<void> {
  if (relativePath === '') throw new Error('Refusing to delete the workspace root')
  await shell.trashItem(resolveInWorkspace(workspacePath, relativePath))
}

/**
 * Copy files in from anywhere on the machine. Sources are absolute paths from
 * a native picker or a drag from Explorer; the destination is workspace-relative
 * and validated. Copies rather than moves — dragging a file in should not
 * remove it from where the user had it.
 */
export async function importFiles(
  workspacePath: string,
  destinationRelative: string,
  sources: string[]
): Promise<string[]> {
  const destination = resolveInWorkspace(workspacePath, destinationRelative)
  await mkdir(destination, { recursive: true })

  const imported: string[] = []
  // Re-read the folder each iteration so two files of the same name in one
  // drop do not both take the same free slot.
  for (const source of sources) {
    const taken = await readdir(destination)
    const name = uniqueFileName(basename(source), taken)
    await copyFile(source, join(destination, name))
    imported.push(destinationRelative === '' ? name : join(destinationRelative, name))
  }

  return imported
}

/** Open with the OS default application. */
export async function openEntry(workspacePath: string, relativePath: string): Promise<void> {
  const error = await shell.openPath(resolveInWorkspace(workspacePath, relativePath))
  if (error) throw new Error(error)
}

/** Show in Explorer with the item selected. */
export function revealEntry(workspacePath: string, relativePath: string): void {
  shell.showItemInFolder(resolveInWorkspace(workspacePath, relativePath))
}

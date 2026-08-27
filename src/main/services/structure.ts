import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import { isAbsolute, join, relative as relative_, resolve } from 'node:path'
import type { Database, Row } from '../db'
import type { StructureReport } from '@shared/structure'
import { checkStructure, previewRename, type RenamePreview } from '@shared/structure'
import { today } from '@shared/taxYear'
import { getProject } from './projects'
import { getClient } from './clients'
import { listTemplates } from './templates'
import { PROJECT_FOLDERS, resolveInWorkspace } from './workspace'

/**
 * Checking and repairing a project's folders.
 *
 * §13.2 says nothing else on the market does this, and the reason it matters
 * is that in 3D and design work a folder structure is not tidiness — it is
 * file paths. A missing `02-Assets` breaks every texture reference in a scene,
 * and the breakage shows up as pink checkerboards a week later on somebody
 * else's machine.
 *
 * **Repair only ever creates.** Never deletes, never moves, never renames.
 * An unexpected folder is the user's work, and a "repair" that removed it
 * would be catastrophic and unrecoverable.
 */

/** Deep enough to find a nested template folder, shallow enough to stay fast. */
const MAX_DEPTH = 3

/**
 * Every folder under a root, relative and with forward slashes.
 *
 * Depth-limited because a project folder can hold a cache directory with forty
 * thousand entries in it, and walking that to check five template folders
 * would make the page hang for something nobody asked about.
 */
async function foldersUnder(root: string, prefix = '', depth = 0): Promise<string[]> {
  if (depth >= MAX_DEPTH) return []

  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    // The folder has gone. That is itself a finding, and the caller reports it
    // as everything being missing rather than as an error.
    return []
  }

  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    found.push(path)
    found.push(...(await foldersUnder(root, path, depth + 1)))
  }

  return found
}

export interface ProjectStructure extends StructureReport {
  projectId: number
  projectName: string
  /** Workspace-relative. */
  folder: string
  /** The template it was measured against. */
  templateName: string
  /** False when the project folder is not on disk at all. */
  exists: boolean
}

/**
 * Which template a project should be measured against.
 *
 * Projects do not record the template that made them, so the check falls back
 * to the app's own default structure. That is the honest default: it is what
 * `scaffoldWorkspace` creates, so a project made by SoloWrk really was built
 * to it.
 */
function expectedFor(db: Database, templateId?: number): { name: string; folders: string[] } {
  if (templateId !== undefined) {
    const template = listTemplates(db).find((one) => one.id === templateId)
    if (template) return { name: template.name, folders: template.payload.folders }
  }
  return { name: 'Standard project folders', folders: PROJECT_FOLDERS }
}

export async function checkProject(
  db: Database,
  workspacePath: string,
  projectId: number,
  templateId?: number
): Promise<ProjectStructure> {
  const project = getProject(db, projectId)
  const template = expectedFor(db, templateId)
  const root = resolveInWorkspace(workspacePath, project.folder)

  let exists = true
  try {
    exists = (await stat(root)).isDirectory()
  } catch {
    exists = false
  }

  const actual = exists ? await foldersUnder(root) : []
  const report = checkStructure(template.folders, actual)

  return {
    ...report,
    projectId,
    projectName: project.name,
    folder: project.folder,
    templateName: template.name,
    exists
  }
}

/** Every active project, worst first — the list is a to-do, so order it that way. */
export async function checkAllProjects(
  db: Database,
  workspacePath: string
): Promise<ProjectStructure[]> {
  const projects = db.all<Row & { id: number }>(
    "SELECT id FROM projects WHERE archived = 0 AND status != 'cancelled' ORDER BY name"
  )

  const reports: ProjectStructure[] = []
  for (const row of projects) {
    reports.push(await checkProject(db, workspacePath, row.id))
  }

  return reports.sort((a, b) => a.score - b.score)
}

/**
 * Put back what is missing.
 *
 * Creates and nothing else. Returns what it made, so the UI can say so rather
 * than claiming success over a folder the disk refused.
 */
export async function repairProject(
  db: Database,
  workspacePath: string,
  projectId: number,
  templateId?: number
): Promise<{ created: string[]; failed: string[]; report: ProjectStructure }> {
  const before = await checkProject(db, workspacePath, projectId, templateId)

  const created: string[] = []
  const failed: string[] = []

  const projectRoot = resolveInWorkspace(workspacePath, before.folder)

  for (const relative of before.missing) {
    try {
      /**
       * Checked against the *project* folder, not just the workspace.
       *
       * `resolveInWorkspace` alone is not enough: a template folder called
       * `../../escaped` normalises to a path that is still inside the
       * workspace, so it would have been created at the workspace root. A
       * repair belongs entirely inside the project it is repairing.
       */
      const target = resolve(projectRoot, relative)
      const inside = relative_(projectRoot, target)
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
        failed.push(relative)
        continue
      }

      await mkdir(resolveInWorkspace(workspacePath, join(before.folder, relative)), {
        recursive: true
      })
      created.push(relative)
    } catch {
      failed.push(relative)
    }
  }

  return { created, failed, report: await checkProject(db, workspacePath, projectId, templateId) }
}

/* ------------------------------------------------------------------ *
 * Disk usage
 * ------------------------------------------------------------------ */

export interface ProjectUsage {
  projectId: number
  projectName: string
  folder: string
  bytes: number
  files: number
  /** The five biggest files, since those are the ones worth doing something about. */
  largest: { path: string; bytes: number }[]
  /** Newest file anywhere inside. Null when the folder is empty or gone. */
  lastTouched: string | null
}

/** Deep enough for real project trees; a guard against a symlink loop. */
const USAGE_DEPTH = 8

async function measure(
  root: string,
  prefix = '',
  depth = 0
): Promise<{ bytes: number; files: number; largest: { path: string; bytes: number }[]; last: number }> {
  if (depth >= USAGE_DEPTH) return { bytes: 0, files: 0, largest: [], last: 0 }

  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return { bytes: 0, files: 0, largest: [], last: 0 }
  }

  let bytes = 0
  let files = 0
  let last = 0
  const largest: { path: string; bytes: number }[] = []

  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`

    if (entry.isDirectory()) {
      const inner = await measure(root, path, depth + 1)
      bytes += inner.bytes
      files += inner.files
      last = Math.max(last, inner.last)
      largest.push(...inner.largest)
      continue
    }

    // A symlink is not followed: its target may be outside the project, and
    // counting it would report somebody's whole drive as one project.
    if (!entry.isFile()) continue

    try {
      const info = await stat(join(root, path))
      bytes += info.size
      files += 1
      last = Math.max(last, info.mtimeMs)
      largest.push({ path, bytes: info.size })
    } catch {
      continue
    }
  }

  return {
    bytes,
    files,
    // Trimmed at every level, so a folder with 40,000 files never builds a
    // 40,000-entry array on the way up.
    largest: largest.sort((a, b) => b.bytes - a.bytes).slice(0, 5),
    last
  }
}

export async function projectUsage(db: Database, workspacePath: string): Promise<ProjectUsage[]> {
  const projects = db.all<Row & { id: number; name: string; folder: string }>(
    'SELECT id, name, folder FROM projects WHERE archived = 0 ORDER BY name'
  )

  const usage: ProjectUsage[] = []
  for (const project of projects) {
    const measured = await measure(resolveInWorkspace(workspacePath, project.folder))
    usage.push({
      projectId: project.id,
      projectName: project.name,
      folder: project.folder,
      bytes: measured.bytes,
      files: measured.files,
      largest: measured.largest,
      lastTouched: measured.last > 0 ? new Date(measured.last).toISOString().slice(0, 10) : null
    })
  }

  // Biggest first: the list exists to answer "what is filling the drive?".
  return usage.sort((a, b) => b.bytes - a.bytes)
}

/* ------------------------------------------------------------------ *
 * Bulk rename
 * ------------------------------------------------------------------ */

/** What the rename would do, without doing any of it. */
export async function planRename(
  db: Database,
  workspacePath: string,
  folder: string,
  pattern: string,
  projectId?: number
): Promise<RenamePreview[]> {
  const root = resolveInWorkspace(workspacePath, folder)

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const project = projectId === undefined ? null : getProject(db, projectId)
  const client = project?.clientId ? getClient(db, project.clientId) : null

  return previewRename(files, pattern, {
    client: client?.name,
    project: project?.name,
    date: today()
  })
}

/**
 * Do it.
 *
 * Anything the preview marked as a problem is skipped rather than attempted,
 * so a single collision cannot take a good rename halfway and stop. Renames
 * happen one at a time and each failure is reported: a bulk rename that says
 * "done" over four files it could not move is worse than one that says so.
 */
export async function applyRename(
  db: Database,
  workspacePath: string,
  folder: string,
  pattern: string,
  projectId?: number
): Promise<{ renamed: number; skipped: RenamePreview[] }> {
  const plan = await planRename(db, workspacePath, folder, pattern, projectId)

  let renamed = 0
  const skipped: RenamePreview[] = []

  for (const one of plan) {
    if (one.problem !== null || one.from === one.to) {
      if (one.problem !== null) skipped.push(one)
      continue
    }

    try {
      await rename(
        resolveInWorkspace(workspacePath, join(folder, one.from)),
        resolveInWorkspace(workspacePath, join(folder, one.to))
      )
      renamed += 1
    } catch {
      skipped.push({ ...one, problem: 'The file could not be renamed.' })
    }
  }

  return { renamed, skipped }
}

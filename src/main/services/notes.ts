import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from '../db'
import type { Note, NoteWithContext } from '@shared/types'
import { uniqueFolderName } from './naming'
import { resolveInWorkspace } from './workspace'
import { getProject } from './projects'

/**
 * Notes are real markdown files inside the project's `_notes` folder. The
 * database stores only the path and title, so notes stay readable and editable
 * outside SoloWrk — the point of keeping files on disk in the first place.
 */

interface NoteRow extends Row {
  id: number
  project_id: number | null
  title: string
  file: string
  pinned: number
  created_at: string
  updated_at: string
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    file: row.file,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Where standalone notes live — a notebook that belongs to no project. */
export const NOTES_ROOT = 'Notes'

export function listNotes(db: Database, projectId: number): Note[] {
  return db
    .all<NoteRow>('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC', [projectId])
    .map(toNote)
}

/**
 * The standalone notebook: every note not attached to a project.
 *
 * Pinned first, then most recently edited — a notebook is used by reaching for
 * what you were last writing, not by scrolling an alphabetical list.
 */
export function listStandaloneNotes(db: Database, search?: string): NoteWithContext[] {
  const conditions = ['project_id IS NULL']
  const params: string[] = []

  if (search) {
    conditions.push('title LIKE ?')
    params.push(`%${search}%`)
  }

  return db
    .all<NoteRow>(
      `SELECT * FROM notes WHERE ${conditions.join(' AND ')}
        ORDER BY pinned DESC, updated_at DESC`,
      params
    )
    .map((row) => ({ ...toNote(row), projectName: null }))
}

/** Every note in the workspace, project and standalone, for search. */
export function listAllNotes(db: Database, search?: string): NoteWithContext[] {
  const where = search ? 'WHERE n.title LIKE ?' : ''
  const params = search ? [`%${search}%`] : []

  return db
    .all<NoteRow & { project_name: string | null }>(
      `SELECT n.*, p.name AS project_name
         FROM notes n LEFT JOIN projects p ON p.id = n.project_id
         ${where}
        ORDER BY n.pinned DESC, n.updated_at DESC`,
      params
    )
    .map((row) => ({ ...toNote(row), projectName: row.project_name }))
}

export async function createNote(
  db: Database,
  workspacePath: string,
  projectId: number | null,
  title: string
): Promise<Note> {
  // A project note lives in that project's `_notes`; a standalone one lives in
  // the workspace-level Notes folder. Both are real .md files either way.
  const notesFolder =
    projectId === null ? NOTES_ROOT : join(getProject(db, projectId).folder, '_notes')

  const taken = db
    .all<Row & { file: string }>('SELECT file FROM notes WHERE project_id IS ?', [projectId])
    .map((r) => r.file.split('\\').pop()?.replace(/\.md$/, '') ?? '')

  const file = join(notesFolder, `${uniqueFolderName(title, taken)}.md`)
  const absolute = resolveInWorkspace(workspacePath, file)

  await mkdir(resolveInWorkspace(workspacePath, notesFolder), { recursive: true })
  await writeFile(absolute, `# ${title}\n\n`, 'utf8')

  db.run(
    `INSERT INTO notes (project_id, title, file, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [projectId, title, file]
  )

  const row = db.get<NoteRow>('SELECT * FROM notes WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Note was not created')
  return toNote(row)
}

export function renameNote(db: Database, id: number, title: string): void {
  // The file keeps its name: renaming it would break anything that has the
  // path, and the title is what the app shows anyway.
  db.run("UPDATE notes SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id])
}

export function setNotePinned(db: Database, id: number, pinned: boolean): void {
  db.run('UPDATE notes SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])
}

export async function readNote(db: Database, workspacePath: string, id: number): Promise<string> {
  const row = db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
  if (!row) throw new Error(`No note with id ${id}`)

  try {
    return await readFile(resolveInWorkspace(workspacePath, row.file), 'utf8')
  } catch {
    // Deleted or moved outside SoloWrk — say so rather than showing a blank editor
    // that would overwrite nothing with nothing.
    return `> This note's file is missing from disk:\n> ${row.file}\n`
  }
}

export async function writeNote(
  db: Database,
  workspacePath: string,
  id: number,
  content: string
): Promise<void> {
  const row = db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
  if (!row) throw new Error(`No note with id ${id}`)

  await writeFile(resolveInWorkspace(workspacePath, row.file), content, 'utf8')
  db.run("UPDATE notes SET updated_at = datetime('now') WHERE id = ?", [id])
}

/** Deletes both the record and the file — a note is its file. */
export async function deleteNote(
  db: Database,
  workspacePath: string,
  id: number
): Promise<void> {
  const row = db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
  if (!row) return

  await rm(resolveInWorkspace(workspacePath, row.file), { force: true })
  db.run('DELETE FROM notes WHERE id = ?', [id])
}

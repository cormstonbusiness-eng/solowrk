import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from '../db'
import type { Note } from '@shared/types'
import { uniqueFolderName } from './naming'
import { resolveInWorkspace } from './workspace'
import { getProject } from './projects'

/**
 * Notes are real markdown files inside the project's `_notes` folder. The
 * database stores only the path and title, so notes stay readable and editable
 * outside Solo — the point of keeping files on disk in the first place.
 */

interface NoteRow extends Row {
  id: number
  project_id: number
  title: string
  file: string
  created_at: string
  updated_at: string
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    file: row.file,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listNotes(db: Database, projectId: number): Note[] {
  return db
    .all<NoteRow>('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC', [projectId])
    .map(toNote)
}

export async function createNote(
  db: Database,
  workspacePath: string,
  projectId: number,
  title: string
): Promise<Note> {
  const project = getProject(db, projectId)
  const notesFolder = join(project.folder, '_notes')

  const taken = db
    .all<Row & { file: string }>('SELECT file FROM notes WHERE project_id = ?', [projectId])
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

export async function readNote(db: Database, workspacePath: string, id: number): Promise<string> {
  const row = db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
  if (!row) throw new Error(`No note with id ${id}`)

  try {
    return await readFile(resolveInWorkspace(workspacePath, row.file), 'utf8')
  } catch {
    // Deleted or moved outside Solo — say so rather than showing a blank editor
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

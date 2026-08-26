import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Database, Row } from '../db'
import type { DocumentInput, DocumentRecord } from '@shared/types'
import { uniqueFileName } from './naming'
import { resolveInWorkspace } from './workspace'

const DOCUMENTS_ROOT = 'Documents'

interface DocumentRow extends Row {
  id: number
  title: string
  category: string
  file: string
  tags: string
  notes: string
  expiry_at: string | null
  client_id: number | null
  created_at: string
  updated_at: string
}

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    file: row.file,
    tags: row.tags === '' ? [] : row.tags.split(','),
    notes: row.notes,
    expiryAt: row.expiry_at,
    clientId: row.client_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Stored lower-cased and comma-joined so LIKE search is predictable. */
function packTags(tags: string[] | undefined): string {
  if (!tags) return ''
  return tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
    .join(',')
}

export function listDocuments(
  db: Database,
  options: { search?: string; category?: string } = {}
): DocumentRecord[] {
  const conditions: string[] = []
  const params: string[] = []

  if (options.category) {
    conditions.push('category = ?')
    params.push(options.category)
  }

  if (options.search) {
    conditions.push('(title LIKE ? OR tags LIKE ? OR notes LIKE ?)')
    const like = `%${options.search}%`
    params.push(like, like, like)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db
    .all<DocumentRow>(
      `SELECT * FROM documents ${where}
        ORDER BY category COLLATE NOCASE, title COLLATE NOCASE`,
      params
    )
    .map(toDocument)
}

/**
 * Copy a file into the workspace under `Documents\<category>` and record it.
 *
 * The copy happens first: if the disk refuses, no row is left describing a
 * document that is not there. `sourcePath` is absolute — it comes from a native
 * picker, and is the one place a path from outside the workspace is expected.
 */
export async function addDocument(
  db: Database,
  workspacePath: string,
  input: DocumentInput & { sourcePath: string }
): Promise<DocumentRecord> {
  const category = input.category?.trim() || 'Business'
  const folderRelative = join(DOCUMENTS_ROOT, category)
  const folder = resolveInWorkspace(workspacePath, folderRelative)

  await mkdir(folder, { recursive: true })
  const name = uniqueFileName(basename(input.sourcePath), await readdir(folder))
  await copyFile(input.sourcePath, join(folder, name))

  const file = join(folderRelative, name)

  db.run(
    `INSERT INTO documents (title, category, file, tags, notes, expiry_at, client_id,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.title?.trim() || basename(input.sourcePath),
      category,
      file,
      packTags(input.tags),
      input.notes ?? '',
      input.expiryAt ?? null,
      input.clientId ?? null
    ]
  )

  const row = db.get<DocumentRow>('SELECT * FROM documents WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Document was not created')
  return toDocument(row)
}

const UPDATABLE: Record<string, string> = {
  title: 'title',
  category: 'category',
  notes: 'notes',
  expiryAt: 'expiry_at',
  clientId: 'client_id'
}

export function updateDocument(
  db: Database,
  id: number,
  patch: Partial<DocumentInput>
): DocumentRecord {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (patch.tags !== undefined) {
    assignments.push('tags = ?')
    values.push(packTags(patch.tags))
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE documents SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  const row = db.get<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id])
  if (!row) throw new Error(`No document with id ${id}`)
  return toDocument(row)
}

/**
 * Documents expiring within `days`, plus anything already expired.
 *
 * This is what makes the Documents section worth more than a folder: insurance
 * that lapses silently is the failure mode being designed against.
 */
export function expiringDocuments(db: Database, days = 45): DocumentRecord[] {
  const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  return db
    .all<DocumentRow>(
      `SELECT * FROM documents
        WHERE expiry_at IS NOT NULL AND expiry_at <= ?
        ORDER BY expiry_at`,
      [cutoff]
    )
    .map(toDocument)
}

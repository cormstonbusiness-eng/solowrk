import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Database, Row } from '../db'
import type { DocumentInput, DocumentRecord } from '@shared/types'
import { uniqueFileName } from './naming'
import { ensureTag, tag as tagEntity, tagsFor, tagsForMany, untag } from './tags'
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

/**
 * `tags` comes from the shared vocabulary, not from the row.
 *
 * The old comma-separated column is still on the table — migration 22 kept it
 * so a bad backfill could be inspected — but nothing reads or writes it now.
 * Passing the tags in means one query for a whole list rather than one per row.
 */
function toDocument(row: DocumentRow, tags: string[] = []): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    file: row.file,
    tags,
    notes: row.notes,
    expiryAt: row.expiry_at,
    clientId: row.client_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Replace a document's tags with exactly this set, making any that are new. */
function applyTags(db: Database, id: number, tags: string[]): void {
  const ref = { type: 'document' as const, id }
  const wanted = tags.map((one) => one.trim()).filter((one) => one.length > 0)
  const existing = tagsFor(db, ref)

  for (const one of existing) {
    if (!wanted.some((name) => name.toLowerCase() === one.name.toLowerCase())) {
      untag(db, ref, one.id)
    }
  }
  for (const name of wanted) {
    tagEntity(db, ref, ensureTag(db, name).id)
  }
}

/** The tags for a set of document rows, in one query. */
function withTags(db: Database, rows: DocumentRow[]): DocumentRecord[] {
  const byId = tagsForMany(db, 'document', rows.map((row) => row.id))
  return rows.map((row) => toDocument(row, (byId[row.id] ?? []).map((one) => one.name)))
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
    // Tags moved out to their own table in migration 22, so searching them
    // means a subquery rather than a LIKE on a column. Worth keeping: a
    // document filed under "insurance" is far more often remembered by that
    // than by whatever it was named.
    conditions.push(
      `(title LIKE ? OR notes LIKE ? OR id IN (
         SELECT e.entity_id FROM entity_tags e
           JOIN tags t ON t.id = e.tag_id
          WHERE e.entity_type = 'document' AND t.name LIKE ?
       ))`
    )
    const like = `%${options.search}%`
    params.push(like, like, like)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return withTags(
    db,
    db.all<DocumentRow>(
      `SELECT * FROM documents ${where}
        ORDER BY category COLLATE NOCASE, title COLLATE NOCASE`,
      params
    )
  )
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
    `INSERT INTO documents (title, category, file, notes, expiry_at, client_id,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.title?.trim() || basename(input.sourcePath),
      category,
      file,
      input.notes ?? '',
      input.expiryAt ?? null,
      input.clientId ?? null
    ]
  )

  const row = db.get<DocumentRow>('SELECT * FROM documents WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Document was not created')

  if (input.tags) applyTags(db, row.id, input.tags)
  return toDocument(row, tagsFor(db, { type: 'document', id: row.id }).map((one) => one.name))
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

  if (assignments.length > 0) {
    db.run(
      `UPDATE documents SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  if (patch.tags !== undefined) applyTags(db, id, patch.tags)

  const row = db.get<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id])
  if (!row) throw new Error(`No document with id ${id}`)
  return toDocument(row, tagsFor(db, { type: 'document', id }).map((one) => one.name))
}

/**
 * Documents expiring within `days`, plus anything already expired.
 *
 * This is what makes the Documents section worth more than a folder: insurance
 * that lapses silently is the failure mode being designed against.
 */
export function expiringDocuments(db: Database, days = 45): DocumentRecord[] {
  const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  return withTags(
    db,
    db.all<DocumentRow>(
      `SELECT * FROM documents
        WHERE expiry_at IS NOT NULL AND expiry_at <= ?
        ORDER BY expiry_at`,
      [cutoff]
    )
  )
}

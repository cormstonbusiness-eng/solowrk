import type { Database, Row } from '../db'
import type {
  DocumentKind,
  DocumentRecord,
  DocumentTemplate,
  DocumentTemplateInput,
  DocumentVersion,
  GeneratedDocument
} from '@shared/types'
import { merge, type MergeContext } from '@shared/merge'
import { STARTER_TEMPLATES } from '@shared/starterTemplates'
import { currentTaxYear, today } from '@shared/taxYear'
import { getClient } from './clients'
import { getDocument } from './documents'
import { getProject } from './projects'
import { getSettings } from './settings'

/**
 * Templates, and the documents they produce.
 *
 * The starter library is seeded once and then belongs to the user. An update
 * that shipped a better contract must not overwrite the one somebody amended
 * and has been sending to clients for a year — so seeding runs only for
 * templates that have never existed here, and `builtin` exists only so the UI
 * can offer to put an original back.
 */

interface TemplateRow extends Row {
  id: number
  name: string
  kind: DocumentKind
  summary: string
  body: string
  builtin: number
  created_at: string
  updated_at: string
}

function toTemplate(row: TemplateRow): DocumentTemplate {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    summary: row.summary,
    body: row.body,
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/* ------------------------------------------------------------------ *
 * The starter library
 * ------------------------------------------------------------------ */

/**
 * Put the shipped templates in, once.
 *
 * Matched on name among the built-in rows only, so a template somebody deleted
 * on purpose stays deleted and one they renamed is left alone. Called on every
 * workspace open, which is what makes a template added in a later release
 * appear without anybody running anything.
 */
export function seedStarterTemplates(db: Database): number {
  const seeded = new Set(
    db
      .all<Row & { name: string }>('SELECT name FROM document_templates WHERE builtin = 1')
      .map((row) => row.name)
  )

  let added = 0
  for (const starter of STARTER_TEMPLATES) {
    if (seeded.has(starter.name)) continue
    db.run(
      `INSERT INTO document_templates (name, kind, summary, body, builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      [starter.name, starter.kind, starter.summary, starter.body]
    )
    added += 1
  }

  return added
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export function listDocTemplates(db: Database): DocumentTemplate[] {
  return db
    .all<TemplateRow>(
      `SELECT * FROM document_templates WHERE archived = 0
        ORDER BY builtin DESC, name COLLATE NOCASE`
    )
    .map(toTemplate)
}

export function getDocTemplate(db: Database, id: number): DocumentTemplate {
  const row = db.get<TemplateRow>('SELECT * FROM document_templates WHERE id = ?', [id])
  if (!row) throw new Error(`No template with id ${id}`)
  return toTemplate(row)
}

export function createDocTemplate(db: Database, input: DocumentTemplateInput): DocumentTemplate {
  db.run(
    `INSERT INTO document_templates (name, kind, summary, body, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
    [
      input.name?.trim() || 'Untitled template',
      input.kind ?? 'other',
      input.summary ?? '',
      input.body ?? ''
    ]
  )
  return getDocTemplate(db, db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id)
}

export function updateDocTemplate(
  db: Database,
  id: number,
  patch: DocumentTemplateInput
): DocumentTemplate {
  const columns: Record<string, string> = {
    name: 'name',
    kind: 'kind',
    summary: 'summary',
    body: 'body'
  }

  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE document_templates SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getDocTemplate(db, id)
}

/**
 * Archived rather than deleted.
 *
 * A document generated last year points at the template it came from, and a
 * hard delete would leave that pointing at nothing. Archiving also means
 * `seedStarterTemplates` will not quietly put a deleted starter back.
 */
export function deleteDocTemplate(db: Database, id: number): void {
  db.run('UPDATE document_templates SET archived = 1 WHERE id = ?', [id])
}

/** Put a shipped template back the way it came. */
export function restoreDocTemplate(db: Database, id: number): DocumentTemplate {
  const current = getDocTemplate(db, id)
  const original = STARTER_TEMPLATES.find((one) => one.name === current.name)
  if (!original) throw new Error(`${current.name} did not ship with the app`)

  db.run(
    `UPDATE document_templates
        SET body = ?, summary = ?, kind = ?, archived = 0, updated_at = datetime('now')
      WHERE id = ?`,
    [original.body, original.summary, original.kind, id]
  )
  return getDocTemplate(db, id)
}

/* ------------------------------------------------------------------ *
 * The data a template merges against
 * ------------------------------------------------------------------ */

function money(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return ''
  return `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

/** `2026-04-01` → `1 April 2026`, which is what a contract should read. */
function longDate(date: string | null | undefined): string {
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

/**
 * Everything a template may ask for, gathered from the real records.
 *
 * A field with no answer is left out rather than set to an empty string. The
 * two are the same to `merge`, but leaving it out keeps this function honest
 * about what it actually knows.
 */
export function mergeContext(
  db: Database,
  scope: { clientId?: number | null; projectId?: number | null }
): MergeContext {
  const settings = getSettings(db)
  const context: MergeContext = {
    'user.business_name': settings.businessName,
    'user.contact': settings.contactName,
    'user.email': settings.email,
    'user.phone': settings.phone,
    'user.address': [settings.addressLine1, settings.addressLine2, settings.city, settings.postcode]
      .filter((part) => part.trim() !== '')
      .join(', '),
    'user.vat_number': settings.vatRegistered ? settings.vatNumber : '',
    'user.payment_terms': `${settings.paymentTermsDays} days`,
    today: longDate(today()),
    tax_year: currentTaxYear().label
  }

  const project = scope.projectId ? getProject(db, scope.projectId) : null
  // A project knows its client, so picking a project is enough — nobody
  // should have to name the client of a project they just chose.
  const clientId = scope.clientId ?? project?.clientId ?? null
  const client = clientId ? getClient(db, clientId) : null

  if (client) {
    context['client.company'] = client.name
    context['client.contact'] = client.contactName
    context['client.email'] = client.email
    context['client.phone'] = client.phone
    context['client.address'] = client.address
  }

  if (project) {
    context['project.name'] = project.name
    context['project.description'] = project.description
    context['project.value'] = money(project.budget)
    context['project.start'] = longDate(project.startsOn)
    context['project.due'] = longDate(project.dueOn)
    context['project.rate'] = money(project.rate ?? settings.defaultHourlyRate)
  }

  return context
}

/* ------------------------------------------------------------------ *
 * Generating
 * ------------------------------------------------------------------ */

/**
 * Make a document from a template.
 *
 * Returns what it could not fill in alongside the document, so the user is
 * told before the PDF exists rather than after the client has read it. The
 * unfilled fields are still visible in the text — see `@shared/merge`.
 */
export function generateDocument(
  db: Database,
  input: {
    templateId: number
    title?: string
    clientId?: number | null
    projectId?: number | null
  }
): GeneratedDocument {
  const template = getDocTemplate(db, input.templateId)
  const context = mergeContext(db, input)
  const result = merge(template.body, context)

  const project = input.projectId ? getProject(db, input.projectId) : null
  const clientId = input.clientId ?? project?.clientId ?? null

  const title =
    input.title?.trim() ||
    // "Contract — Ashfield House" beats "Freelance contract" in a list of
    // eleven contracts.
    (project ? `${template.name} — ${project.name}` : template.name)

  db.run(
    `INSERT INTO documents
       (title, category, file, notes, body, project_id, template_id, client_id,
        status, created_at, updated_at)
     VALUES (?, ?, '', '', ?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))`,
    [title, template.kind, result.text, input.projectId ?? null, template.id, clientId]
  )

  const id = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id
  snapshot(db, id, result.text, 'Generated')

  return {
    document: getDocument(db, id),
    unresolved: result.unresolved,
    filled: result.filled
  }
}

/* ------------------------------------------------------------------ *
 * Editing and history
 * ------------------------------------------------------------------ */

function snapshot(db: Database, documentId: number, body: string, note: string): void {
  db.run(
    `INSERT INTO document_versions (document_id, body, note, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [documentId, body, note]
  )
}

/**
 * Save an edit, keeping the version that was there before.
 *
 * A snapshot per save rather than a diff chain: a contract is a few kilobytes
 * of text, and storing whole copies means restoring one can never depend on
 * replaying a sequence of diffs correctly. An unchanged body writes no
 * version — a hundred identical snapshots is a history nobody can read.
 */
export function saveDocumentBody(
  db: Database,
  id: number,
  body: string,
  note = ''
): DocumentRecord {
  const current = getDocument(db, id)
  if (current.body === body) return current

  db.run("UPDATE documents SET body = ?, updated_at = datetime('now') WHERE id = ?", [body, id])
  snapshot(db, id, body, note)

  return getDocument(db, id)
}

export function documentVersions(db: Database, documentId: number): DocumentVersion[] {
  return db
    .all<Row & { id: number; document_id: number; body: string; note: string; created_at: string }>(
      'SELECT * FROM document_versions WHERE document_id = ? ORDER BY id DESC',
      [documentId]
    )
    .map((row) => ({
      id: row.id,
      documentId: row.document_id,
      body: row.body,
      note: row.note,
      createdAt: row.created_at
    }))
}

/**
 * Go back to an earlier version.
 *
 * Written forward as a new version rather than by deleting what came after.
 * Undoing a restore has to be possible, and a history with a hole in it is
 * worse than no history.
 */
export function restoreDocumentVersion(
  db: Database,
  documentId: number,
  versionId: number
): DocumentRecord {
  const version = db.get<Row & { body: string; created_at: string }>(
    'SELECT body, created_at FROM document_versions WHERE id = ? AND document_id = ?',
    [versionId, documentId]
  )
  if (!version) throw new Error(`No version ${versionId} of document ${documentId}`)

  return saveDocumentBody(db, documentId, version.body, `Restored the version from ${version.created_at}`)
}

/** Draft → Sent → Signed, tracked by hand because that is what people keep. */
export function setDocumentStatus(
  db: Database,
  id: number,
  status: DocumentRecord['status'],
  note = ''
): DocumentRecord {
  db.run(
    `UPDATE documents SET status = ?, status_at = ?, status_note = ?, updated_at = datetime('now')
      WHERE id = ?`,
    // Back to draft clears the date: a document that is a draft was not signed
    // on any particular day.
    [status, status === 'draft' ? null : today(), note, id]
  )
  return getDocument(db, id)
}

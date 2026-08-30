import type { Database, Row } from '../db'
import type {
  LibraryAssetInput,
  LibraryAssetWithContext,
  LibraryType
} from '@shared/types'

/**
 * Everything reusable (§7).
 *
 * Case studies, testimonials, assets and a swipe file, in one table and one
 * grid. They share every operation — filed, tagged, searched, filtered by
 * type, archived — so four tables would have meant four of each and a UI that
 * had to know which kind it was holding before it could draw a row.
 *
 * Nothing here copies a file. `filePath` is a reference into the workspace,
 * because a library that duplicated every image would double the size of
 * somebody's folder to save them a click.
 */

interface AssetRow extends Row {
  id: number
  type: string
  title: string
  body: string
  file_path: string
  url: string
  source_project_id: number | null
  client_id: number | null
  may_use: number
  tags: string
  archived: number
  created_at: string
  updated_at: string
  client_name: string | null
  project_name: string | null
}

const SELECT = `
  SELECT a.*,
         c.name AS client_name,
         p.name AS project_name
    FROM library_assets a
    LEFT JOIN clients  c ON c.id = a.client_id
    LEFT JOIN projects p ON p.id = a.source_project_id
`

function toAsset(row: AssetRow): LibraryAssetWithContext {
  return {
    id: row.id,
    type: row.type as LibraryType,
    title: row.title,
    body: row.body,
    filePath: row.file_path,
    url: row.url,
    sourceProjectId: row.source_project_id,
    clientId: row.client_id,
    mayUse: row.may_use === 1,
    tags: row.tags,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientName: row.client_name ?? '',
    projectName: row.project_name ?? ''
  }
}

export interface LibraryFilter {
  type?: LibraryType
  search?: string
  includeArchived?: boolean
}

export function listLibrary(
  db: Database,
  filter: LibraryFilter = {}
): LibraryAssetWithContext[] {
  const where: string[] = []
  const params: (string | number)[] = []

  if (!filter.includeArchived) where.push('a.archived = 0')

  if (filter.type) {
    where.push('a.type = ?')
    params.push(filter.type)
  }

  if (filter.search && filter.search.trim() !== '') {
    // Title, body and tags together, because somebody looking for a
    // testimonial remembers the client's words rather than what they called
    // the row.
    where.push('(a.title LIKE ? OR a.body LIKE ? OR a.tags LIKE ?)')
    const like = `%${filter.search.trim()}%`
    params.push(like, like, like)
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  return db
    .all<AssetRow>(`${SELECT} ${clause} ORDER BY a.updated_at DESC, a.id DESC`, params)
    .map(toAsset)
}

export function getLibraryAsset(db: Database, id: number): LibraryAssetWithContext {
  const row = db.get<AssetRow>(`${SELECT} WHERE a.id = ?`, [id])
  if (!row) throw new Error(`No library item with id ${id}`)
  return toAsset(row)
}

export function createLibraryAsset(
  db: Database,
  input: LibraryAssetInput
): LibraryAssetWithContext {
  db.run(
    `INSERT INTO library_assets
       (type, title, body, file_path, url, source_project_id, client_id,
        may_use, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.type ?? 'swipe',
      input.title?.trim() ?? '',
      input.body ?? '',
      input.filePath ?? '',
      input.url ?? '',
      input.sourceProjectId ?? null,
      input.clientId ?? null,
      input.mayUse ? 1 : 0,
      input.tags ?? ''
    ]
  )

  return getLibraryAsset(db, db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id)
}

const COLUMNS: Record<string, string> = {
  type: 'type',
  title: 'title',
  body: 'body',
  filePath: 'file_path',
  url: 'url',
  sourceProjectId: 'source_project_id',
  clientId: 'client_id',
  tags: 'tags'
}

export function updateLibraryAsset(
  db: Database,
  id: number,
  patch: LibraryAssetInput
): LibraryAssetWithContext {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  // Booleans do not survive the generic map, and permission is the one field
  // here where getting it wrong matters to somebody other than the user.
  if (patch.mayUse !== undefined) {
    assignments.push('may_use = ?')
    values.push(patch.mayUse ? 1 : 0)
  }

  if (patch.archived !== undefined) {
    assignments.push('archived = ?', 'archived_at = ?')
    values.push(patch.archived ? 1 : 0, patch.archived ? new Date().toISOString() : null)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE library_assets SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getLibraryAsset(db, id)
}

/** Off the grid, kept whole. Nothing about the item is lost. */
export function archiveLibraryAsset(
  db: Database,
  id: number,
  archived = true
): LibraryAssetWithContext {
  return updateLibraryAsset(db, id, { archived })
}

/* ------------------------------------------------------------------ *
 * A case study out of work already done
 * ------------------------------------------------------------------ */

export interface CaseStudyDraft {
  title: string
  body: string
  clientId: number | null
  sourceProjectId: number
}

/**
 * The parts of a case study the workspace already knows (§9.2).
 *
 * Everything here is a fact SoloWrk recorded while the work happened: who it
 * was for, when it ran, how long it actually took, what was delivered. The
 * judgement — the problem, the approach, what it was worth to them — is left
 * as headings with nothing under them, because those are the parts only the
 * user can write and a confident guess at them would be fiction about a real
 * client.
 *
 * Pro (§12), and this is the half that earns it: keeping a case study is
 * Basic+, and somebody who wrote one by hand must always be able to file it.
 */
export function caseStudyFromProject(db: Database, projectId: number): CaseStudyDraft {
  const project = db.get<
    Row & {
      id: number
      name: string
      client_id: number | null
      client_name: string | null
      starts_on: string | null
      due_on: string | null
    }
  >(
    `SELECT p.id, p.name, p.client_id, p.starts_on, p.due_on, c.name AS client_name
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?`,
    [projectId]
  )

  if (!project) throw new Error(`No project with id ${projectId}`)

  /**
   * When the work really happened, and how long it really took.
   *
   * From tracked time rather than from `starts_on` and `due_on`, because §7
   * asks for the real duration and those two are a plan. A project that ran
   * three weeks over is exactly the one whose case study should say so — and
   * quoting the planned dates as though they were the actual ones would be a
   * false claim about a named client.
   */
  const worked = db.get<Row & { seconds: number | null; first: string | null; last: string | null }>(
    `SELECT SUM(duration) AS seconds,
            MIN(date(started_at)) AS first,
            MAX(date(started_at)) AS last
       FROM time_entries
      WHERE project_id = ? AND ended_at IS NOT NULL`,
    [projectId]
  )

  const hours = worked?.seconds ?? 0

  const delivered = db
    .all<Row & { title: string }>(
      `SELECT title FROM tasks
        WHERE project_id = ? AND status = 'done' AND archived = 0 AND parent_id IS NULL
        ORDER BY sort_order, id
        LIMIT 12`,
      [projectId]
    )
    .map((row) => row.title)

  const facts: string[] = []
  if (project.client_name) facts.push(`**Client.** ${project.client_name}`)

  // Tracked dates first; the planned ones only where nothing was tracked, and
  // then said plainly as a plan rather than dressed up as a record.
  if (worked?.first && worked.last) {
    facts.push(`**Ran.** ${worked.first} to ${worked.last}`)
  } else if (project.starts_on && project.due_on) {
    facts.push(`**Planned.** ${project.starts_on} to ${project.due_on}`)
  } else if (project.starts_on) {
    facts.push(`**Started.** ${project.starts_on}`)
  }

  if (hours > 0) facts.push(`**Time on it.** ${Math.round(hours / 360) / 10} hours`)

  const body = [
    facts.join('\n\n'),
    '## The problem\n\n<!-- What they came to you with. In their words if you have them. -->',
    '## What you did\n\n<!-- The approach, not the task list. Why this rather than the obvious thing. -->',
    delivered.length > 0
      ? `## What was delivered\n\n${delivered.map((one) => `- ${one}`).join('\n')}`
      : '## What was delivered\n\n<!-- The things they ended up with. -->',
    '## What it was worth\n\n<!-- The outcome, with a number if you can get one. This is the part that wins the next job. -->'
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n')

  return {
    title: project.client_name ? `${project.client_name} — ${project.name}` : project.name,
    body,
    clientId: project.client_id,
    sourceProjectId: project.id
  }
}

import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from '../db'
import type { Project, ProjectInput, ProjectSummary, TemplatePayload } from '@shared/types'
import { uniqueFolderName } from './naming'
import { PROJECT_FOLDERS, resolveInWorkspace } from './workspace'
import { getTemplate } from './templates'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'

export { PROJECT_FOLDERS }

/** Projects with no client live here rather than under Clients. */
const INTERNAL_ROOT = 'Clients\\_Internal'

interface ProjectRow extends Row {
  id: number
  client_id: number | null
  name: string
  description: string
  status: string
  rate: number | null
  budget: number | null
  starts_on: string | null
  due_on: string | null
  colour: string
  folder: string
  archived: number
  created_at: string
  updated_at: string
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    status: row.status as Project['status'],
    rate: row.rate,
    budget: row.budget,
    startsOn: row.starts_on,
    dueOn: row.due_on,
    colour: row.colour,
    folder: row.folder,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * The list view needs the client name and task counts. One query with joins
 * beats N+1 lookups, and keeps sorting server-side where it belongs.
 */
export function listProjects(
  db: Database,
  options: { clientId?: number; includeArchived?: boolean } = {}
): ProjectSummary[] {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (!options.includeArchived) conditions.push('p.archived = 0')
  if (options.clientId !== undefined) {
    conditions.push('p.client_id = ?')
    params.push(options.clientId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db.all<ProjectRow & { client_name: string | null; task_count: number; open_task_count: number }>(
    `SELECT p.*,
            c.name AS client_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done')
              AS open_task_count
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       ${where}
       ORDER BY p.updated_at DESC`,
    params
  )

  return rows.map((row) => ({
    ...toProject(row),
    clientName: row.client_name,
    taskCount: row.task_count,
    openTaskCount: row.open_task_count
  }))
}

export function getProject(db: Database, id: number): Project {
  const row = db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id])
  if (!row) throw new Error(`No project with id ${id}`)
  return toProject(row)
}

/** Where a project's folder should sit, given its client. */
function parentFolder(db: Database, clientId: number | null): string {
  if (clientId === null) return INTERNAL_ROOT
  const row = db.get<Row & { folder: string }>('SELECT folder FROM clients WHERE id = ?', [
    clientId
  ])
  return row?.folder ?? INTERNAL_ROOT
}

export async function createProject(
  db: Database,
  workspacePath: string,
  input: ProjectInput
): Promise<Project> {
  const clientId = input.clientId ?? null
  const parent = parentFolder(db, clientId)

  const siblings = db
    .all<Row & { folder: string }>('SELECT folder FROM projects')
    .filter((r) => r.folder.startsWith(`${parent}\\`))
    .map((r) => r.folder.slice(parent.length + 1))

  const folder = join(parent, uniqueFolderName(input.name, siblings))

  // A template can replace the default folder set and seed a task list.
  const template = input.templateId ? getTemplate(db, input.templateId) : null
  const folders = template?.payload.folders ?? PROJECT_FOLDERS

  for (const child of folders) {
    await mkdir(resolveInWorkspace(workspacePath, join(folder, child)), { recursive: true })
  }

  db.run(
    `INSERT INTO projects
       (client_id, name, description, status, rate, budget, starts_on, due_on,
        colour, folder, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      clientId,
      input.name,
      input.description ?? '',
      input.status ?? 'active',
      input.rate ?? null,
      input.budget ?? null,
      input.startsOn ?? null,
      input.dueOn ?? null,
      input.colour ?? DEFAULT_ENTITY_COLOUR,
      folder
    ]
  )

  const created = db.get<ProjectRow>('SELECT * FROM projects WHERE id = last_insert_rowid()')
  if (!created) throw new Error('Project was not created')

  if (template) seedTasksFromTemplate(db, created.id, template.payload)

  return toProject(created)
}

function seedTasksFromTemplate(db: Database, projectId: number, payload: TemplatePayload): void {
  payload.tasks.forEach((task, index) => {
    db.run(
      `INSERT INTO tasks (project_id, category_id, title, status, priority, sort_order,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [projectId, task.categoryId, task.title, task.status, task.priority, index]
    )
  })
}

const UPDATABLE: Record<string, string> = {
  clientId: 'client_id',
  name: 'name',
  description: 'description',
  status: 'status',
  rate: 'rate',
  budget: 'budget',
  startsOn: 'starts_on',
  dueOn: 'due_on',
  colour: 'colour',
  archived: 'archived'
}

export async function updateProject(
  db: Database,
  workspacePath: string,
  id: number,
  patch: Partial<ProjectInput>
): Promise<Project> {
  const current = getProject(db, id)

  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE projects SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  // Completing a project is worth recording on its tasks' terms too, but that
  // is a decision for the user — we only move the folder here.
  if (patch.name && patch.name !== current.name) {
    await renameProjectFolder(db, workspacePath, current, patch.name)
  }

  return getProject(db, id)
}

async function renameProjectFolder(
  db: Database,
  workspacePath: string,
  current: Project,
  newName: string
): Promise<void> {
  const parent = parentFolder(db, current.clientId)
  const siblings = db
    .all<Row & { folder: string }>('SELECT folder FROM projects WHERE id != ?', [current.id])
    .filter((r) => r.folder.startsWith(`${parent}\\`))
    .map((r) => r.folder.slice(parent.length + 1))

  const nextFolder = join(parent, uniqueFolderName(newName, siblings))
  if (nextFolder === current.folder) return

  try {
    await rename(
      resolveInWorkspace(workspacePath, current.folder),
      resolveInWorkspace(workspacePath, nextFolder)
    )
    db.run('UPDATE projects SET folder = ? WHERE id = ?', [nextFolder, current.id])
    db.run('UPDATE notes SET file = replace(file, ?, ?) WHERE project_id = ?', [
      current.folder,
      nextFolder,
      current.id
    ])
  } catch {
    // Left in place; the record still points at the real folder.
  }
}

/** Removes the project and its tasks from SoloWrk. Files stay on disk. */
export function deleteProject(db: Database, id: number): void {
  db.run('DELETE FROM projects WHERE id = ?', [id])
}

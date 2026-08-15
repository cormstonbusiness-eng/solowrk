import type { Database, Row } from '../db'
import type { Template, TemplatePayload } from '@shared/types'
// Imported from workspace, not projects: projects imports this module, and the
// reverse edge would make a cycle that breaks the bundled main process.
import { PROJECT_FOLDERS } from './workspace'

interface TemplateRow extends Row {
  id: number
  name: string
  description: string
  payload: string
  created_at: string
  updated_at: string
}

const EMPTY_PAYLOAD: TemplatePayload = { folders: PROJECT_FOLDERS, tasks: [] }

/**
 * Payloads are JSON in a TEXT column. Parsing is defensive: a template written
 * by an older version, or edited by hand, should degrade to the defaults rather
 * than crash the projects page.
 */
function parsePayload(raw: string): TemplatePayload {
  try {
    const parsed = JSON.parse(raw) as Partial<TemplatePayload>
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : EMPTY_PAYLOAD.folders,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    }
  } catch {
    return EMPTY_PAYLOAD
  }
}

function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listTemplates(db: Database): Template[] {
  return db.all<TemplateRow>('SELECT * FROM templates ORDER BY name COLLATE NOCASE').map(toTemplate)
}

export function getTemplate(db: Database, id: number): Template {
  const row = db.get<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id])
  if (!row) throw new Error(`No template with id ${id}`)
  return toTemplate(row)
}

export function createTemplate(
  db: Database,
  input: { name: string; description?: string; payload: TemplatePayload }
): Template {
  db.run(
    `INSERT INTO templates (name, description, payload, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [input.name, input.description ?? '', JSON.stringify(input.payload)]
  )

  const row = db.get<TemplateRow>('SELECT * FROM templates WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Template was not created')
  return toTemplate(row)
}

/**
 * Capture an existing project as a template: its folder structure is assumed to
 * be the default set, and its top-level tasks become the seed list with their
 * status reset, since a template describes work to do, not work already done.
 */
export function templateFromProject(
  db: Database,
  projectId: number,
  name: string,
  description = ''
): Template {
  const tasks = db.all<Row & { title: string; category_id: number | null; priority: number }>(
    `SELECT title, category_id, priority FROM tasks
      WHERE project_id = ? AND parent_id IS NULL
      ORDER BY sort_order, id`,
    [projectId]
  )

  return createTemplate(db, {
    name,
    description,
    payload: {
      folders: PROJECT_FOLDERS,
      tasks: tasks.map((task) => ({
        title: task.title,
        categoryId: task.category_id,
        priority: task.priority,
        status: 'todo' as const
      }))
    }
  })
}

export function deleteTemplate(db: Database, id: number): void {
  db.run('DELETE FROM templates WHERE id = ?', [id])
}

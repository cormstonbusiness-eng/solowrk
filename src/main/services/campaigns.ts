import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from '../db'
import type {
  Campaign,
  CampaignInput,
  CampaignStatus,
  CampaignType,
  CampaignWithCounts,
  CampaignWork,
  FileEntry
} from '@shared/types'
import { uniqueFolderName } from './naming'
import { resolveInWorkspace } from './workspace'
import { listDirectory } from './files'
import { listContent } from './content'
import { listTasks } from './tasks'

/**
 * A time-boxed push, and the work that goes into it.
 *
 * What makes this a campaign rather than a label on some posts is that three
 * separate things hang off one: the content written for it, the tasks that
 * have to happen before any of it goes out, and a folder for the files they
 * produce. Each is reached the way that kind of thing is normally reached in
 * this app — content and tasks by a column, files by a real directory — so a
 * campaign's work shows up on the Tasks page and in the Files module without
 * either of them knowing campaigns exist.
 */

/** Under the Marketing root the workspace already scaffolds. */
const CAMPAIGNS_ROOT = join('Marketing', 'Campaigns')

interface CampaignRow extends Row {
  id: number
  name: string
  objective: string
  campaign_type: string
  status: string
  starts_on: string | null
  ends_on: string | null
  budget: number
  target_metric: string
  target_value: number | null
  brief: string
  retrospective: string
  is_template: number
  folder: string
  archived: number
  created_at: string
  updated_at: string
}

interface CountRow extends CampaignRow {
  content_count: number
  published_count: number
  task_count: number
  task_done_count: number
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    campaignType: row.campaign_type as CampaignType,
    status: row.status as CampaignStatus,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    budget: row.budget,
    targetMetric: row.target_metric,
    targetValue: row.target_value,
    brief: row.brief,
    retrospective: row.retrospective,
    isTemplate: row.is_template === 1,
    folder: row.folder,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * The counts a list row shows, done in SQL.
 *
 * Correlated subqueries rather than joins with a GROUP BY, because two
 * independent one-to-many joins multiply each other: a campaign with four
 * posts and three tasks would report twelve of each.
 */
const SELECT_WITH_COUNTS = `
  SELECT c.*,
         (SELECT COUNT(*) FROM content_items ci
           WHERE ci.campaign_id = c.id AND ci.archived = 0) AS content_count,
         (SELECT COUNT(*) FROM content_items ci
           WHERE ci.campaign_id = c.id AND ci.archived = 0
             AND ci.status = 'published') AS published_count,
         (SELECT COUNT(*) FROM tasks t
           WHERE t.campaign_id = c.id AND t.archived = 0) AS task_count,
         (SELECT COUNT(*) FROM tasks t
           WHERE t.campaign_id = c.id AND t.archived = 0
             AND t.status = 'done') AS task_done_count
    FROM marketing_campaigns c
`

function toCampaignWithCounts(row: CountRow): CampaignWithCounts {
  return {
    ...toCampaign(row),
    contentCount: row.content_count,
    publishedCount: row.published_count,
    taskCount: row.task_count,
    taskDoneCount: row.task_done_count
  }
}

export interface CampaignFilter {
  includeArchived?: boolean
  /** Templates are hidden from the campaign list and shown when starting one. */
  templates?: boolean
}

export function listCampaigns(db: Database, filter: CampaignFilter = {}): CampaignWithCounts[] {
  const where = ['c.is_template = ?']
  const params: (string | number)[] = [filter.templates ? 1 : 0]

  if (!filter.includeArchived) where.push('c.archived = 0')

  return db
    .all<CountRow>(
      `${SELECT_WITH_COUNTS} WHERE ${where.join(' AND ')}
        ORDER BY c.starts_on IS NULL, c.starts_on DESC, c.id DESC`,
      params
    )
    .map(toCampaignWithCounts)
}

export function getCampaign(db: Database, id: number): CampaignWithCounts {
  const row = db.get<CountRow>(`${SELECT_WITH_COUNTS} WHERE c.id = ?`, [id])
  if (!row) throw new Error(`No campaign with id ${id}`)
  return toCampaignWithCounts(row)
}

export async function createCampaign(
  db: Database,
  workspacePath: string,
  input: CampaignInput
): Promise<CampaignWithCounts> {
  const name = input.name?.trim() || 'New campaign'

  const taken = db
    .all<Row & { folder: string }>("SELECT folder FROM marketing_campaigns WHERE folder != ''")
    .map((row) => row.folder.replace(`${CAMPAIGNS_ROOT}\\`, ''))

  const folder = join(CAMPAIGNS_ROOT, uniqueFolderName(name, taken))

  // The folder first: if the disk refuses, no row is left pointing at a
  // directory that does not exist. The same order `createClient` uses.
  await mkdir(resolveInWorkspace(workspacePath, folder), { recursive: true })

  db.run(
    `INSERT INTO marketing_campaigns
       (name, objective, campaign_type, status, starts_on, ends_on, budget,
        target_metric, target_value, brief, retrospective, is_template, folder,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      name,
      input.objective ?? '',
      input.campaignType ?? 'content',
      input.status ?? 'planning',
      input.startsOn ?? null,
      input.endsOn ?? null,
      input.budget ?? 0,
      input.targetMetric ?? '',
      input.targetValue ?? null,
      input.brief ?? '',
      input.retrospective ?? '',
      input.isTemplate ? 1 : 0,
      folder
    ]
  )

  return getCampaign(db, db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id)
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  objective: 'objective',
  campaignType: 'campaign_type',
  status: 'status',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  budget: 'budget',
  targetMetric: 'target_metric',
  targetValue: 'target_value',
  brief: 'brief',
  retrospective: 'retrospective'
}

export function updateCampaign(
  db: Database,
  id: number,
  patch: CampaignInput
): CampaignWithCounts {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (patch.isTemplate !== undefined) {
    assignments.push('is_template = ?')
    values.push(patch.isTemplate ? 1 : 0)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE marketing_campaigns SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getCampaign(db, id)
}

/**
 * Archive rather than delete.
 *
 * Content published under a campaign keeps pointing somewhere, its tasks keep
 * their owner, and the folder stays on disk. Deleting the row to tidy a list
 * would strand all three.
 */
export function archiveCampaign(db: Database, id: number, archived = true): CampaignWithCounts {
  db.run(
    `UPDATE marketing_campaigns
        SET archived = ?, archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END,
            updated_at = datetime('now')
      WHERE id = ?`,
    [archived ? 1 : 0, archived ? 1 : 0, id]
  )

  return getCampaign(db, id)
}

/**
 * Everything a campaign has gathered.
 *
 * The files are read from the folder rather than recorded in a table, so
 * anything dropped in through Explorer is simply there. A table of file rows
 * would be a second copy of the directory that is wrong the moment somebody
 * moves something outside the app — which they will, because it is their
 * folder on their disk.
 */
export async function campaignWork(
  db: Database,
  workspacePath: string,
  id: number
): Promise<CampaignWork> {
  const campaign = getCampaign(db, id)

  let files: FileEntry[] = []
  if (campaign.folder !== '') {
    try {
      files = await listDirectory(workspacePath, campaign.folder)
    } catch {
      // A folder somebody deleted or renamed from outside. The campaign is
      // still perfectly usable without it, and refusing to open the record
      // over a missing directory would be the wrong trade.
      files = []
    }
  }

  return {
    content: listContent(db, { campaignId: id }),
    tasks: listTasks(db, { campaignId: id }),
    files
  }
}

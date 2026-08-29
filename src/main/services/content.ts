import type { Database, Row } from '../db'
import type { ContentItem, ContentItemInput, ContentItemWithContext } from '@shared/types'
import { ghostsFor, type Ghost } from '@shared/cadence'
import { listChannels } from './channels'

/**
 * The things you have written, and the ones you have not.
 *
 * Ordinary CRUD over `content_items`, plus the one thing that is not: the
 * calendar asks for a month and gets back both what exists *and* where the
 * gaps are, computed here rather than in the renderer.
 *
 * That placement is deliberate. The gaps depend on every channel's commitment
 * and on everything already scheduled in each period, so working them out in
 * the renderer would mean shipping both lists across the bridge and doing the
 * arithmetic twice — once for the calendar and again for the consistency
 * strip. Derived on read, like every other computed figure in this app, so no
 * stored copy can drift.
 */

interface ContentRow extends Row {
  id: number
  title: string
  hook: string
  body: string
  channel_id: number | null
  campaign_id: number | null
  status: string
  scheduled_for: string | null
  published_at: string | null
  link_url: string
  asset_paths: string
  source_project_id: number | null
  parent_content_id: number | null
  notes: string
  created_at: string
  updated_at: string
  channel_name: string | null
  channel_colour: string | null
  campaign_name: string | null
}

const SELECT = `
  SELECT c.*,
         ch.name   AS channel_name,
         ch.colour AS channel_colour,
         ca.name   AS campaign_name
    FROM content_items c
    LEFT JOIN marketing_channels ch ON ch.id = c.channel_id
    LEFT JOIN marketing_campaigns ca ON ca.id = c.campaign_id
`

function toItem(row: ContentRow): ContentItemWithContext {
  return {
    id: row.id,
    title: row.title,
    hook: row.hook,
    body: row.body,
    channelId: row.channel_id,
    campaignId: row.campaign_id,
    status: row.status as ContentItem['status'],
    scheduledFor: row.scheduled_for,
    publishedAt: row.published_at,
    linkUrl: row.link_url,
    assetPaths: row.asset_paths,
    sourceProjectId: row.source_project_id,
    parentContentId: row.parent_content_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    channelName: row.channel_name ?? '',
    channelColour: row.channel_colour ?? '#6E56CF',
    campaignName: row.campaign_name ?? ''
  }
}

export interface ContentFilter {
  from?: string
  to?: string
  /** Everything with no date on it — the ideas column, and the backlog rail. */
  undated?: boolean
  campaignId?: number
}

export function listContent(db: Database, filter: ContentFilter = {}): ContentItemWithContext[] {
  const where: string[] = ['c.archived = 0']
  const params: (string | number)[] = []

  if (filter.undated) {
    where.push('c.scheduled_for IS NULL')
  } else if (filter.from && filter.to) {
    where.push('substr(c.scheduled_for, 1, 10) BETWEEN ? AND ?')
    params.push(filter.from, filter.to)
  }

  if (filter.campaignId !== undefined) {
    where.push('c.campaign_id = ?')
    params.push(filter.campaignId)
  }

  return db
    .all<ContentRow>(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY c.scheduled_for, c.id`,
      params
    )
    .map(toItem)
}

export function getContent(db: Database, id: number): ContentItemWithContext {
  const row = db.get<ContentRow>(`${SELECT} WHERE c.id = ?`, [id])
  if (!row) throw new Error(`No content item with id ${id}`)
  return toItem(row)
}

export function createContent(db: Database, input: ContentItemInput): ContentItemWithContext {
  db.run(
    `INSERT INTO content_items
       (title, hook, body, channel_id, campaign_id, status, scheduled_for,
        link_url, asset_paths, source_project_id, parent_content_id, notes,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.title?.trim() ?? '',
      input.hook ?? '',
      input.body ?? '',
      input.channelId ?? null,
      input.campaignId ?? null,
      // A dated item is scheduled; an undated one is an idea. Inferring it
      // saves the caller from setting two fields that cannot disagree.
      input.status ?? (input.scheduledFor ? 'scheduled' : 'idea'),
      input.scheduledFor ?? null,
      input.linkUrl ?? '',
      input.assetPaths ?? '',
      input.sourceProjectId ?? null,
      input.parentContentId ?? null,
      input.notes ?? ''
    ]
  )

  return getContent(db, db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id)
}

const COLUMNS: Record<string, string> = {
  title: 'title',
  hook: 'hook',
  body: 'body',
  channelId: 'channel_id',
  campaignId: 'campaign_id',
  status: 'status',
  scheduledFor: 'scheduled_for',
  linkUrl: 'link_url',
  assetPaths: 'asset_paths',
  sourceProjectId: 'source_project_id',
  parentContentId: 'parent_content_id',
  notes: 'notes'
}

export function updateContent(
  db: Database,
  id: number,
  patch: ContentItemInput
): ContentItemWithContext {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  /**
   * Publishing stamps the day, once.
   *
   * There is no publishing integration and there will not be — §1.1 is clear
   * that this is a planning and record-keeping tool. Marking something
   * published is somebody telling the app what they did, and the honest thing
   * is to record it and say nothing about having done it for them.
   */
  if (patch.status === 'published') {
    assignments.push("published_at = COALESCE(published_at, datetime('now'))")
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE content_items SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getContent(db, id)
}

export function deleteContent(db: Database, id: number): void {
  db.run("UPDATE content_items SET archived = 1, archived_at = datetime('now') WHERE id = ?", [id])
}

/* ------------------------------------------------------------------ *
 * The month, gaps and all
 * ------------------------------------------------------------------ */

export interface ContentMonth {
  items: ContentItemWithContext[]
  /** Where a commitment is not yet met. Not rows — nothing is stored. */
  ghosts: Ghost[]
}

/**
 * Everything the calendar needs for a range.
 *
 * The ghosts are computed per channel against what that channel already has in
 * each period, so a week that meets its commitment shows none. They exist only
 * for the length of this call: a gap is the absence of something, and storing
 * absences would mean reconciling them every time a real item moved.
 */
export function contentMonth(db: Database, from: string, to: string): ContentMonth {
  const items = listContent(db, { from, to })

  const ghosts = listChannels(db).flatMap((channel) =>
    ghostsFor(
      channel,
      from,
      to,
      items
        .filter((item) => item.channelId === channel.id && item.scheduledFor)
        .map((item) => item.scheduledFor!.slice(0, 10))
    )
  )

  return { items, ghosts }
}

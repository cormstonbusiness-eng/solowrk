import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import type { Database, Row } from '../db'
import type {
  Campaign,
  CampaignStatus,
  CampaignWithCounts,
  ContentPillar,
  MarketingSummary,
  PillarShare,
  Post,
  PostFilter,
  PostInput,
  PostMedia,
  PostStatus,
  PostTarget,
  PostWithContext,
  TargetStatus
} from '@shared/types'
import type { Platform } from '@shared/social'
import { PLATFORMS } from '@shared/social'
import { addDays, dayOf, daysBetween, minutesBetween } from '@shared/calendar'
import { uniqueFileName } from './naming'
import { resolveInWorkspace } from './workspace'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'

export const MARKETING_ROOT = 'Marketing'
const ASSETS_ROOT = join(MARKETING_ROOT, 'Assets')

/* ------------------------------------------------------------------ *
 * Campaigns
 * ------------------------------------------------------------------ */

interface CampaignRow extends Row {
  id: number
  name: string
  description: string
  goal: string
  colour: string
  starts_on: string | null
  ends_on: string | null
  status: string
  created_at: string
  updated_at: string
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    colour: row.colour,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status as CampaignStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listCampaigns(db: Database, includeArchived = false): CampaignWithCounts[] {
  const where = includeArchived ? '' : "WHERE c.status != 'archived'"

  return db
    .all<CampaignRow & { post_count: number; published_count: number }>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM posts p WHERE p.campaign_id = c.id) AS post_count,
              (SELECT COUNT(*) FROM posts p
                WHERE p.campaign_id = c.id AND p.status = 'published') AS published_count
         FROM campaigns c ${where}
        ORDER BY COALESCE(c.starts_on, c.created_at) DESC, c.id DESC`
    )
    .map((row) => ({
      ...toCampaign(row),
      postCount: row.post_count,
      publishedCount: row.published_count
    }))
}

export function createCampaign(
  db: Database,
  input: Partial<Campaign> & { name: string }
): Campaign {
  db.run(
    `INSERT INTO campaigns (name, description, goal, colour, starts_on, ends_on, status,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name,
      input.description ?? '',
      input.goal ?? '',
      input.colour ?? DEFAULT_ENTITY_COLOUR,
      input.startsOn ?? null,
      input.endsOn ?? null,
      input.status ?? 'active'
    ]
  )
  return getCampaign(db, lastId(db))
}

export function getCampaign(db: Database, id: number): Campaign {
  const row = db.get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', [id])
  if (!row) throw new Error(`No campaign with id ${id}`)
  return toCampaign(row)
}

const CAMPAIGN_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  goal: 'goal',
  colour: 'colour',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  status: 'status'
}

export function updateCampaign(db: Database, id: number, patch: Partial<Campaign>): Campaign {
  applyPatch(db, 'campaigns', CAMPAIGN_COLUMNS, id, patch)
  return getCampaign(db, id)
}

export function deleteCampaign(db: Database, id: number): void {
  // Posts survive their campaign — the work was still done, and losing a month
  // of drafts because a campaign was tidied away would be indefensible.
  db.run('DELETE FROM campaigns WHERE id = ?', [id])
}

/* ------------------------------------------------------------------ *
 * Content pillars
 * ------------------------------------------------------------------ */

interface PillarRow extends Row {
  id: number
  name: string
  description: string
  colour: string
  target_share: number
  sort_order: number
  created_at: string
  updated_at: string
}

function toPillar(row: PillarRow): ContentPillar {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    colour: row.colour,
    targetShare: row.target_share,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listPillars(db: Database): ContentPillar[] {
  return db
    .all<PillarRow>('SELECT * FROM content_pillars ORDER BY sort_order, id')
    .map(toPillar)
}

export function createPillar(
  db: Database,
  input: { name: string; colour?: string; description?: string; targetShare?: number }
): ContentPillar {
  const next = db.get<Row & { max_order: number | null }>(
    'SELECT MAX(sort_order) AS max_order FROM content_pillars'
  )

  db.run(
    `INSERT INTO content_pillars (name, description, colour, target_share, sort_order,
                                  created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name,
      input.description ?? '',
      input.colour ?? DEFAULT_ENTITY_COLOUR,
      input.targetShare ?? 0,
      (next?.max_order ?? 0) + 1
    ]
  )

  const row = db.get<PillarRow>('SELECT * FROM content_pillars WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Pillar was not created')
  return toPillar(row)
}

const PILLAR_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  colour: 'colour',
  targetShare: 'target_share',
  sortOrder: 'sort_order'
}

export function updatePillar(
  db: Database,
  id: number,
  patch: Partial<ContentPillar>
): ContentPillar {
  applyPatch(db, 'content_pillars', PILLAR_COLUMNS, id, patch)
  const row = db.get<PillarRow>('SELECT * FROM content_pillars WHERE id = ?', [id])
  if (!row) throw new Error(`No pillar with id ${id}`)
  return toPillar(row)
}

export function deletePillar(db: Database, id: number): void {
  db.run('DELETE FROM content_pillars WHERE id = ?', [id])
}

/* ------------------------------------------------------------------ *
 * Posts
 * ------------------------------------------------------------------ */

interface PostRow extends Row {
  id: number
  campaign_id: number | null
  pillar_id: number | null
  project_id: number | null
  title: string
  body: string
  link_url: string
  notes: string
  status: string
  scheduled_at: string | null
  published_at: string | null
  evergreen_days: number | null
  next_repeat_on: string | null
  parent_post_id: number | null
  created_at: string
  updated_at: string
}

type PostContextRow = PostRow & {
  campaign_name: string | null
  campaign_colour: string | null
  pillar_name: string | null
  pillar_colour: string | null
}

interface TargetRow extends Row {
  id: number
  post_id: number
  account_id: number | null
  platform: string
  body: string
  title: string
  board_id: string | null
  status: string
  external_id: string | null
  external_url: string | null
  error: string
  published_at: string | null
}

interface MediaRow extends Row {
  id: number
  post_id: number
  file: string
  alt_text: string
  sort_order: number
}

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    pillarId: row.pillar_id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    notes: row.notes,
    status: row.status as PostStatus,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    evergreenDays: row.evergreen_days,
    nextRepeatOn: row.next_repeat_on,
    parentPostId: row.parent_post_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toTarget(row: TargetRow): PostTarget {
  return {
    id: row.id,
    postId: row.post_id,
    accountId: row.account_id,
    platform: row.platform as Platform,
    body: row.body,
    title: row.title,
    boardId: row.board_id,
    status: row.status as TargetStatus,
    externalId: row.external_id,
    externalUrl: row.external_url,
    error: row.error,
    publishedAt: row.published_at
  }
}

function toMedia(row: MediaRow): PostMedia {
  return {
    id: row.id,
    postId: row.post_id,
    file: row.file,
    altText: row.alt_text,
    sortOrder: row.sort_order
  }
}

const SELECT_POST = `
  SELECT p.*,
         c.name   AS campaign_name,
         c.colour AS campaign_colour,
         l.name   AS pillar_name,
         l.colour AS pillar_colour
    FROM posts p
    LEFT JOIN campaigns       c ON c.id = p.campaign_id
    LEFT JOIN content_pillars l ON l.id = p.pillar_id
`

function hydrate(db: Database, rows: PostContextRow[]): PostWithContext[] {
  if (rows.length === 0) return []

  // Two queries for the whole page rather than two per post: a month of posts
  // across five platforms is otherwise a few hundred round trips.
  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(', ')

  const targets = db.all<TargetRow>(
    `SELECT * FROM post_targets WHERE post_id IN (${placeholders}) ORDER BY id`,
    ids
  )
  const media = db.all<MediaRow>(
    `SELECT * FROM post_media WHERE post_id IN (${placeholders}) ORDER BY sort_order, id`,
    ids
  )

  return rows.map((row) => ({
    ...toPost(row),
    campaignName: row.campaign_name,
    campaignColour: row.campaign_colour,
    pillarName: row.pillar_name,
    pillarColour: row.pillar_colour,
    targets: targets.filter((target) => target.post_id === row.id).map(toTarget),
    media: media.filter((item) => item.post_id === row.id).map(toMedia)
  }))
}

export function listPosts(db: Database, filter: PostFilter = {}): PostWithContext[] {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter.backlog) {
    // The backlog is what has no date yet, whatever else is true of it.
    conditions.push('p.scheduled_at IS NULL')
  } else {
    if (filter.from) {
      conditions.push('substr(p.scheduled_at, 1, 10) >= ?')
      params.push(filter.from)
    }
    if (filter.to) {
      conditions.push('substr(p.scheduled_at, 1, 10) <= ?')
      params.push(filter.to)
    }
    if (filter.from || filter.to) conditions.push('p.scheduled_at IS NOT NULL')
  }

  if (filter.status) {
    conditions.push('p.status = ?')
    params.push(filter.status)
  }
  if (filter.campaignId !== undefined) {
    conditions.push('p.campaign_id = ?')
    params.push(filter.campaignId)
  }
  if (filter.pillarId !== undefined) {
    conditions.push('p.pillar_id = ?')
    params.push(filter.pillarId)
  }
  if (filter.search) {
    conditions.push('(p.title LIKE ? OR p.body LIKE ? OR p.notes LIKE ?)')
    const like = `%${filter.search}%`
    params.push(like, like, like)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const order = filter.backlog
    ? 'ORDER BY p.updated_at DESC, p.id DESC'
    : 'ORDER BY p.scheduled_at, p.id'

  return hydrate(db, db.all<PostContextRow>(`${SELECT_POST} ${where} ${order}`, params))
}

export function getPost(db: Database, id: number): PostWithContext {
  const rows = db.all<PostContextRow>(`${SELECT_POST} WHERE p.id = ?`, [id])
  const [post] = hydrate(db, rows)
  if (!post) throw new Error(`No post with id ${id}`)
  return post
}

/**
 * A post's status is derived from its targets once it has been sent, never set
 * by the caller: "published" must mean every destination actually took it, and
 * a partial failure has to be visible rather than rounded up to success.
 */
export function resyncPostStatus(db: Database, id: number): void {
  const post = db.get<PostRow>('SELECT * FROM posts WHERE id = ?', [id])
  if (!post) return

  const targets = db.all<TargetRow>('SELECT * FROM post_targets WHERE post_id = ?', [id])
  const live = targets.filter((target) => target.status !== 'skipped')
  if (live.length === 0) return

  const sent = live.filter(
    (target) => target.status === 'published' || target.status === 'handed_over'
  )
  const failed = live.filter((target) => target.status === 'failed')

  let status: PostStatus | null = null
  if (sent.length === live.length) status = 'published'
  else if (failed.length > 0) status = 'failed'

  if (status === null || status === post.status) return

  db.run(
    `UPDATE posts SET status = ?,
            published_at = CASE WHEN ? = 'published' AND published_at IS NULL
                                THEN datetime('now') ELSE published_at END,
            updated_at = datetime('now')
      WHERE id = ?`,
    [status, status, id]
  )
}

/**
 * Copy an asset into the workspace, filed by the year and month it was added.
 *
 * Same shape as receipts in `expenses.ts`: the folder stays navigable after a
 * few hundred images, and a year's assets are a folder you can copy.
 */
export async function fileAsset(
  workspacePath: string,
  source: string,
  today: string
): Promise<string> {
  const [year, month] = today.split('-')
  const folderRelative = join(ASSETS_ROOT, year!, month!)
  const folder = resolveInWorkspace(workspacePath, folderRelative)

  await mkdir(folder, { recursive: true })
  const name = uniqueFileName(basename(source), await readdir(folder))
  await copyFile(source, join(folder, name))

  return join(folderRelative, name)
}

async function writeMedia(
  db: Database,
  workspacePath: string,
  postId: number,
  media: { file: string; altText?: string }[],
  today: string
): Promise<void> {
  db.run('DELETE FROM post_media WHERE post_id = ?', [postId])

  for (const [index, item] of media.entries()) {
    // An absolute path came from a picker or a drag and still needs copying in;
    // a relative one is already in the workspace and is reused as-is, so
    // re-saving a post does not duplicate its images on every edit.
    const file = isAbsolute(item.file)
      ? await fileAsset(workspacePath, item.file, today)
      : item.file

    db.run(
      `INSERT INTO post_media (post_id, file, alt_text, sort_order, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [postId, file, item.altText ?? '', index]
    )
  }
}

function writeTargets(db: Database, postId: number, targets: NonNullable<PostInput['targets']>): void {
  // Targets that have already gone out are left alone: rewriting the row that
  // records a published post would lose the external id and the link to it.
  const settled = db.all<TargetRow>(
    `SELECT * FROM post_targets
      WHERE post_id = ? AND status IN ('published', 'handed_over')`,
    [postId]
  )
  const settledPlatforms = new Set(settled.map((target) => target.platform))

  db.run(
    `DELETE FROM post_targets
      WHERE post_id = ? AND status NOT IN ('published', 'handed_over')`,
    [postId]
  )

  for (const target of targets) {
    if (settledPlatforms.has(target.platform)) continue

    db.run(
      `INSERT INTO post_targets (post_id, account_id, platform, body, title, board_id,
                                 status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
      [
        postId,
        target.accountId ?? null,
        target.platform,
        target.body ?? '',
        target.title ?? '',
        target.boardId ?? null
      ]
    )
  }
}

export async function createPost(
  db: Database,
  workspacePath: string,
  input: PostInput,
  today: string
): Promise<PostWithContext> {
  // An idea is a post without a date. Anything with a date is at least a draft,
  // so the two can never disagree.
  const status = input.status ?? (input.scheduledAt ? 'scheduled' : 'idea')

  db.run(
    `INSERT INTO posts (campaign_id, pillar_id, project_id, title, body, link_url, notes,
                        status, scheduled_at, evergreen_days, next_repeat_on, parent_post_id,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.campaignId ?? null,
      input.pillarId ?? null,
      input.projectId ?? null,
      input.title ?? '',
      input.body ?? '',
      input.linkUrl ?? '',
      input.notes ?? '',
      status,
      input.scheduledAt ?? null,
      input.evergreenDays ?? null,
      input.evergreenDays && input.scheduledAt
        ? addDays(dayOf(input.scheduledAt), input.evergreenDays)
        : null,
      input.parentPostId ?? null
    ]
  )

  const id = lastId(db)
  if (input.targets) writeTargets(db, id, input.targets)
  if (input.media) await writeMedia(db, workspacePath, id, input.media, today)

  return getPost(db, id)
}

const POST_COLUMNS: Record<string, string> = {
  campaignId: 'campaign_id',
  pillarId: 'pillar_id',
  projectId: 'project_id',
  title: 'title',
  body: 'body',
  linkUrl: 'link_url',
  notes: 'notes',
  status: 'status',
  scheduledAt: 'scheduled_at',
  evergreenDays: 'evergreen_days',
  nextRepeatOn: 'next_repeat_on'
}

export async function updatePost(
  db: Database,
  workspacePath: string,
  id: number,
  patch: PostInput,
  today: string
): Promise<PostWithContext> {
  const current = getPost(db, id)

  const merged: PostInput = { ...patch }

  // Dating an idea promotes it; clearing the date sends it back to the backlog.
  // Neither should need the caller to remember to set the status too.
  if (patch.scheduledAt !== undefined && patch.status === undefined) {
    if (patch.scheduledAt === null && current.status === 'scheduled') merged.status = 'idea'
    else if (patch.scheduledAt !== null && (current.status === 'idea' || current.status === 'draft'))
      merged.status = 'scheduled'
  }

  applyPatch(db, 'posts', POST_COLUMNS, id, merged)

  if (patch.targets) writeTargets(db, id, patch.targets)
  if (patch.media) await writeMedia(db, workspacePath, id, patch.media, today)

  return getPost(db, id)
}

export function deletePost(db: Database, id: number): void {
  // Targets and media cascade; the asset files stay on disk, as everywhere else
  // in the app — deleting a record must not delete a photograph.
  db.run('DELETE FROM posts WHERE id = ?', [id])
}

export function setTargetResult(
  db: Database,
  targetId: number,
  result: {
    status: TargetStatus
    externalId?: string | null
    externalUrl?: string | null
    error?: string
  }
): void {
  db.run(
    `UPDATE post_targets
        SET status = ?, external_id = ?, external_url = ?, error = ?,
            published_at = CASE WHEN ? = 'published' THEN datetime('now') ELSE published_at END,
            updated_at = datetime('now')
      WHERE id = ?`,
    [
      result.status,
      result.externalId ?? null,
      result.externalUrl ?? null,
      result.error ?? '',
      result.status,
      targetId
    ]
  )

  const row = db.get<TargetRow>('SELECT post_id FROM post_targets WHERE id = ?', [targetId])
  if (row) resyncPostStatus(db, row.post_id)
}

/* ------------------------------------------------------------------ *
 * Scheduling
 * ------------------------------------------------------------------ */

/**
 * How late a post can be and still go out unattended.
 *
 * SoloWrk is a desktop app, so it cannot publish while it is closed. When it
 * opens and finds a post that came due an hour ago, sending it is still fine —
 * nobody can tell. A post that came due on Tuesday is a different matter: the
 * moment has gone, and quietly sending it now would be worse than saying so.
 * Same reasoning, and same shape, as `REMINDER_GRACE_MINUTES` for events.
 */
export const PUBLISH_GRACE_MINUTES = 60

/**
 * Scheduled posts whose moment has arrived.
 *
 * `due` should go out now. `late` missed their window while the app was closed
 * and are handed back for the user to decide about.
 */
export function duePosts(
  db: Database,
  now: string
): { due: PostWithContext[]; late: PostWithContext[] } {
  const rows = db.all<PostContextRow>(
    `${SELECT_POST}
      WHERE p.status = 'scheduled'
        AND p.scheduled_at IS NOT NULL
        AND p.scheduled_at <= ?
      ORDER BY p.scheduled_at`,
    [now]
  )

  const due: PostWithContext[] = []
  const late: PostWithContext[] = []

  for (const post of hydrate(db, rows)) {
    const minutesLate = minutesBetween(post.scheduledAt!, now)
    if (minutesLate > PUBLISH_GRACE_MINUTES) late.push(post)
    else due.push(post)
  }

  return { due, late }
}

export function markNeedsAttention(db: Database, ids: number[]): void {
  if (ids.length === 0) return
  db.run(
    `UPDATE posts SET status = 'needs_attention', updated_at = datetime('now')
      WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  )
}

/**
 * Evergreen posts that have come round again, re-scheduled as fresh copies.
 *
 * A copy rather than a reschedule, so the original keeps its published date and
 * its metrics: "this went out four times and did well twice" is the question
 * evergreen content exists to answer. Catches up on missed cycles the same way
 * recurring invoices do, but only ever schedules the next one forward — a post
 * that should have repeated three times while the app was closed does not
 * arrive as three posts.
 */
export async function runEvergreen(
  db: Database,
  workspacePath: string,
  today: string
): Promise<PostWithContext[]> {
  const candidates = db.all<PostRow>(
    `SELECT * FROM posts
      WHERE evergreen_days IS NOT NULL
        AND next_repeat_on IS NOT NULL
        AND next_repeat_on <= ?
        AND status IN ('published', 'scheduled')`,
    [today]
  )

  const created: PostWithContext[] = []

  for (const row of candidates) {
    const source = getPost(db, row.id)

    // Keep the original's time of day: an evergreen post that did well at 9am
    // should come back at 9am, not at whatever time the app happened to open.
    const time = (source.scheduledAt ?? source.publishedAt ?? '').slice(11, 16) || '09:00'

    let next = row.next_repeat_on!
    while (next < today) next = addDays(next, row.evergreen_days!)

    const copy = await createPost(
      db,
      workspacePath,
      {
        campaignId: source.campaignId,
        pillarId: source.pillarId,
        title: source.title,
        body: source.body,
        linkUrl: source.linkUrl,
        notes: source.notes,
        status: 'scheduled',
        scheduledAt: `${next}T${time}`,
        parentPostId: source.parentPostId ?? source.id,
        targets: source.targets.map((target) => ({
          platform: target.platform,
          accountId: target.accountId,
          body: target.body,
          title: target.title,
          boardId: target.boardId
        })),
        media: source.media.map((item) => ({ file: item.file, altText: item.altText }))
      },
      today
    )

    db.run('UPDATE posts SET next_repeat_on = ?, updated_at = datetime(\'now\') WHERE id = ?', [
      addDays(next, row.evergreen_days!),
      row.id
    ])

    created.push(copy)
  }

  return created
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

/**
 * How the plan actually looks over a range: what is scheduled, what went out,
 * what is stuck, where the gaps are, and whether the pillar mix matches what
 * was intended.
 */
export function marketingSummary(
  db: Database,
  range: { from: string; to: string }
): MarketingSummary {
  const posts = listPosts(db, { from: range.from, to: range.to })

  const mix = pillarMix(db, posts)

  const planned = new Set(posts.map((post) => dayOf(post.scheduledAt ?? '')))
  const span = Math.max(0, daysBetween(range.from, range.to))
  const emptyDays = Array.from({ length: span + 1 }, (_, index) => addDays(range.from, index))
    .filter((day) => !planned.has(day))

  const byPlatform = (Object.keys(PLATFORMS) as Platform[]).map((platform) => {
    const targets = posts.flatMap((post) =>
      post.targets.filter((target) => target.platform === platform)
    )
    return {
      platform,
      scheduled: targets.filter((target) => target.status === 'pending').length,
      published: targets.filter(
        (target) => target.status === 'published' || target.status === 'handed_over'
      ).length
    }
  })

  return {
    range,
    scheduled: posts.filter((post) => post.status === 'scheduled').length,
    published: posts.filter((post) => post.status === 'published').length,
    needsAttention: posts.filter(
      (post) => post.status === 'needs_attention' || post.status === 'failed'
    ).length,
    emptyDays,
    mix,
    byPlatform
  }
}

/**
 * Share of output per pillar, against the target share set on each one.
 *
 * Shares are basis points of the posts in range, so they always sum to 10000
 * (bar rounding) and can be compared with `targetShare` directly. Posts with no
 * pillar are counted under a null pillar rather than dropped — "40% of what I
 * post has no theme at all" is the most useful thing this can tell you.
 */
export function pillarMix(db: Database, posts: PostWithContext[]): PillarShare[] {
  const pillars = listPillars(db)
  const total = posts.length

  const share = (count: number): number => (total === 0 ? 0 : Math.round((count * 10_000) / total))

  const rows: PillarShare[] = pillars.map((pillar) => {
    const count = posts.filter((post) => post.pillarId === pillar.id).length
    return {
      pillarId: pillar.id,
      name: pillar.name,
      colour: pillar.colour,
      posts: count,
      actualShare: share(count),
      targetShare: pillar.targetShare
    }
  })

  const unassigned = posts.filter((post) => post.pillarId === null).length
  if (unassigned > 0) {
    rows.push({
      pillarId: null,
      name: 'No pillar',
      colour: '#5a5a63',
      posts: unassigned,
      actualShare: share(unassigned),
      targetShare: 0
    })
  }

  return rows
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function lastId(db: Database): number {
  const row = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')
  if (!row) throw new Error('Insert did not return an id')
  return row.id
}

/** Column-mapped partial update, the pattern used across the services. */
function applyPatch(
  db: Database,
  table: string,
  columns: Record<string, string>,
  id: number,
  patch: Record<string, unknown>
): void {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }

  if (assignments.length === 0) return

  db.run(
    `UPDATE ${table} SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...values, id]
  )
}

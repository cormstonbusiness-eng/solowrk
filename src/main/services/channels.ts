import type { Database, Row } from '../db'
import type { MarketingChannel, MarketingChannelInput, MarketingPlan, MarketingPlanInput } from '@shared/types'
import type { CadencePeriod } from '@shared/cadence'

/**
 * Where work comes from, and how often you have promised to show up there.
 *
 * The channel list is ordinary CRUD. The part that matters is the pair of
 * cadence columns, because §4.2 hangs the whole module on them: a commitment
 * made visible is the only thing that reliably fixes the consistency problem
 * freelance marketing actually has.
 *
 * Nothing here enforces a commitment. Missing one produces a quiet mark on the
 * tracker and no more — no streaks, no badges, no nagging. Those produce
 * abandonment rather than behaviour change.
 */

interface ChannelRow extends Row {
  id: number
  name: string
  type: string
  handle_or_url: string
  colour: string
  is_active: number
  cadence_count: number
  cadence_period: string
  character_limit: number | null
  sort_order: number
}

function toChannel(row: ChannelRow): MarketingChannel {
  return {
    id: row.id,
    name: row.name,
    type: row.type as MarketingChannel['type'],
    handleOrUrl: row.handle_or_url,
    colour: row.colour,
    isActive: row.is_active === 1,
    cadenceCount: row.cadence_count,
    cadencePeriod: row.cadence_period as CadencePeriod,
    characterLimit: row.character_limit,
    sortOrder: row.sort_order
  }
}

export function listChannels(db: Database, includeInactive = false): MarketingChannel[] {
  const where = includeInactive ? '' : 'WHERE is_active = 1'
  return db
    .all<ChannelRow>(`SELECT * FROM marketing_channels ${where} ORDER BY sort_order, id`)
    .map(toChannel)
}

export function createChannel(db: Database, input: MarketingChannelInput): MarketingChannel {
  const last =
    db.get<Row & { last: number | null }>('SELECT MAX(sort_order) AS last FROM marketing_channels')
      ?.last ?? 0

  db.run(
    `INSERT INTO marketing_channels
       (name, type, handle_or_url, colour, is_active, cadence_count, cadence_period,
        character_limit, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name?.trim() || 'New channel',
      input.type ?? 'social',
      input.handleOrUrl ?? '',
      input.colour ?? '#6E56CF',
      input.isActive === false ? 0 : 1,
      input.cadenceCount ?? 0,
      input.cadencePeriod ?? 'week',
      input.characterLimit ?? null,
      last + 1
    ]
  )

  return getChannel(db, db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id)
}

export function getChannel(db: Database, id: number): MarketingChannel {
  const row = db.get<ChannelRow>('SELECT * FROM marketing_channels WHERE id = ?', [id])
  if (!row) throw new Error(`No channel with id ${id}`)
  return toChannel(row)
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  type: 'type',
  handleOrUrl: 'handle_or_url',
  colour: 'colour',
  cadenceCount: 'cadence_count',
  cadencePeriod: 'cadence_period',
  characterLimit: 'character_limit',
  sortOrder: 'sort_order'
}

export function updateChannel(
  db: Database,
  id: number,
  patch: MarketingChannelInput
): MarketingChannel {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (patch.isActive !== undefined) {
    assignments.push('is_active = ?')
    values.push(patch.isActive ? 1 : 0)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE marketing_channels SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = ?`,
      [...values, id]
    )
  }

  return getChannel(db, id)
}

/**
 * Retiring a channel rather than deleting it.
 *
 * Content already published to it keeps pointing somewhere, and the
 * consistency strip keeps its history. Deleting the row would blank a year of
 * the tracker to tidy a list.
 */
export function deactivateChannel(db: Database, id: number): MarketingChannel {
  return updateChannel(db, id, { isActive: false })
}

/**
 * What to offer on a first run.
 *
 * §15 asks whether to ship a suggested set or start empty, and answers its own
 * question: suggested converts better, because an empty Marketing module gives
 * somebody nothing to react to. Deleting one is a click; inventing six from
 * nothing is an afternoon.
 *
 * No cadence on any of them. The commitment is the one decision worth making
 * deliberately, and guessing it would either set a bar nobody agreed to or
 * teach them to ignore the gaps on day one.
 */
export const SUGGESTED_CHANNELS: MarketingChannelInput[] = [
  { name: 'LinkedIn', type: 'social', colour: '#0A66C2' },
  { name: 'Instagram', type: 'social', colour: '#C13584' },
  { name: 'Newsletter', type: 'content', colour: '#F5A623' },
  { name: 'Blog', type: 'content', colour: '#30A46C' },
  { name: 'Referrals', type: 'referral', colour: '#6E56CF' },
  { name: 'Directories', type: 'directory', colour: '#8a8a93' }
]

/**
 * Puts the suggested set in, once, if there are none at all.
 *
 * `max` is how many the tier still has room for. Basic+ is capped at three
 * (§12) and the suggested set is six, so seeding blind would hand somebody
 * twice their allowance and then refuse the next thing they did. It takes the
 * first `max` instead, in the order above — which is why that order is not
 * arbitrary.
 */
export function seedChannels(db: Database, max = SUGGESTED_CHANNELS.length): number {
  const existing = db.get<Row & { n: number }>('SELECT COUNT(*) AS n FROM marketing_channels')
  if ((existing?.n ?? 0) > 0) return 0

  const wanted = SUGGESTED_CHANNELS.slice(0, Math.max(0, max))
  for (const channel of wanted) createChannel(db, channel)
  return wanted.length
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

interface PlanRow extends Row {
  audience: string
  quarterly_focus: string
  annual_budget: number
  updated_at: string
}

export function getPlan(db: Database): MarketingPlan {
  const row = db.get<PlanRow>('SELECT * FROM marketing_plan WHERE id = 1')

  return {
    audience: row?.audience ?? '',
    quarterlyFocus: row?.quarterly_focus ?? '',
    annualBudget: row?.annual_budget ?? 0,
    updatedAt: row?.updated_at ?? ''
  }
}

export function updatePlan(db: Database, patch: MarketingPlanInput): MarketingPlan {
  const map: Record<string, string> = {
    audience: 'audience',
    quarterlyFocus: 'quarterly_focus',
    annualBudget: 'annual_budget'
  }

  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = map[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE marketing_plan SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = 1`,
      values
    )
  }

  return getPlan(db)
}

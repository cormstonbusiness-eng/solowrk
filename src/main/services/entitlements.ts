import type { Database, Row } from '../db'
import {
  LIMITS,
  isUnlimited,
  limitOf,
  can as tierCan,
  requiresFor,
  type Feature,
  type Limit,
  type Tier
} from '@shared/entitlements'
import { effectiveTier, trialStatus, type Licence, type Trial } from '@shared/licence'
import { LimitReachedError } from '@shared/limitError'
import { today } from '@shared/taxYear'
import { readConfig, updateConfig } from './config'
import { verifyLicence } from './licenceToken'
import { getState, setState, STATE_KEYS } from './appState'

/**
 * What this installation is entitled to, and how much of it is used.
 *
 * The counting half of `@shared/entitlements`, which holds the map but cannot
 * see the database. Everything that needs a number about the user's own data
 * comes through here, and everything that needs to know what a tier includes
 * asks the shared module — so there is still exactly one place a tier is
 * defined and exactly one place each thing is counted.
 *
 * **Nothing outside this file compares tiers.** §4.1 is blunt about why:
 * gating logic spread through modules is the likeliest source of a bug that
 * either gives a paid feature away or blocks somebody who paid, and both fail
 * silently.
 */

/* ------------------------------------------------------------------ *
 * Which tier
 * ------------------------------------------------------------------ */

export interface Entitlement {
  tier: Tier
  licence: Licence | null
  trial: Trial
  /** Whether this build still accepts updates (§3.5's perpetual fallback). */
  updates: boolean
}

/**
 * Record the first run, once.
 *
 * Kept in the config *and* in the workspace, and the older of the two wins.
 * The config lives in `userData`, so anchoring the trial to it alone would
 * mean deleting one file bought another fortnight of Pro; mirroring it into
 * the workspace makes that need two deletions in two places. Neither is
 * proof against a determined person, and neither is meant to be — a 14-day
 * trial is a marketing decision, not a security boundary.
 */
async function installedAt(db: Database | null): Promise<string> {
  const config = await readConfig()
  const mirrored = db ? getState(db, STATE_KEYS.installedAt) : null

  // Oldest wins, so restoring an old workspace cannot extend a trial either.
  const known = [config.installedAt, mirrored].filter((one): one is string => Boolean(one)).sort()
  const anchor = known[0] ?? new Date().toISOString()

  if (config.installedAt !== anchor) await updateConfig({ installedAt: anchor })
  if (db && mirrored !== anchor) setState(db, STATE_KEYS.installedAt, anchor)

  return anchor
}

/**
 * Everything about what this machine may do right now.
 *
 * Reads the config on every call. That is deliberate and cheap — the same
 * choice `hasFeature` already made — and it means a licence that arrives from
 * a background check takes effect on the very next IPC call rather than after
 * a restart.
 */
export async function entitlement(db: Database | null = null): Promise<Entitlement> {
  const config = await readConfig()
  const { licence } = verifyLicence(config.licenceToken)
  const anchor = await installedAt(db)

  return {
    tier: effectiveTier(licence, anchor),
    licence,
    trial: licence ? { active: false, daysLeft: 0, showCountdown: false } : trialStatus(anchor),
    // No licence at all still gets updates: a trial user and a Free user are
    // both people the product wants on the newest build. Only a lapsed
    // subscription turns this off, and only the server can say so.
    updates: licence?.updates ?? true
  }
}

/** The tier in force. */
export async function currentTier(db: Database | null = null): Promise<Tier> {
  return (await entitlement(db)).tier
}

/** Whether a feature is unlocked. The only question the IPC gate asks. */
export async function can(feature: Feature, db: Database | null = null): Promise<boolean> {
  return tierCan(await currentTier(db), feature)
}

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

function count(db: Database, sql: string, params: (string | number)[] = []): number {
  return db.get<Row & { n: number }>(sql, params)?.n ?? 0
}

/**
 * One query per limit, respecting how each table says "gone".
 *
 * These differ per table and must not be guessed at. Clients and projects
 * carry an `archived` flag; goals use a status enum instead; invoices have
 * neither, deliberately, because an invoice already has a status and a second
 * axis would mean two answers to where it went. A trashed row is not here at
 * all — `trashEntity` removes it from its own table and keeps a payload for
 * restore — which is the correct behaviour for a limit: something in the bin
 * should not count against the three you are allowed.
 */
const COUNTS: Record<Limit, (db: Database) => number> = {
  clients: (db) => count(db, 'SELECT COUNT(*) AS n FROM clients WHERE archived = 0'),

  projects: (db) => count(db, 'SELECT COUNT(*) AS n FROM projects WHERE archived = 0'),

  // The calendar month the user is in, not a rolling window: "3 a month" has
  // to mean something a person can predict, and a rolling 30 days does not.
  invoicesPerMonth: (db) =>
    count(db, 'SELECT COUNT(*) AS n FROM invoices WHERE substr(issue_date, 1, 7) = ?', [
      today().slice(0, 7)
    ]),

  goals: (db) => count(db, "SELECT COUNT(*) AS n FROM goals WHERE status != 'archived'"),

  activeTimers: (db) => count(db, 'SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL'),

  /**
   * `created_at` is written as `datetime('now')`, which is UTC to the second,
   * so the first seven characters are the month.
   *
   * Deleting a conversation cascades and would take its messages — and so a
   * month's usage — with it. That is accepted: the cap exists to shape a
   * Free user towards upgrading, not to withstand somebody who has worked out
   * they can reset it by clearing their chat history.
   */
  assistantMessages: (db) =>
    count(
      db,
      "SELECT COUNT(*) AS n FROM ai_messages WHERE role = 'user' AND substr(created_at, 1, 7) = ?",
      [today().slice(0, 7)]
    ),

  /**
   * Active channels only. Retiring one gives the allowance back, which is the
   * honest reading of a cap on how many you are running — a channel you have
   * stopped posting to is not one of the three.
   */
  channels: (db) => count(db, 'SELECT COUNT(*) AS n FROM marketing_channels WHERE is_active = 1'),

  /**
   * Campaigns still in play. Complete and abandoned ones are history rather
   * than work, and a cap that counted them would eventually refuse somebody
   * their fourth campaign because of three they finished last year.
   */
  campaigns: (db) =>
    count(
      db,
      `SELECT COUNT(*) AS n FROM marketing_campaigns
        WHERE archived = 0 AND is_template = 0 AND status IN ('planning','active')`
    ),

  /**
   * Counted in the config file rather than in a database, because a workspace
   * *is* a database — there is no single one to ask.
   *
   * Zero here, and the real count is supplied by `meters()` below. The
   * enforcement lives in `workspaces.ts` for the same reason: this function
   * only ever gets handed one workspace's connection.
   */
  workspaces: () => 0,

  // Counted by the licence server, which is the only thing that can see the
  // other computers. Nothing local can answer it, and answering zero here is
  // honest rather than a hole: the seat check happens at activation.
  devices: () => 0
}

export function usage(db: Database, limit: Limit): number {
  return COUNTS[limit](db)
}

/** How many more are allowed. `Infinity` on any paid tier. */
export async function remaining(db: Database, limit: Limit): Promise<number> {
  const cap = limitOf(await currentTier(db), limit)
  return isUnlimited(cap) ? cap : Math.max(0, cap - usage(db, limit))
}

export interface Meter {
  limit: Limit
  used: number
  /** `Infinity` when there is no cap. Does not survive JSON — see below. */
  cap: number
}

/**
 * Every limit at once, for the usage meters on Settings → Account (§4.4).
 *
 * `cap` is sent as `null` rather than `Infinity` when crossing IPC, because
 * `JSON.stringify(Infinity)` is `null` anyway and being explicit about it
 * beats discovering the coercion in the renderer.
 */
export async function meters(
  db: Database,
  workspaceCount?: number
): Promise<{ limit: Limit; used: number; cap: number | null }[]> {
  const tier = await currentTier(db)

  // Workspaces are the one thing not countable from a database connection, so
  // the caller supplies the number it already had to read from the config.
  return LIMITS.map((limit) => {
    const cap = limitOf(tier, limit)
    const used = limit === 'workspaces' ? (workspaceCount ?? 0) : usage(db, limit)
    return { limit, used, cap: isUnlimited(cap) ? null : cap }
  }).filter((meter) => meter.cap !== 0)
}

/* ------------------------------------------------------------------ *
 * Refusing
 * ------------------------------------------------------------------ */

/**
 * Refuse to create one more, if there is no room.
 *
 * Called at the top of every creation point, *before* any side effect —
 * `createClient` and `createProject` both make a folder before they insert a
 * row, so refusing late would leave one behind on disk with nothing pointing
 * at it.
 *
 * Throws rather than returning false so that forgetting to check the result is
 * impossible. §4.2 requires that the create action never silently fails, and a
 * boolean nobody read is exactly that failure.
 */
export async function requireCapacity(db: Database, limit: Limit): Promise<void> {
  const tier = await currentTier(db)
  const cap = limitOf(tier, limit)
  if (isUnlimited(cap)) return

  const used = usage(db, limit)
  if (used < cap) return

  throw new LimitReachedError({
    limit,
    used,
    cap,
    tier,
    needs: requiresFor(limit, used + 1)
  })
}

/**
 * Whether the user is already over a limit, for the downgrade notice (§4.3).
 *
 * Being over one is not an error and never hides anything — somebody who drops
 * to Free with forty clients keeps all forty, readable and editable. This is
 * only so the app can say so out loud rather than letting them discover it
 * when the next one is refused.
 */
export async function exceeded(db: Database): Promise<Meter[]> {
  const tier = await currentTier(db)

  return LIMITS.filter((limit) => limit !== 'devices')
    .map((limit) => ({ limit, used: usage(db, limit), cap: limitOf(tier, limit) }))
    .filter((meter) => !isUnlimited(meter.cap) && meter.used > meter.cap)
}
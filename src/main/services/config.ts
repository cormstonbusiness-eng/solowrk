import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { API_BASE } from '@shared/site'

/**
 * A pointer file in Electron's userData folder — the only SoloWrk state that lives
 * outside the workspace. It exists purely so the app knows where the workspace
 * is on next launch; everything else belongs to the workspace itself, which is
 * what makes a workspace portable between machines.
 */
export interface AppConfig {
  /** The one currently open. Always also present in `workspaces`. */
  workspacePath: string | null
  /**
   * Every workspace this installation knows about, most recently opened
   * first.
   *
   * A list rather than a single path because somebody can run more than one
   * business, and the two must not share a database — separate clients,
   * separate invoice numbering, separate everything. They share only the
   * licence, which belongs to the person rather than to the business.
   */
  workspaces: string[]
  lastBackupAt: string | null

  /**
   * The account server.
   *
   * Defaults to the real one, and that default is the whole point: an install
   * that never talks to a server can never be licensed, so a blank value here
   * used to mean every paying customer sat on Free until they found a text
   * box in Settings and typed a URL into it.
   *
   * `SOLOWRK_API_BASE` overrides it for development — pointing a dev build at
   * `http://localhost:3000/api` is how the whole purchase loop gets tested
   * before the domain resolves. It is still user-editable in Settings, which
   * is harmless now that a licence is a signed token rather than whatever a
   * server claims: a hostile server can hand out all the tokens it likes and
   * none of them verify.
   */
  apiBaseUrl: string
  /** Session token from signing in. Held here, never in the workspace. */
  authToken: string | null
  accountEmail: string | null
  accountName: string | null
  accountPlan: string | null
  /** What the plan unlocks, comma-separated. Null until a server says. */
  accountFeatures: string | null
  accountExpiresOn: string | null
  /**
   * Set when the server says the licence has lapsed, in its own words. Its
   * presence is what puts the app into read-only; clearing it restores writing.
   */
  lapsedReason: string | null
  /** When the licence was last confirmed, for the offline grace window. */
  verifiedAt: string | null
  /** Identifies this installation to the seat count. Generated once. */
  deviceId: string | null

  /* ---------------------------------------------------------------- *
   * Licensing (Pricing spec §3)
   * ---------------------------------------------------------------- */

  /**
   * The Ed25519-signed licence, verified offline against a key built into the
   * app. Unlike `authToken` this is not opaque — it *is* the entitlement, and
   * a token that does not verify is worth exactly nothing, which is what stops
   * a hand-edited file from granting Pro.
   */
  licenceToken: string | null
  /**
   * When this installation first ran, as the trial's anchor.
   *
   * Mirrored into the workspace's `app_state`, so deleting this file alone
   * does not hand out a second fortnight. A determined person can still reset
   * it; a 14-day trial is a marketing decision, not a security boundary.
   */
  installedAt: string | null
  /** Hashed motherboard serial and machine GUID. Never the MAC address (§8). */
  fingerprint: string | null
  /** Last successful licence check, for the 14-day grace window (§3.4). */
  lastValidatedAt: string | null
  /**
   * Set when Stripe reports a failed payment. Keeps the tier alive through the
   * retry window plus five days rather than downgrading somebody whose card
   * expired (§3.4).
   */
  paymentFailedAt: string | null
  /**
   * The day updates stopped, for a subscription that lapsed.
   *
   * Its presence *is* the perpetual fallback (§3.5): features carry on working
   * forever, and only the update feed refuses. Shown once, in About.
   */
  updatesEndedOn: string | null
  /** Founding licence position, 1–200. Stored as text; see `parseConfig`. */
  foundingNumber: string | null
  /** This account's own referral code, for the ring on Settings. */
  referralCode: string | null

  /**
   * The user's mail password, encrypted by the OS keychain.
   *
   * Here rather than in the workspace database on purpose. The workspace is a
   * folder of the user's own files, and that folder is very often inside
   * Dropbox or OneDrive — a mail password kept there is a mail password in
   * somebody else's datacentre. `safeStorage` also ties the ciphertext to this
   * Windows account, so it could not be decrypted elsewhere even if it were
   * synced, which means a second machine has to be told the password again.
   * That is the correct answer rather than an inconvenience.
   */
  smtpPassword: string | null
}


/**
 * Where the app looks for the account server unless told otherwise.
 *
 * `API_BASE` is the shipped answer and lives in `shared/site.ts` with the rest
 * of the domain, so a rename is one line there rather than a hunt. The env
 * override exists for development against a locally running website.
 */
function defaultApiBase(): string {
  return process.env.SOLOWRK_API_BASE?.trim() || API_BASE
}

const DEFAULT_CONFIG: AppConfig = {
  workspacePath: null,
  workspaces: [],
  lastBackupAt: null,
  apiBaseUrl: defaultApiBase(),
  authToken: null,
  accountEmail: null,
  accountName: null,
  accountPlan: null,
  accountFeatures: null,
  accountExpiresOn: null,
  lapsedReason: null,
  verifiedAt: null,
  deviceId: null,
  licenceToken: null,
  installedAt: null,
  fingerprint: null,
  lastValidatedAt: null,
  paymentFailedAt: null,
  updatesEndedOn: null,
  foundingNumber: null,
  referralCode: null,
  smtpPassword: null
}

const CONFIG_FILENAME = 'solo.config.json'

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

/**
 * Where the pointer lived when the app was still called Solo.
 *
 * `userData` is derived from the app name, so renaming to SoloWrk moved it and
 * would otherwise have looked like a first run to anyone already set up. Read
 * the old location once as a fallback; the next write lands in the new one.
 */
function legacyConfigPath(): string {
  return join(app.getPath('appData'), 'solo', CONFIG_FILENAME)
}

/**
 * Every field is read explicitly.
 *
 * That is deliberate — it means a hand-edited or truncated file cannot inject
 * anything unexpected. It also means **a new field added above without a line
 * here is silently dropped on the next write**, which is the one trap in this
 * file worth knowing about.
 *
 * `text()` is the only coercer, so every field is a non-empty string or null.
 * That is why `foundingNumber` is stored as text rather than as the number it
 * obviously is: one coercer that cannot disagree with itself is worth more
 * than the parse at the two places that read it. It also means an empty string
 * cannot round-trip — it comes back as null — so nothing should ever depend on
 * the difference between "" and unset.
 */
function parseConfig(raw: string): AppConfig {
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null

  /** A list of paths, deduplicated, with the current one guaranteed present. */
  const paths = (value: unknown, current: string | null): string[] => {
    const listed = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : []

    return [...new Set(current ? [current, ...listed] : listed)]
  }

  return {
    workspacePath: text(parsed.workspacePath),
    /*
      Older configs have no list at all, so the current path becomes it. A
      missing list must never read as "no workspaces" — that would present
      somebody who upgraded with an empty switcher and a first-run wizard.
    */
    workspaces: paths(parsed.workspaces, text(parsed.workspacePath)),
    lastBackupAt: text(parsed.lastBackupAt),
    /*
      Empty means "use the default", not "no server".

      I first wrote this to preserve an explicit empty string, on the reasoning
      that somebody may have deliberately cleared the field. That was wrong,
      and testing against a real install proved it: the old default *was* the
      empty string and it got written into every config file that has ever
      been saved, so "cleared on purpose" and "never set" are indistinguishable
      — and treating them as "no server" left every existing install unable to
      reach one. Which is the exact bug this default was added to fix.

      There is also no longer a legitimate reason to have no server. The app
      works offline through the signed licence and its grace window, so the
      field chooses *which* server rather than *whether*. `SOLOWRK_API_BASE`
      is the override for pointing a dev build somewhere else.
    */
    apiBaseUrl: text(parsed.apiBaseUrl) ?? defaultApiBase(),
    authToken: text(parsed.authToken),
    accountEmail: text(parsed.accountEmail),
    accountName: text(parsed.accountName),
    accountPlan: text(parsed.accountPlan),
    accountFeatures: text(parsed.accountFeatures),
    accountExpiresOn: text(parsed.accountExpiresOn),
    lapsedReason: text(parsed.lapsedReason),
    verifiedAt: text(parsed.verifiedAt),
    deviceId: text(parsed.deviceId),
    licenceToken: text(parsed.licenceToken),
    installedAt: text(parsed.installedAt),
    fingerprint: text(parsed.fingerprint),
    lastValidatedAt: text(parsed.lastValidatedAt),
    paymentFailedAt: text(parsed.paymentFailedAt),
    updatesEndedOn: text(parsed.updatesEndedOn),
    foundingNumber: text(parsed.foundingNumber),
    referralCode: text(parsed.referralCode),
    smtpPassword: text(parsed.smtpPassword)
  }
}

/**
 * Whether to consult the pre-rename pointer.
 *
 * `SOLOWRK_FRESH=1` says no, which is the only honest way to see what a new
 * customer sees. Electron's `--user-data-dir` moves `userData` but not
 * `appData`, so the legacy path survives it and a developer machine keeps
 * finding its own workspace however clean the sandbox is — the first-run
 * wizard and the splash before it then cannot be reached at all without
 * moving files a real install would have.
 *
 * Development only, and it reads rather than writes: a run with this set
 * still saves to the ordinary location, so nothing here can strand a real
 * install on a config it cannot find.
 */
function usesLegacyConfig(): boolean {
  return process.env.SOLOWRK_FRESH !== '1'
}

export async function readConfig(): Promise<AppConfig> {
  const locations = usesLegacyConfig() ? [configPath(), legacyConfigPath()] : [configPath()]

  for (const path of locations) {
    try {
      return parseConfig(await readFile(path, 'utf8'))
    } catch {
      // Missing or corrupt — try the next location.
    }
  }
  // Neither exists: treat as a first run rather than failing to start.
  return { ...DEFAULT_CONFIG }
}

/**
 * Written to a temporary file and renamed over the real one.
 *
 * A plain write truncates before it fills, so a crash or a power cut in that
 * window leaves an empty file — and `readConfig` swallows the parse failure
 * and returns `DEFAULT_CONFIG`, which silently forgets the workspace, signs
 * the user out and, now that a tier lives in here, drops them to Free. Rename
 * is atomic on NTFS and replaces the target, so a reader sees the old file or
 * the new one and never a half of either.
 */
export async function writeConfig(config: AppConfig): Promise<void> {
  const target = configPath()

  /*
    A name no other write can be using.

    This used to be a fixed `.tmp`, and two writes landing together — which is
    ordinary at startup, where the device id and the restored session are both
    saved — would share the file. One rename moved it to the target and the
    other then found nothing there and threw ENOENT.

    That failure surfaced as `auth:state` rejecting, the renderer taking its
    "unreadable config" fallback, and licensing being silently off for the
    whole session. On a first install, where both writes always happen, it was
    the common case rather than a rare race.
  */
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`

  await writeFile(temporary, JSON.stringify(config, null, 2), 'utf8')
  await replace(temporary, target)
}

/**
 * Windows conditions under which a rename is worth trying again.
 *
 * All three mean "somebody else has a handle on this file right now" rather
 * than "this cannot work". A virus scanner opening the temporary file the
 * instant it is written is the common one, and it holds it for milliseconds.
 */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Long enough for a scanner to let go, short enough not to be a freeze. */
const RETRY_DELAYS_MS = [10, 30, 90, 250]

/**
 * Rename, with a few goes at it.
 *
 * `rename` is atomic on NTFS, which is the whole reason the write goes
 * through a temporary file — but atomic is not the same as always permitted.
 * On Windows it fails with EPERM whenever anything else holds a handle to
 * either path, and something usually does: Defender scans a file the moment
 * it is created, and OneDrive and Search Indexer both watch the folders this
 * config lives in.
 *
 * Without this, that transient collision surfaced as a failed save. Given
 * what the config holds — the workspace path and the licence — a lost write
 * signs the user out and drops them to Free, which is a terrible outcome for
 * a fraction of a second of file locking. It showed up as an intermittent
 * test failure first, which is the only reason it was found before somebody
 * hit it for real.
 */
async function replace(temporary: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, target)
      return
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code ?? ''

      // Out of attempts, or a failure that retrying cannot fix — a bad path,
      // a full disk, a read-only volume.
      if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT.has(code)) throw cause

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = { ...(await readConfig()), ...patch }
  await writeConfig(next)
  return next
}

/** Where we suggest putting the workspace when the user has no preference. */
export function suggestedWorkspacePath(): string {
  return join(app.getPath('documents'), 'SoloWrk')
}
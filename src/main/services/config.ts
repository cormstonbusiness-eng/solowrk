import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * A pointer file in Electron's userData folder — the only SoloWrk state that lives
 * outside the workspace. It exists purely so the app knows where the workspace
 * is on next launch; everything else belongs to the workspace itself, which is
 * what makes a workspace portable between machines.
 */
export interface AppConfig {
  workspacePath: string | null
  lastBackupAt: string | null

  /**
   * The account server. Empty means there is not one, and the app runs
   * ungated — which is how it behaves until a licence backend exists.
   */
  apiBaseUrl: string
  /** Session token from signing in. Held here, never in the workspace. */
  authToken: string | null
  accountEmail: string | null
  accountName: string | null
  accountPlan: string | null
  accountExpiresOn: string | null
  /** When the licence was last confirmed, for the offline grace window. */
  verifiedAt: string | null
  /** Identifies this installation to the seat count. Generated once. */
  deviceId: string | null
}

const DEFAULT_CONFIG: AppConfig = {
  workspacePath: null,
  lastBackupAt: null,
  apiBaseUrl: '',
  authToken: null,
  accountEmail: null,
  accountName: null,
  accountPlan: null,
  accountExpiresOn: null,
  verifiedAt: null,
  deviceId: null
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
 */
function parseConfig(raw: string): AppConfig {
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null

  return {
    workspacePath: text(parsed.workspacePath),
    lastBackupAt: text(parsed.lastBackupAt),
    apiBaseUrl: text(parsed.apiBaseUrl) ?? '',
    authToken: text(parsed.authToken),
    accountEmail: text(parsed.accountEmail),
    accountName: text(parsed.accountName),
    accountPlan: text(parsed.accountPlan),
    accountExpiresOn: text(parsed.accountExpiresOn),
    verifiedAt: text(parsed.verifiedAt),
    deviceId: text(parsed.deviceId)
  }
}

export async function readConfig(): Promise<AppConfig> {
  for (const path of [configPath(), legacyConfigPath()]) {
    try {
      return parseConfig(await readFile(path, 'utf8'))
    } catch {
      // Missing or corrupt — try the next location.
    }
  }
  // Neither exists: treat as a first run rather than failing to start.
  return { ...DEFAULT_CONFIG }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
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
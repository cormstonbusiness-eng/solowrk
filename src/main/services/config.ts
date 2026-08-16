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
}

const DEFAULT_CONFIG: AppConfig = { workspacePath: null, lastBackupAt: null }

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

function parseConfig(raw: string): AppConfig {
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  return {
    workspacePath:
      typeof parsed.workspacePath === 'string' && parsed.workspacePath.length > 0
        ? parsed.workspacePath
        : null,
    lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null
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
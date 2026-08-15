import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * A pointer file in Electron's userData folder — the only Solo state that lives
 * outside the workspace. It exists purely so the app knows where the workspace
 * is on next launch; everything else belongs to the workspace itself, which is
 * what makes a workspace portable between machines.
 */
export interface AppConfig {
  workspacePath: string | null
  lastBackupAt: string | null
}

const DEFAULT_CONFIG: AppConfig = { workspacePath: null, lastBackupAt: null }

function configPath(): string {
  return join(app.getPath('userData'), 'solo.config.json')
}

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      workspacePath:
        typeof parsed.workspacePath === 'string' && parsed.workspacePath.length > 0
          ? parsed.workspacePath
          : null,
      lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null
    }
  } catch {
    // Missing or corrupt — treat as a first run rather than failing to start.
    return { ...DEFAULT_CONFIG }
  }
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
  return join(app.getPath('documents'), 'Solo')
}
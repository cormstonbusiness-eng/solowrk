import { Database } from '../db'
import type { Settings, WorkspaceSetup, WorkspaceStatus } from '@shared/types'
import { readConfig, suggestedWorkspacePath, updateConfig } from './config'
import { backupDatabase, backupIsDue } from './backup'
import { databasePath, isWorkspace, scaffoldWorkspace } from './workspace'
import { getSettings, updateSettings } from './settings'

/**
 * Owns the currently open workspace: its path and its database connection.
 *
 * Only one workspace is open at a time. Everything that needs the database goes
 * through `requireDb()`, which throws rather than returning null — a feature
 * reachable before setup is a bug, and this makes it loud instead of silent.
 */
class Session {
  private db: Database | null = null
  private workspacePath: string | null = null

  get path(): string | null {
    return this.workspacePath
  }

  get isOpen(): boolean {
    return this.db !== null
  }

  requireDb(): Database {
    if (!this.db) throw new Error('No workspace is open')
    return this.db
  }

  requirePath(): string {
    if (!this.workspacePath) throw new Error('No workspace is open')
    return this.workspacePath
  }

  /** Restore the workspace recorded on the last run, if it is still there. */
  async restore(): Promise<WorkspaceStatus> {
    const config = await readConfig()

    if (!config.workspacePath) {
      return { state: 'unconfigured', suggestedPath: suggestedWorkspacePath() }
    }

    if (!(await isWorkspace(config.workspacePath))) {
      // The folder was moved, renamed, or sat on a drive that isn't mounted.
      return {
        state: 'missing',
        path: config.workspacePath,
        suggestedPath: suggestedWorkspacePath()
      }
    }

    await this.open(config.workspacePath)
    return { state: 'ready', path: config.workspacePath }
  }

  /** Create the folder tree and database, then open it. */
  async create(setup: WorkspaceSetup): Promise<WorkspaceStatus> {
    await scaffoldWorkspace(setup.path)
    await this.open(setup.path)

    updateSettings(this.requireDb(), {
      ...setup.business,
      // A UK sole trader is the default shape; both are editable in Settings.
      country: 'United Kingdom',
      currency: 'GBP'
    })

    return { state: 'ready', path: setup.path }
  }

  /** Adopt an existing workspace folder — used when re-pointing after a move. */
  async adopt(path: string): Promise<WorkspaceStatus> {
    if (!(await isWorkspace(path))) {
      throw new Error('That folder does not contain a Solo workspace')
    }
    await this.open(path)
    return { state: 'ready', path }
  }

  private async open(path: string): Promise<void> {
    this.close()
    this.db = new Database(databasePath(path))
    this.workspacePath = path
    await updateConfig({ workspacePath: path })
    await this.runDailyBackup()
  }

  /**
   * Backups are best-effort: a full disk or a locked file should never stop the
   * app from opening, so a failure is logged and swallowed.
   */
  private async runDailyBackup(): Promise<void> {
    try {
      const config = await readConfig()
      if (!backupIsDue(config.lastBackupAt)) return
      await backupDatabase(this.requireDb(), this.requirePath())
      await updateConfig({ lastBackupAt: new Date().toISOString() })
    } catch (error) {
      console.error('Daily backup failed:', error)
    }
  }

  settings(): Settings {
    return getSettings(this.requireDb())
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.workspacePath = null
  }
}

export const session = new Session()
import { Database } from '../db'
import type { Settings, WorkspaceSetup, WorkspaceStatus } from '@shared/types'
import { readConfig, suggestedWorkspacePath, updateConfig } from './config'
import { backupDatabase, backupIsDue } from './backup'
import { databasePath, isWorkspace, scaffoldWorkspace } from './workspace'
import { getSettings, updateSettings } from './settings'
import { seedStarterTemplates } from './docTemplates'
import { migrateLeadsToClients } from './leadMigration'
import { runRecurringInvoices } from './invoices'
import { drainOutbox } from './chaseRun'

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

  /**
   * The database if there is one, for callers that must work before setup.
   *
   * The IPC gate is the reason this exists: it runs on every channel including
   * the handful that fire before a workspace is open, and asking what tier the
   * user is on must not throw on the way to the first-run wizard.
   */
  dbOrNull(): Database | null {
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
    // `open` scaffolds too, so creation is just opening a path that is not
    // there yet — one code path builds the tree rather than two.
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
      throw new Error('That folder does not contain a SoloWrk workspace')
    }
    await this.open(path)
    return { state: 'ready', path }
  }

  private async open(path: string): Promise<void> {
    this.close()

    // Re-scaffold on every open, not only on create. Every mkdir is recursive
    // so this is idempotent and costs a few filesystem calls — and without it a
    // folder added to WORKSPACE_TREE by a later phase never reaches a workspace
    // that already exists. It also heals a tree the user has deleted from.
    await scaffoldWorkspace(path)

    this.db = new Database(databasePath(path))
    this.workspacePath = path
    await updateConfig({ workspacePath: path })
    await this.runDailyBackup()
    this.seedTemplates()
    // Before the retainers, so a lead won while the app was closed is a client
    // by the time anything tries to invoice it.
    await this.moveLeads()
    this.issueDueRetainers()
    this.sendWhatIsWaiting()
  }

  /**
   * Put the shipped document templates in, if they are not already there.
   *
   * Runs on every open so a template added in a later release appears without
   * anybody running anything, and never overwrites one the user has edited.
   * A failure must not stop the workspace opening — a missing starter template
   * is an inconvenience, a workspace that will not open is not.
   */
  private seedTemplates(): void {
    try {
      const added = seedStarterTemplates(this.requireDb())
      if (added > 0) console.log(`Added ${added} starter document template(s)`)
    } catch (error) {
      console.error('Seeding document templates failed:', error)
    }
  }

  /**
   * Move any leads still sitting in the old Marketing pipeline into Clients.
   *
   * Runs on every open and does nothing once they have all moved. Marketing
   * was built as a lead tracker, which is a sales function; the pipeline lives
   * in Clients now so that a person exists in one place rather than two.
   *
   * Here rather than in a migration because a client owns a folder on disk and
   * SQL cannot make one. A failure must not stop the workspace opening — an
   * unconverted lead is an inconvenience and the next open tries again.
   */
  private async moveLeads(): Promise<void> {
    try {
      const moved = await migrateLeadsToClients(this.requireDb(), this.requirePath())
      if (moved > 0) console.log(`Moved ${moved} lead(s) into Clients`)
    } catch (error) {
      console.error('Moving leads into Clients failed:', error)
    }
  }

  /**
   * Generate any retainer invoices that have come due while the app was closed.
   *
   * They arrive as drafts, never sent — the point is that the freelancer does
   * not have to remember, not that invoices leave without being seen. A failure
   * here must not stop the workspace opening.
   */
  private issueDueRetainers(): void {
    try {
      const created = runRecurringInvoices(this.requireDb())
      if (created.length > 0) {
        console.log(`Issued ${created.length} recurring invoice draft(s)`)
      }
    } catch (error) {
      console.error('Recurring invoices failed:', error)
    }
  }

  /**
   * Try the outbox again.
   *
   * The queue exists because the moment the app decides to send is very often
   * not a moment it can — the sweep runs at nine and the laptop is shut at
   * nine, or open with no wifi. This is the other half of that: whatever is
   * still waiting gets another go the next time the app is opened.
   *
   * Nothing new is drafted here, and nothing is sent that was not already
   * approved or set to send automatically. Opening the app is not consent.
   *
   * Fire-and-forget, with its own catch: a mail server that is slow to answer
   * must not hold up a workspace opening, and one that refuses must not stop
   * it opening at all.
   */
  private sendWhatIsWaiting(): void {
    void drainOutbox(this.requireDb()).catch((error) => {
      console.error('Outbox drain failed:', error)
    })
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
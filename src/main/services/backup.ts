import { copyFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database } from '../db'
import { APP_DIR, databasePath } from './workspace'

const RETENTION_DAYS = 14
const PREFIX = 'solo-'
const SUFFIX = '.db'

function backupsDir(workspacePath: string): string {
  return join(workspacePath, APP_DIR, 'backups')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Copy the database into `_app/backups` once a day, keeping a rolling fortnight.
 *
 * The checkpoint first is the important part: in WAL mode recent writes may
 * still be sitting in the -wal file, so copying solo.db alone can produce a
 * backup that silently misses the last session's work.
 */
export async function backupDatabase(db: Database, workspacePath: string): Promise<string> {
  db.checkpoint()

  const destination = join(backupsDir(workspacePath), `${PREFIX}${today()}${SUFFIX}`)
  await copyFile(databasePath(workspacePath), destination)
  await pruneOldBackups(workspacePath)
  return destination
}

/** True when the last backup was on an earlier day than today. */
export function backupIsDue(lastBackupAt: string | null): boolean {
  if (!lastBackupAt) return true
  return lastBackupAt.slice(0, 10) < today()
}

async function pruneOldBackups(workspacePath: string): Promise<void> {
  const dir = backupsDir(workspacePath)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.startsWith(PREFIX) || !entry.endsWith(SUFFIX)) continue
    const date = entry.slice(PREFIX.length, entry.length - SUFFIX.length)
    if (date < cutoff) {
      await rm(join(dir, entry), { force: true })
    }
  }
}
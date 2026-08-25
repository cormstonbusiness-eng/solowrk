import { copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'

/** The value types SQLite can store and return. */
export type SqlValue = null | number | bigint | string | Uint8Array

/**
 * SQLite comes from Electron's bundled Node (`node:sqlite`) rather than a native
 * module, so the app has no compiled dependencies: `npm install` works on any
 * machine and the installer carries no ABI-specific binaries.
 *
 * Access is synchronous and confined to the main process. The renderer reaches
 * it only through declared IPC channels.
 */

export type Row = Record<string, SqlValue>
export type Params = SqlValue[]

export class Database {
  private readonly db: DatabaseSync
  /** Nesting level, so `transaction()` can compose — see below. */
  private transactionDepth = 0

  constructor(public readonly file: string) {
    this.db = new DatabaseSync(file)
    // WAL keeps reads fast while a write is in flight; FKs are off by default
    // in SQLite and we rely on them for cascade deletes from phase 2 onward.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.migrate()
  }

  all<T extends Row>(sql: string, params: Params = []): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  get<T extends Row>(sql: string, params: Params = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  run(sql: string, params: Params = []): void {
    this.db.prepare(sql).run(...params)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  /**
   * Run `fn` in a transaction, rolling back if it throws.
   *
   * Re-entrant. SQLite has no nested BEGIN, but services compose freely —
   * `createInvoice` wraps its work in a transaction and calls
   * `claimInvoiceNumber`, which needs one of its own. Nested calls use a
   * SAVEPOINT, so an inner failure rolls back only its own work and the
   * outermost call still decides whether the whole thing commits.
   */
  transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth
    const savepoint = `solo_sp_${depth}`

    if (depth === 0) this.db.exec('BEGIN')
    else this.db.exec(`SAVEPOINT ${savepoint}`)

    this.transactionDepth = depth + 1

    try {
      const result = fn()
      this.transactionDepth = depth
      if (depth === 0) this.db.exec('COMMIT')
      else this.db.exec(`RELEASE ${savepoint}`)
      return result
    } catch (error) {
      this.transactionDepth = depth
      if (depth === 0) {
        this.db.exec('ROLLBACK')
      } else {
        this.db.exec(`ROLLBACK TO ${savepoint}`)
        this.db.exec(`RELEASE ${savepoint}`)
      }
      throw error
    }
  }

  /**
   * Fold the write-ahead log back into the main database file. Required before
   * copying the file for a backup, or the copy misses recent writes.
   */
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  close(): void {
    this.db.close()
  }

  /**
   * Apply any migrations this database has not seen. Each runs inside its own
   * transaction, so a failure leaves the database at the last good version
   * rather than half-migrated.
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)

    const applied = new Set(
      this.all<{ id: number }>('SELECT id FROM _migrations').map((row) => row.id)
    )

    const pending = migrations.filter((migration) => !applied.has(migration.id))
    if (pending.length === 0) return

    this.snapshotBeforeMigrating(applied)

    for (const migration of pending) {
      this.transaction(() => {
        this.db.exec(migration.sql)
        this.run('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, datetime(\'now\'))', [
          migration.id,
          migration.name
        ])
      })
    }
  }

  /**
   * Copy the database aside before changing its shape.
   *
   * Each migration runs in a transaction, so one that *throws* rolls itself
   * back. This guards the other case: one that succeeds and is wrong. A
   * rebuild that drops and recreates a table cannot be undone by a rollback
   * that already committed.
   *
   * The rolling daily backup is not cover for this. It runs after the database
   * is opened — so after migrations — and only once a day, which means on the
   * morning of an update it has very often already run against the new shape.
   *
   * Synchronous, because migrations happen in the constructor and there is
   * nowhere to await. That is the whole reason this is not a call to
   * `backupDatabase`.
   *
   * A failure here stops the migration. Refusing to open until there is disk
   * space is an annoyance somebody can act on; migrating irreversibly with no
   * copy is not.
   */
  private snapshotBeforeMigrating(applied: Set<number>): void {
    // Nothing applied means nothing to lose — a brand-new workspace, or an
    // empty file. Copying it would only litter.
    if (applied.size === 0) return
    if (this.file === ':memory:') return

    const from = Math.max(...applied)
    const name = basename(this.file).replace(/[.]db$/, '')
    const destination = join(dirname(this.file), `${name}.before-v${from}.db`)

    try {
      // In WAL mode the recent writes sit in the -wal file, so copying the .db
      // alone can silently miss the last session's work. Same trap the daily
      // backup documents.
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      copyFileSync(this.file, destination)
    } catch (cause) {
      throw new Error(
        'SoloWrk needs to update how it stores your data, and could not take a backup first ' +
          `(${cause instanceof Error ? cause.message : String(cause)}). ` +
          'Nothing has been changed. Free some disk space and reopen SoloWrk.',
        { cause }
      )
    }
  }
}
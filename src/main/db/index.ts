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

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue
      this.transaction(() => {
        this.db.exec(migration.sql)
        this.run('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, datetime(\'now\'))', [
          migration.id,
          migration.name
        ])
      })
    }
  }
}
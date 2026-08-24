import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from './index'
import { migrations } from './migrations'
import { getSettings, updateSettings } from '../services/settings'

describe('Database', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('applies every migration on a fresh database', () => {
    const applied = db.all<{ id: number }>('SELECT id FROM _migrations ORDER BY id')
    expect(applied.map((row) => row.id)).toEqual(migrations.map((m) => m.id))
  })

  it('seeds exactly one settings row with UK defaults', () => {
    const settings = getSettings(db)
    expect(settings.currency).toBe('GBP')
    expect(settings.vatRate).toBe(2000)
    expect(settings.taxYearStartDay).toBe(6)
    expect(settings.taxYearStartMonth).toBe(4)
    expect(db.all('SELECT id FROM settings')).toHaveLength(1)
  })

  it('refuses a second settings row', () => {
    expect(() =>
      db.run("INSERT INTO settings (id, created_at, updated_at) VALUES (2, '', '')")
    ).toThrow()
  })

  it('round-trips a settings update, converting booleans', () => {
    const updated = updateSettings(db, {
      businessName: 'Acme Design',
      vatRegistered: true,
      vatNumber: 'GB123456789',
      defaultHourlyRate: 6500
    })

    expect(updated.businessName).toBe('Acme Design')
    expect(updated.vatRegistered).toBe(true)
    expect(updated.defaultHourlyRate).toBe(6500)
    // Re-read from disk rather than trusting the returned object.
    expect(getSettings(db).vatNumber).toBe('GB123456789')
  })

  it('ignores unknown keys in a settings patch', () => {
    const before = getSettings(db)
    const after = updateSettings(db, { nonsense: 'DROP TABLE settings' } as never)
    expect(after.businessName).toBe(before.businessName)
  })

  it('supports nested transactions via savepoints', () => {
    // Services compose: createInvoice opens a transaction and calls
    // claimInvoiceNumber, which opens one of its own.
    db.transaction(() => {
      updateSettings(db, { businessName: 'Outer' })
      db.transaction(() => updateSettings(db, { contactName: 'Inner' }))
    })

    expect(getSettings(db).businessName).toBe('Outer')
    expect(getSettings(db).contactName).toBe('Inner')
  })

  it('rolls the whole nested transaction back when the outer one fails', () => {
    updateSettings(db, { businessName: 'Before' })

    expect(() =>
      db.transaction(() => {
        db.transaction(() => updateSettings(db, { businessName: 'Inner' }))
        throw new Error('outer failure')
      })
    ).toThrow('outer failure')

    expect(getSettings(db).businessName).toBe('Before')
  })

  it('lets the outer transaction survive a caught inner failure', () => {
    db.transaction(() => {
      updateSettings(db, { businessName: 'Kept' })
      try {
        db.transaction(() => {
          updateSettings(db, { contactName: 'Discarded' })
          throw new Error('inner failure')
        })
      } catch {
        // Swallowed on purpose: the outer work should still commit.
      }
    })

    expect(getSettings(db).businessName).toBe('Kept')
    expect(getSettings(db).contactName).toBe('')
  })

  it('rolls a failed transaction back', () => {
    updateSettings(db, { businessName: 'Before' })
    expect(() =>
      db.transaction(() => {
        updateSettings(db, { businessName: 'After' })
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(getSettings(db).businessName).toBe('Before')
  })

  it('gives every install the chase columns and sensible defaults', () => {
    // Migration 15 adds columns to two tables that already hold data on every
    // existing install. A migration that only works on a fresh database is the
    // kind that breaks on upgrade and nowhere else.
    const settings = getSettings(db)
    expect(settings.chaseEnabled).toBe(false)
    expect(settings.chaseDays).toBe('7,14,30')

    const columns = db
      .all<{ name: string }>('PRAGMA table_info(invoices)')
      .map((row) => row.name)
    expect(columns).toContain('chase_step')
    expect(columns).toContain('last_chased_at')
  })

  it('starts every invoice unchased', () => {
    // The default has to be 0 rather than null: the sweep compares against it,
    // and null would make every comparison false and chase nobody, silently.
    const row = db.all<{ dflt_value: string | null; name: string }>(
      'PRAGMA table_info(invoices)'
    )
    expect(row.find((column) => column.name === 'chase_step')?.dflt_value).toBe('0')
  })

  it('never turns chasing on by itself', () => {
    // The one setting here that reaches somebody else's inbox.
    const row = db.all<{ dflt_value: string | null; name: string }>(
      'PRAGMA table_info(settings)'
    )
    expect(row.find((column) => column.name === 'chase_enabled')?.dflt_value).toBe('0')
  })
})

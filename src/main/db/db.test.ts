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
})
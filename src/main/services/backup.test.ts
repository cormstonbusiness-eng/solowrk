import { describe, expect, it } from 'vitest'
import { backupIsDue } from './backup'

describe('backupIsDue', () => {
  const todayIso = new Date().toISOString()
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString()

  it('is due when no backup has ever run', () => {
    expect(backupIsDue(null)).toBe(true)
  })

  it('is due when the last backup was on an earlier day', () => {
    expect(backupIsDue(yesterdayIso)).toBe(true)
    expect(backupIsDue('2020-01-01T23:59:59.000Z')).toBe(true)
  })

  it('is not due again on the same day', () => {
    expect(backupIsDue(todayIso)).toBe(false)
  })

  it('compares by calendar day, not elapsed hours', () => {
    // A backup at 23:50 should still trigger one the next morning, ten minutes
    // later — an elapsed-time check would wait a full 24 hours.
    const lateYesterday = `${yesterdayIso.slice(0, 10)}T23:50:00.000Z`
    expect(backupIsDue(lateYesterday)).toBe(true)
  })
})
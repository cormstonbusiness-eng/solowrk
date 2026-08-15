import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { getState, setState } from './appState'

describe('app state', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('returns null for a key that was never set', () => {
    expect(getState(db, 'tour.completed')).toBeNull()
  })

  it('stores and reads a value back', () => {
    setState(db, 'tour.completed', '1')
    expect(getState(db, 'tour.completed')).toBe('1')
  })

  it('overwrites rather than duplicating on a repeat set', () => {
    setState(db, 'tour.completed', '1')
    setState(db, 'tour.completed', '0')
    expect(getState(db, 'tour.completed')).toBe('0')
    expect(db.all('SELECT key FROM app_state')).toHaveLength(1)
  })

  it('keeps keys independent', () => {
    setState(db, 'a', 'one')
    setState(db, 'b', 'two')
    expect(getState(db, 'a')).toBe('one')
    expect(getState(db, 'b')).toBe('two')
  })
})
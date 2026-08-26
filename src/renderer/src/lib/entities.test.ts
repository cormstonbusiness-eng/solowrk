import { describe, expect, it } from 'vitest'
import { refFromParam, refToParam } from './entities'

/**
 * Which record the drawer is showing, as it travels through the URL.
 *
 * The parameter is whatever was in the address bar — a stale bookmark, a
 * notification written by an older version, a typo — so the only behaviour
 * that really matters here is that nothing unrecognised gets through as a ref.
 * A bad parse must close the drawer, not take the page down with it.
 */

describe('a ref in a URL', () => {
  it('survives the round trip', () => {
    expect(refFromParam(refToParam({ type: 'invoice', id: 12 }))).toEqual({
      type: 'invoice',
      id: 12
    })
  })

  it('refuses a type this build has never heard of', () => {
    expect(refFromParam('spaceship:3')).toBeNull()
  })

  it('refuses an id that is not one', () => {
    expect(refFromParam('client:abc')).toBeNull()
    expect(refFromParam('client:1.5')).toBeNull()
    expect(refFromParam('client:0')).toBeNull()
    expect(refFromParam('client:-2')).toBeNull()
  })

  it('refuses a half-written parameter', () => {
    expect(refFromParam('client')).toBeNull()
    expect(refFromParam('client:')).toBeNull()
    expect(refFromParam(':4')).toBeNull()
    expect(refFromParam('')).toBeNull()
  })

  it('is null when there is no parameter at all', () => {
    // The ordinary case: no drawer open.
    expect(refFromParam(null)).toBeNull()
  })
})

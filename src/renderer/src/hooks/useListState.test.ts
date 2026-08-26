import { describe, expect, it } from 'vitest'
import { filtersOnly } from './useListState'

/**
 * What travels in a saved view.
 *
 * The list's filters live in the URL beside two things that are not filters,
 * and the difference matters exactly once: at the moment somebody saves a
 * view. A view that carried `open` would reopen the drawer on whatever record
 * happened to be selected three weeks ago — or on one since deleted.
 */

describe('the filters, and nothing else', () => {
  it('keeps a filter', () => {
    expect(filtersOnly(new URLSearchParams('status=overdue&q=acme')).toString()).toBe(
      'status=overdue&q=acme'
    )
  })

  it('keeps every value of a filter chosen more than once', () => {
    // Chips are multi-select, so one key legitimately appears several times.
    expect(filtersOnly(new URLSearchParams('status=draft&status=sent')).getAll('status')).toEqual([
      'draft',
      'sent'
    ])
  })

  it('drops whichever record the drawer is showing', () => {
    expect(filtersOnly(new URLSearchParams('status=overdue&open=invoice:12')).toString()).toBe(
      'status=overdue'
    )
  })

  it('drops the one-shot instructions other screens send', () => {
    expect(filtersOnly(new URLSearchParams('new=1&client=4&q=acme')).toString()).toBe('q=acme')
  })

  it('is empty when nothing is filtered', () => {
    expect(filtersOnly(new URLSearchParams('open=client:1')).toString()).toBe('')
  })
})

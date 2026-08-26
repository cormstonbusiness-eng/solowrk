import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import { deleteView, listViews, saveView, viewExists } from './views'

/**
 * Saved views.
 *
 * The filter state is an opaque query string here on purpose, so almost
 * nothing in this service can be wrong about what a filter *is*. What is left
 * to get wrong is the naming: saving twice under one name must replace rather
 * than accumulate, and one list's views must not appear on another.
 */

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

describe('saving a view', () => {
  it('keeps the filters exactly as the page wrote them', () => {
    saveView(db, 'invoices', 'Overdue', 'status=overdue&q=acme')

    expect(listViews(db, 'invoices')[0]).toMatchObject({
      name: 'Overdue',
      query: 'status=overdue&q=acme'
    })
  })

  it('replaces rather than making a second one with the same name', () => {
    // "I have adjusted this, save it again" is the commonest thing anybody
    // does with a saved filter.
    saveView(db, 'invoices', 'Overdue', 'status=overdue')
    saveView(db, 'invoices', 'Overdue', 'status=overdue&q=acme')

    const views = listViews(db, 'invoices')
    expect(views).toHaveLength(1)
    expect(views[0]!.query).toBe('status=overdue&q=acme')
  })

  it('says beforehand whether saving would replace something', () => {
    saveView(db, 'invoices', 'Overdue', 'status=overdue')

    expect(viewExists(db, 'invoices', 'Overdue')).toBe(true)
    expect(viewExists(db, 'invoices', 'Drafts')).toBe(false)
    // Trimmed, so trailing whitespace does not sneak a duplicate past the UI.
    expect(viewExists(db, 'invoices', '  Overdue  ')).toBe(true)
  })

  it('refuses a name that is only whitespace', () => {
    expect(() => saveView(db, 'invoices', '   ', 'status=overdue')).toThrow(/needs a name/)
  })

  it('trims the name it stores', () => {
    saveView(db, 'invoices', '  Overdue  ', 'status=overdue')
    expect(listViews(db, 'invoices')[0]!.name).toBe('Overdue')
  })

  it('lets two lists use the same name', () => {
    // "Recent" means something different on invoices and on notes.
    saveView(db, 'invoices', 'Recent', 'sort=date')
    saveView(db, 'notes', 'Recent', 'sort=date')

    expect(listViews(db, 'invoices')).toHaveLength(1)
    expect(listViews(db, 'notes')).toHaveLength(1)
  })

  it('appends rather than jumping the order', () => {
    saveView(db, 'invoices', 'First', 'a=1')
    saveView(db, 'invoices', 'Second', 'b=2')

    expect(listViews(db, 'invoices').map((view) => view.name)).toEqual(['First', 'Second'])
  })

  it('keeps a replaced view where it was in the order', () => {
    saveView(db, 'invoices', 'First', 'a=1')
    saveView(db, 'invoices', 'Second', 'b=2')
    saveView(db, 'invoices', 'First', 'a=9')

    expect(listViews(db, 'invoices').map((view) => view.name)).toEqual(['First', 'Second'])
  })
})

describe('removing a view', () => {
  it('takes only the one named', () => {
    saveView(db, 'invoices', 'First', 'a=1')
    const second = saveView(db, 'invoices', 'Second', 'b=2')

    deleteView(db, second.id)

    expect(listViews(db, 'invoices').map((view) => view.name)).toEqual(['First'])
  })

  it('is silent about one that has already gone', () => {
    expect(() => deleteView(db, 404)).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { GUIDES, GUIDE_GROUPS, searchGuides } from './guides'
import { FEATURES } from './entitlements'

/**
 * The guides, as content.
 *
 * There is no logic here worth testing beyond the search, so most of this is
 * about the content staying honest: every guide reachable, every link going
 * somewhere real, and every named feature one that exists. A guide is the one
 * page in the app somebody reads *because* they are already confused, and a
 * dead link on it is worse than no guide at all.
 */

describe('the guides', () => {
  it('has unique ids, which the index selects by', () => {
    const ids = GUIDES.map((guide) => guide.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('files every guide under a group the page draws', () => {
    // A guide in a group the index does not render would exist and be
    // unreachable — invisible in the sidebar and findable only by search.
    for (const guide of GUIDES) {
      expect(GUIDE_GROUPS, guide.id).toContain(guide.group)
    }
  })

  it('names only features that exist', () => {
    // A typo here would print "Needs SoloWrk undefined" under a heading.
    for (const guide of GUIDES) {
      if (guide.feature) expect(FEATURES, guide.id).toContain(guide.feature)
    }
  })

  it('links only to real routes', () => {
    /*
      Checked against the routes App.tsx actually registers. A guide whose
      "Open it" button lands on a blank screen is worse than one with no
      button, and this is exactly the sort of thing that rots silently when a
      page is renamed.
    */
    const routes = new Set([
      '/',
      '/projects',
      '/tasks',
      '/time',
      '/calendar',
      '/notes',
      '/business-plan',
      '/clients',
      '/marketing',
      '/goals',
      '/invoices',
      '/finance',
      '/files',
      '/documents',
      '/trash',
      '/assistant',
      '/settings',
      '/guides',
      '/notifications'
    ])

    for (const guide of GUIDES) {
      if (guide.route) expect(routes, `${guide.id} → ${guide.route}`).toContain(guide.route)
    }
  })

  it('says something in every section', () => {
    // A heading with nothing under it reads as a guide somebody abandoned.
    for (const guide of GUIDES) {
      expect(guide.sections.length, guide.id).toBeGreaterThan(0)

      for (const section of guide.sections) {
        const said =
          (section.body?.length ?? 0) + (section.steps?.length ?? 0) + (section.tip ? 1 : 0)
        expect(said, `${guide.id} — ${section.heading}`).toBeGreaterThan(0)
      }
    }
  })

  it('covers every section of the app somebody can open', () => {
    // The point of the page is that everything is documented. This fails when
    // a module is added without a guide, which is the moment to write one.
    const documented = new Set(GUIDES.map((guide) => guide.route).filter(Boolean))

    for (const route of [
      '/projects',
      '/tasks',
      '/time',
      '/calendar',
      '/notes',
      '/business-plan',
      '/clients',
      '/marketing',
      '/goals',
      '/invoices',
      '/finance',
      '/files',
      '/documents',
      '/trash',
      '/assistant'
    ]) {
      expect(documented, route).toContain(route)
    }
  })
})

describe('searching', () => {
  it('returns everything for an empty search', () => {
    expect(searchGuides(GUIDES, '')).toHaveLength(GUIDES.length)
    expect(searchGuides(GUIDES, '   ')).toHaveLength(GUIDES.length)
  })

  it('looks inside the guide, not just at its title', () => {
    // Somebody stuck types the word confusing them rather than the name of
    // the page it happens to be documented on.
    const found = searchGuides(GUIDES, 'billable')
    expect(found.map((guide) => guide.id)).toContain('time')

    expect(searchGuides(GUIDES, 'overdue').map((one) => one.id)).toContain('invoices')
  })

  it('ignores case', () => {
    expect(searchGuides(GUIDES, 'CTRL K').length).toBeGreaterThan(0)
  })

  it('finds nothing rather than everything for a miss', () => {
    expect(searchGuides(GUIDES, 'quantum tunnelling')).toEqual([])
  })
})

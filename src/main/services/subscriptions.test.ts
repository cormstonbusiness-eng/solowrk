import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createBlock, listBlocks } = await import('./blocks')
const {
  SUBSCRIPTION_PROMISE,
  copyToMyCalendar,
  createSubscription,
  deleteSubscription,
  dueSubscriptions,
  exportIcs,
  importIcs,
  listSubscriptions,
  syncSubscription,
  updateSubscription
} = await import('./subscriptions')

/**
 * Nothing here touches the network. `fetch` is a function passed in, which is
 * the point: the one outward-facing feature in the app should be testable
 * without one, and a test that quietly made a real request would be a test
 * that failed on a train.
 */
const respond = (body: string, init: { ok?: boolean; status?: number } = {}): typeof fetch =>
  (async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: new Headers(),
      text: async () => body
    }) as unknown as Response) as unknown as typeof fetch

const failing = (message: string): typeof fetch =>
  (async () => {
    throw new Error(message)
  }) as unknown as typeof fetch

const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:one@example.com',
  'SUMMARY:Client workshop',
  'DTSTART:20260817T090000',
  'DTEND:20260817T110000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:two@example.com',
  'SUMMARY:Review',
  'DTSTART:20260819T140000',
  'DTEND:20260819T150000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const AUGUST = { from: '2026-08-01', to: '2026-08-31' }

describe('subscribed calendars', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-subs-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const subscribe = (): ReturnType<typeof createSubscription> =>
    createSubscription(db, { name: "Dana's calendar", url: 'https://example.com/feed.ics' })

  it('says plainly what it does, where the feature lives', () => {
    // Users choose this product for the local-first promise. Anything
    // network-facing has to explain itself in the panel, not in a help article.
    expect(SUBSCRIPTION_PROMISE).toBe(
      'SoloWrk downloads this calendar. It never uploads your SoloWrk data.'
    )
  })

  describe('the address', () => {
    it('turns a webcal link into https', () => {
      const one = createSubscription(db, { name: 'A', url: 'webcal://example.com/feed.ics' })
      expect(one.url).toBe('https://example.com/feed.ics')
    })

    it('refuses to read a local file', () => {
      // Otherwise a subscription URL becomes a way to read anything on disk.
      expect(() => createSubscription(db, { name: 'A', url: 'file:///etc/passwd' })).toThrow(
        /http/
      )
    })

    it('refuses something that is not an address at all', () => {
      expect(() => createSubscription(db, { name: 'A', url: 'not a url' })).toThrow()
    })

    it('cannot be repointed at a different feed', () => {
      // Reconciliation is by UID, so a new feed's UIDs are all different and
      // every block already pulled in would be stranded.
      const one = subscribe()
      const after = updateSubscription(db, one.id, {
        url: 'https://elsewhere.example/feed.ics'
      })
      expect(after.url).toBe('https://example.com/feed.ics')
    })
  })

  describe('syncing', () => {
    it('brings the feed in as locked, external blocks', async () => {
      const one = subscribe()
      const result = await syncSubscription(db, one.id, respond(FEED))

      expect(result).toMatchObject({ added: 2, updated: 0, removed: 0, error: null })

      const blocks = listBlocks(db, AUGUST)
      expect(blocks.map((block) => block.title)).toEqual(['Client workshop', 'Review'])
      expect(blocks.every((block) => block.locked)).toBe(true)
      expect(blocks.every((block) => block.blockType === 'external')).toBe(true)
      // Never billable. An hour in somebody else's calendar is not a claim
      // about your own week's worth.
      expect(blocks.every((block) => !block.billable)).toBe(true)
    })

    it('updates in place rather than replacing, so ids survive', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      const before = listBlocks(db, AUGUST).map((block) => block.id)

      const changed = FEED.replace('SUMMARY:Review', 'SUMMARY:Review (moved)')
      const result = await syncSubscription(db, one.id, respond(changed))

      expect(result).toMatchObject({ added: 0, updated: 2, removed: 0 })
      // A delete-and-insert would burn a fresh id every hour, and anything
      // linked or tagged against one would point at nothing by lunchtime.
      expect(listBlocks(db, AUGUST).map((block) => block.id)).toEqual(before)
      expect(listBlocks(db, AUGUST)[1]?.title).toBe('Review (moved)')
    })

    it('removes what has gone from the feed', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))

      const shorter = FEED.split('BEGIN:VEVENT')
        .slice(0, 2)
        .join('BEGIN:VEVENT')
        .concat('END:VCALENDAR')
      const result = await syncSubscription(db, one.id, respond(shorter))

      expect(result.removed).toBe(1)
      expect(listBlocks(db, AUGUST).map((block) => block.title)).toEqual(['Client workshop'])
    })

    it('never duplicates on a repeat sync', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      await syncSubscription(db, one.id, respond(FEED))
      await syncSubscription(db, one.id, respond(FEED))

      expect(listBlocks(db, AUGUST)).toHaveLength(2)
    })
  })

  describe('when the feed is broken', () => {
    it('comes back as a result rather than an exception', async () => {
      const one = subscribe()
      const result = await syncSubscription(db, one.id, failing('network down'))

      // A broken feed must not interrupt work. It is a dot in settings, and
      // that is all.
      expect(result.error).toBe('network down')
      expect(result.added).toBe(0)
    })

    it('records what went wrong on the subscription', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, failing('network down'))

      const after = listSubscriptions(db)[0]
      expect(after).toMatchObject({ lastStatus: 'error', syncError: 'network down' })
    })

    it('reports an HTTP failure in words', async () => {
      const one = subscribe()
      const result = await syncSubscription(db, one.id, respond('', { ok: false, status: 404 }))
      expect(result.error).toContain('404')
    })

    it('leaves what it already had alone', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      await syncSubscription(db, one.id, failing('network down'))

      // A feed that cannot be reached is not a feed that has been emptied.
      expect(listBlocks(db, AUGUST)).toHaveLength(2)
    })

    it('clears the error once it works again', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, failing('network down'))
      await syncSubscription(db, one.id, respond(FEED))

      expect(listSubscriptions(db)[0]).toMatchObject({ lastStatus: 'ok', syncError: '' })
    })

    it('survives a feed that is not a calendar', async () => {
      const one = subscribe()
      const result = await syncSubscription(db, one.id, respond('<html>Not found</html>'))
      expect(result).toMatchObject({ added: 0, error: null })
    })
  })

  describe('removing a subscription', () => {
    it('takes its blocks with it', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))

      deleteSubscription(db, one.id)

      // They were a cached copy of somebody else's calendar. Leaving them
      // would leave unowned, uneditable rows with nothing to explain them.
      expect(listBlocks(db, AUGUST)).toHaveLength(0)
    })

    it('leaves anything copied to your own calendar', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      const [external] = listBlocks(db, AUGUST)

      copyToMyCalendar(db, external!.id)
      deleteSubscription(db, one.id)

      const left = listBlocks(db, AUGUST)
      expect(left).toHaveLength(1)
      expect(left[0]).toMatchObject({ title: 'Client workshop', locked: false })
    })
  })

  describe('hiding one', () => {
    it('takes its blocks off the grid without unsubscribing', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      expect(listBlocks(db, AUGUST)).toHaveLength(2)

      updateSubscription(db, one.id, { visible: false })
      expect(listBlocks(db, AUGUST)).toHaveLength(0)

      // The rows are still there, so turning it back on costs nothing and
      // fetches nothing.
      updateSubscription(db, one.id, { visible: true })
      expect(listBlocks(db, AUGUST)).toHaveLength(2)
    })

    it('leaves the user’s own blocks alone', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      createBlock(db, { title: 'Mine', startsAt: '2026-08-18T09:00', endsAt: '2026-08-18T10:00' })

      updateSubscription(db, one.id, { visible: false })
      expect(listBlocks(db, AUGUST).map((block) => block.title)).toEqual(['Mine'])
    })
  })

  describe('copying one out', () => {
    it('makes an editable block of your own', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      const [external] = listBlocks(db, AUGUST)

      const copyId = copyToMyCalendar(db, external!.id)
      const copy = listBlocks(db, AUGUST).find((block) => block.id === copyId)

      expect(copy).toMatchObject({
        title: 'Client workshop',
        locked: false,
        blockType: 'meeting',
        startsAt: '2026-08-17T09:00'
      })
    })

    it('leaves the original as the record of what they said', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      const [external] = listBlocks(db, AUGUST)

      copyToMyCalendar(db, external!.id)
      const still = listBlocks(db, AUGUST).find((block) => block.id === external!.id)
      expect(still?.locked).toBe(true)
    })
  })

  describe('when to refresh', () => {
    it('treats one that has never synced as due', () => {
      subscribe()
      expect(dueSubscriptions(db)).toHaveLength(1)
    })

    it('leaves one alone until its interval has passed', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))

      expect(dueSubscriptions(db, new Date())).toHaveLength(0)
      const later = new Date(Date.now() + 61 * 60_000)
      expect(dueSubscriptions(db, later)).toHaveLength(1)
    })
  })

  describe('importing a file', () => {
    it('creates editable blocks, unlike a subscription', () => {
      expect(importIcs(db, FEED)).toBe(2)

      const blocks = listBlocks(db, AUGUST)
      expect(blocks.every((block) => !block.locked)).toBe(true)
      expect(blocks.every((block) => block.blockType === 'meeting')).toBe(true)
    })

    it('does not double everything when the same file is imported twice', () => {
      importIcs(db, FEED)
      expect(importIcs(db, FEED)).toBe(0)
      expect(listBlocks(db, AUGUST)).toHaveLength(2)
    })
  })

  describe('exporting', () => {
    it('writes the user’s own blocks', () => {
      createBlock(db, {
        title: 'Deep work',
        blockType: 'focus',
        startsAt: '2026-08-18T09:00',
        endsAt: '2026-08-18T12:00'
      })

      const text = exportIcs(db, AUGUST)
      expect(text).toContain('SUMMARY:Deep work')
      expect(text).toContain('DTSTART:20260818T090000')
    })

    it('never exports somebody else’s calendar', async () => {
      const one = subscribe()
      await syncSubscription(db, one.id, respond(FEED))
      createBlock(db, {
        title: 'Mine',
        startsAt: '2026-08-18T09:00',
        endsAt: '2026-08-18T10:00'
      })

      const text = exportIcs(db, AUGUST)
      expect(text).toContain('SUMMARY:Mine')
      expect(text).not.toContain('Client workshop')
    })

    it('includes what was imported from a file, which is the user’s own', () => {
      importIcs(db, FEED)
      const text = exportIcs(db, AUGUST)
      expect(text).toContain('Client workshop')
    })

    it('filters by block type when asked', () => {
      createBlock(db, {
        title: 'Deep work',
        blockType: 'focus',
        startsAt: '2026-08-18T09:00',
        endsAt: '2026-08-18T12:00'
      })
      createBlock(db, {
        title: 'Dentist',
        blockType: 'personal',
        startsAt: '2026-08-19T09:00',
        endsAt: '2026-08-19T10:00'
      })

      const text = exportIcs(db, { ...AUGUST, blockTypes: ['focus'] })
      expect(text).toContain('Deep work')
      expect(text).not.toContain('Dentist')
    })

    it('writes a series once, as a rule, rather than as every occurrence', () => {
      createBlock(db, {
        title: 'Stand-up',
        startsAt: '2026-08-03T09:00',
        endsAt: '2026-08-03T09:30',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO'
      })

      const text = exportIcs(db, AUGUST)
      expect(text.match(/SUMMARY:Stand-up/g)).toHaveLength(1)
      expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO')
    })
  })
})

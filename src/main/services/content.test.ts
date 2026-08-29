import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { createChannel, getPlan, listChannels, seedChannels, updateChannel, updatePlan } =
  await import('./channels')
const { contentMonth, createContent, listContent, updateContent, deleteContent } = await import(
  './content'
)

/**
 * Content, channels and the gaps between them.
 *
 * `@shared/cadence.test.ts` proves the arithmetic. This proves the parts that
 * touch state: that a gap is worked out against what is really in the month,
 * that publishing stamps a date once, and that a channel is retired rather
 * than deleted.
 */

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

// A Monday and the Sunday five weeks later, so week maths reads plainly.
const FROM = '2026-08-31'
const TO = '2026-09-27'

describe('channels', () => {
  it('offers a set to start from rather than an empty list', () => {
    // §15 answers its own question: suggested converts better, because an
    // empty module gives somebody nothing to react to.
    expect(seedChannels(db)).toBeGreaterThan(0)
    expect(listChannels(db).map((one) => one.name)).toContain('LinkedIn')
  })

  it('only seeds once', () => {
    seedChannels(db)
    expect(seedChannels(db)).toBe(0)
  })

  it('seeds no more than the tier has room for', () => {
    // Basic+ is capped at three (§12) and the suggested set is six. Seeding
    // blind would hand somebody twice their allowance and then refuse the
    // next thing they did.
    expect(seedChannels(db, 3)).toBe(3)
    expect(listChannels(db)).toHaveLength(3)
  })

  it('commits to nothing until asked', () => {
    // Guessing a cadence would either set a bar nobody agreed to, or teach
    // somebody to ignore the gaps on their first day.
    seedChannels(db)
    for (const channel of listChannels(db)) expect(channel.cadenceCount).toBe(0)
  })

  it('retires a channel rather than deleting it', () => {
    // Content already published to it keeps pointing somewhere, and the
    // consistency strip keeps its history.
    const channel = createChannel(db, { name: 'Twitter' })
    updateChannel(db, channel.id, { isActive: false })

    expect(listChannels(db)).toHaveLength(0)
    expect(listChannels(db, true)).toHaveLength(1)
  })
})

describe('the gaps on the calendar', () => {
  function weekly(count: number): number {
    return createChannel(db, { name: 'LinkedIn', cadenceCount: count, cadencePeriod: 'week' }).id
  }

  it('draws the whole commitment for an empty month', () => {
    weekly(2)
    // Four Mondays in the range, two a week.
    expect(contentMonth(db, FROM, TO).ghosts).toHaveLength(8)
  })

  it('subtracts what has already been written', () => {
    const id = weekly(2)
    createContent(db, { channelId: id, title: 'One', scheduledFor: '2026-09-01T09:00' })

    expect(contentMonth(db, FROM, TO).ghosts).toHaveLength(7)
  })

  it('counts only the channel it belongs to', () => {
    // Posting twice on LinkedIn does not keep a promise made about the
    // newsletter, and a calendar that thought so would hide the real gap.
    const linkedin = weekly(2)
    const newsletter = createChannel(db, {
      name: 'Newsletter',
      cadenceCount: 1,
      cadencePeriod: 'week'
    }).id

    createContent(db, { channelId: linkedin, title: 'A', scheduledFor: '2026-09-01T09:00' })
    createContent(db, { channelId: linkedin, title: 'B', scheduledFor: '2026-09-02T09:00' })

    const ghosts = contentMonth(db, FROM, TO).ghosts
    expect(ghosts.filter((one) => one.channelId === newsletter)).toHaveLength(4)
    expect(ghosts.filter((one) => one.channelId === linkedin)).toHaveLength(6)
  })

  it('says nothing for a channel nobody promised anything about', () => {
    createChannel(db, { name: 'Directories', cadenceCount: 0 })
    expect(contentMonth(db, FROM, TO).ghosts).toEqual([])
  })

  it('ignores a retired channel', () => {
    const id = weekly(2)
    updateChannel(db, id, { isActive: false })

    expect(contentMonth(db, FROM, TO).ghosts).toEqual([])
  })

  it('stores none of them', () => {
    // A gap is the absence of something. Storing absences would mean
    // reconciling them every time a real item moved.
    weekly(2)
    contentMonth(db, FROM, TO)

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM content_items')!.n).toBe(0)
  })
})

describe('a content item', () => {
  it('is an idea when it has no date, and scheduled when it has one', () => {
    // Two fields that cannot disagree, so the caller sets one.
    expect(createContent(db, { title: 'Someday' }).status).toBe('idea')
    expect(createContent(db, { title: 'Tuesday', scheduledFor: '2026-09-01T09:00' }).status).toBe(
      'scheduled'
    )
  })

  it('stamps the day it was published, once', () => {
    const item = createContent(db, { title: 'A', scheduledFor: '2026-09-01T09:00' })

    const published = updateContent(db, item.id, { status: 'published' })
    expect(published.publishedAt).not.toBeNull()

    // Edited again later: the date it went out does not move.
    const edited = updateContent(db, item.id, { status: 'published', title: 'A, revised' })
    expect(edited.publishedAt).toBe(published.publishedAt)
  })

  it('carries its channel through for the calendar to colour by', () => {
    const id = createChannel(db, { name: 'LinkedIn', colour: '#0A66C2' }).id
    const item = createContent(db, { title: 'A', channelId: id })

    expect(item.channelName).toBe('LinkedIn')
    expect(item.channelColour).toBe('#0A66C2')
  })

  it('keeps the undated ones out of the month', () => {
    createContent(db, { title: 'Idea' })
    createContent(db, { title: 'Dated', scheduledFor: '2026-09-01T09:00' })

    expect(contentMonth(db, FROM, TO).items).toHaveLength(1)
    expect(listContent(db, { undated: true })).toHaveLength(1)
  })

  it('hides a deleted item without losing it', () => {
    const item = createContent(db, { title: 'A' })
    deleteContent(db, item.id)

    expect(listContent(db)).toHaveLength(0)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM content_items')!.n).toBe(1)
  })
})

describe('the plan', () => {
  it('is there before anybody writes it', () => {
    // A single-row table nobody inserted into reads as broken rather than
    // unwritten.
    expect(getPlan(db)).toMatchObject({ audience: '', quarterlyFocus: '', annualBudget: 0 })
  })

  it('saves what was written', () => {
    updatePlan(db, { quarterlyFocus: 'Replace the Harding retainer', annualBudget: 120_000 })

    expect(getPlan(db)).toMatchObject({
      quarterlyFocus: 'Replace the Harding retainer',
      annualBudget: 120_000
    })
  })
})

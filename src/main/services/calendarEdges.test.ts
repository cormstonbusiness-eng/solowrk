import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
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

/**
 * §13's edge cases, which the specification says not to skip.
 *
 * The clock-change ones are the reason the whole calendar is stored as wall
 * time rather than as instants. Nothing here converts anything, so there is
 * nothing for an hour to be added to or taken from — and these tests are what
 * says so out loud, because the first person to "fix" a stamp into a Date
 * would break every one of them.
 */
describe('the clocks going forward', () => {
  let db: InstanceType<typeof Database>
  let root: string

  // 29 March 2026, when UK clocks go forward: 01:00 becomes 02:00.
  const SPRING = '2026-03-29'

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-dst-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('keeps the length of a block spanning the hour that does not exist', () => {
    const block = createBlock(db, {
      title: 'Overnight deploy',
      startsAt: `${SPRING}T00:30`,
      endsAt: `${SPRING}T03:30`
    })

    // Three hours on the clock face, whatever the offset did underneath. A
    // calendar storing instants would have to decide whether this was two
    // hours or three, and either answer is wrong for somebody.
    expect(block).toMatchObject({
      startsAt: '2026-03-29T00:30',
      endsAt: '2026-03-29T03:30'
    })
  })

  it('leaves a weekly meeting at the same time either side of the change', () => {
    createBlock(db, {
      title: 'Stand-up',
      startsAt: '2026-03-23T09:00',
      endsAt: '2026-03-23T09:30',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    const found = listBlocks(db, { from: '2026-03-20', to: '2026-04-10' })
    // 09:00 before the change, 09:00 after it. This is the whole reason
    // recurrence works in day space: a date and a wall time are put back
    // together, so there is no instant to drift.
    expect(found.map((one) => one.startsAt)).toEqual([
      '2026-03-23T09:00',
      '2026-03-30T09:00',
      '2026-04-06T09:00'
    ])
  })

  it('keeps a block that starts inside the skipped hour rather than losing it', () => {
    // 01:30 does not exist on this date in Europe/London. It is still a thing
    // somebody wrote down, and dropping it would be worse than showing it.
    const block = createBlock(db, {
      title: 'Inside the gap',
      startsAt: `${SPRING}T01:30`,
      endsAt: `${SPRING}T02:00`
    })

    expect(listBlocks(db, { from: SPRING, to: SPRING }).map((one) => one.title)).toEqual([
      'Inside the gap'
    ])
    expect(block.startsAt).toBe('2026-03-29T01:30')
  })
})

describe('the clocks going back', () => {
  let db: InstanceType<typeof Database>
  let root: string

  // 25 October 2026: 02:00 happens twice.
  const AUTUMN = '2026-10-25'

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-dst2-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('keeps the length of a block spanning the repeated hour', () => {
    const block = createBlock(db, {
      title: 'Long night',
      startsAt: `${AUTUMN}T01:00`,
      endsAt: `${AUTUMN}T04:00`
    })
    expect(block).toMatchObject({ startsAt: '2026-10-25T01:00', endsAt: '2026-10-25T04:00' })
  })

  it('leaves a weekly meeting alone across it', () => {
    createBlock(db, {
      title: 'Stand-up',
      startsAt: '2026-10-19T09:00',
      endsAt: '2026-10-19T09:30',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    expect(
      listBlocks(db, { from: '2026-10-15', to: '2026-11-05' }).map((one) => one.startsAt)
    ).toEqual(['2026-10-19T09:00', '2026-10-26T09:00', '2026-11-02T09:00'])
  })
})

describe('restoring a backup', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'solo-backup-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('brings recurrence rules through the round trip intact', async () => {
    // On disk and through a real file copy, because that is what a backup is.
    // A rule that survived in memory and not on disk would be a rule somebody
    // lost the day they needed the backup.
    const root = await mkdtemp(join(tmpdir(), 'solo-backup-ws-'))
    await scaffoldWorkspace(root)

    const file = join(dir, 'solo.db')
    const original = new Database(file)

    createBlock(original, {
      title: 'Stand-up',
      startsAt: '2026-08-03T09:00',
      endsAt: '2026-08-03T09:30',
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=20',
      recurrenceExdates: ['2026-08-17']
    })

    original.checkpoint()
    const copy = join(dir, 'backup.db')
    copyFileSync(file, copy)
    original.close()

    const restored = new Database(copy)
    const [master] = restored.all<{ recurrence_rule: string; recurrence_exdates: string }>(
      'SELECT recurrence_rule, recurrence_exdates FROM calendar_blocks'
    )

    expect(master?.recurrence_rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=20')
    expect(master?.recurrence_exdates).toBe('2026-08-17')

    // And it still expands to the same days, which is the part that matters.
    expect(
      listBlocks(restored, { from: '2026-08-01', to: '2026-08-31' }).map((one) => one.startsAt)
    ).toEqual([
      '2026-08-03T09:00',
      '2026-08-05T09:00',
      '2026-08-19T09:00',
      '2026-08-31T09:00'
    ])

    restored.close()
    await rm(root, { recursive: true, force: true })
  })
})

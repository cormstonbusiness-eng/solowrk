import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const {
  PUBLISH_GRACE_MINUTES,
  createCampaign,
  createPillar,
  createPost,
  deletePost,
  duePosts,
  getPost,
  listCampaigns,
  listPosts,
  markNeedsAttention,
  marketingSummary,
  pillarMix,
  runEvergreen,
  setTargetResult,
  updatePost
} = await import('./marketing')

const TODAY = '2026-08-17'

describe('marketing', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-marketing-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const post = (overrides = {}): Parameters<typeof createPost>[2] => ({
    title: 'Case study',
    body: 'How we rebuilt a brand in six weeks.',
    ...overrides
  })

  describe('posts and targets', () => {
    it('treats a post with no date as an idea', async () => {
      const created = await createPost(db, root, post(), TODAY)
      expect(created.status).toBe('idea')
      expect(created.scheduledAt).toBeNull()
    })

    it('treats a post with a date as scheduled', async () => {
      const created = await createPost(db, root, post({ scheduledAt: '2026-08-20T09:00' }), TODAY)
      expect(created.status).toBe('scheduled')
    })

    it('promotes an idea when it is given a date', async () => {
      const created = await createPost(db, root, post(), TODAY)
      const dated = await updatePost(db, root, created.id, { scheduledAt: '2026-08-20T09:00' }, TODAY)
      expect(dated.status).toBe('scheduled')
    })

    it('returns a scheduled post to the backlog when its date is cleared', async () => {
      const created = await createPost(db, root, post({ scheduledAt: '2026-08-20T09:00' }), TODAY)
      const cleared = await updatePost(db, root, created.id, { scheduledAt: null }, TODAY)
      expect(cleared.status).toBe('idea')
    })

    it('stores one target per platform', async () => {
      const created = await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-20T09:00',
          targets: [{ platform: 'linkedin' }, { platform: 'instagram', body: 'Shorter. #design' }]
        }),
        TODAY
      )

      expect(created.targets.map((target) => target.platform)).toEqual(['linkedin', 'instagram'])
      expect(created.targets[1]?.body).toBe('Shorter. #design')
    })

    it('finds the backlog by absence of a date, not by status', async () => {
      await createPost(db, root, post({ title: 'Undated' }), TODAY)
      await createPost(db, root, post({ title: 'Dated', scheduledAt: '2026-08-20T09:00' }), TODAY)

      expect(listPosts(db, { backlog: true }).map((p) => p.title)).toEqual(['Undated'])
    })

    it('includes a post scheduled late on the last day of a range', async () => {
      // The naive comparison '2026-08-20' >= '2026-08-20T23:30' is false, which
      // would drop an evening post from a range ending on its own day.
      await createPost(db, root, post({ scheduledAt: '2026-08-20T23:30' }), TODAY)
      expect(listPosts(db, { from: '2026-08-20', to: '2026-08-20' })).toHaveLength(1)
    })
  })

  describe('partial failure', () => {
    it('marks the post published only when every target went out', async () => {
      const created = await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-20T09:00',
          targets: [{ platform: 'linkedin' }, { platform: 'instagram' }]
        }),
        TODAY
      )

      setTargetResult(db, created.targets[0]!.id, { status: 'published' })
      expect(getPost(db, created.id).status).toBe('scheduled')

      setTargetResult(db, created.targets[1]!.id, { status: 'published' })
      expect(getPost(db, created.id).status).toBe('published')
    })

    it('marks the post failed when any target failed', async () => {
      const created = await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-20T09:00',
          targets: [{ platform: 'linkedin' }, { platform: 'instagram' }]
        }),
        TODAY
      )

      setTargetResult(db, created.targets[0]!.id, { status: 'published' })
      setTargetResult(db, created.targets[1]!.id, {
        status: 'failed',
        error: 'Aspect ratio not supported'
      })

      const after = getPost(db, created.id)
      expect(after.status).toBe('failed')
      // The one that worked keeps its success — a partial failure must not
      // read as though nothing went out.
      expect(after.targets[0]?.status).toBe('published')
      expect(after.targets[1]?.error).toBe('Aspect ratio not supported')
    })

    it('counts a natively scheduled target as sent', async () => {
      // Facebook and Pinterest hold the post themselves, so handing it over is
      // as far as SoloWrk goes and the post is not still "scheduled" here.
      const created = await createPost(
        db,
        root,
        post({ scheduledAt: '2026-08-20T09:00', targets: [{ platform: 'facebook' }] }),
        TODAY
      )

      setTargetResult(db, created.targets[0]!.id, { status: 'handed_over', externalId: 'fb1' })
      expect(getPost(db, created.id).status).toBe('published')
    })

    it('ignores skipped targets when deciding the post status', async () => {
      const created = await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-20T09:00',
          targets: [{ platform: 'linkedin' }, { platform: 'tiktok' }]
        }),
        TODAY
      )

      setTargetResult(db, created.targets[1]!.id, { status: 'skipped' })
      setTargetResult(db, created.targets[0]!.id, { status: 'published' })

      expect(getPost(db, created.id).status).toBe('published')
    })

    it('does not rewrite a target that has already gone out', async () => {
      const created = await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-20T09:00',
          targets: [{ platform: 'linkedin' }, { platform: 'instagram' }]
        }),
        TODAY
      )
      setTargetResult(db, created.targets[0]!.id, {
        status: 'published',
        externalUrl: 'https://linkedin.com/p/1'
      })

      // Editing the post and saving again must not lose the published link.
      const edited = await updatePost(
        db,
        root,
        created.id,
        { targets: [{ platform: 'linkedin' }, { platform: 'instagram' }] },
        TODAY
      )

      const linkedin = edited.targets.find((target) => target.platform === 'linkedin')
      expect(linkedin?.externalUrl).toBe('https://linkedin.com/p/1')
      expect(linkedin?.status).toBe('published')
    })
  })

  describe('due posts and the grace window', () => {
    beforeEach(async () => {
      await createPost(db, root, post({ scheduledAt: '2026-08-17T09:00' }), TODAY)
    })

    it('is not due before its time', () => {
      expect(duePosts(db, '2026-08-17T08:59').due).toHaveLength(0)
    })

    it('is due at its time', () => {
      expect(duePosts(db, '2026-08-17T09:00').due).toHaveLength(1)
    })

    it('is still due inside the grace window', () => {
      expect(duePosts(db, '2026-08-17T09:59').due).toHaveLength(1)
    })

    it('is late once the grace window has passed', () => {
      const { due, late } = duePosts(db, '2026-08-17T11:00')
      expect(due).toHaveLength(0)
      expect(late).toHaveLength(1)
    })

    it('treats the grace boundary itself as still due', () => {
      const boundary = `2026-08-17T${String(9 + PUBLISH_GRACE_MINUTES / 60).padStart(2, '0')}:00`
      expect(duePosts(db, boundary).due).toHaveLength(1)
    })

    it('counts lateness across a day boundary', () => {
      // The app was closed overnight. A post from yesterday morning is late,
      // not due — sending it now would be a day out of date.
      expect(duePosts(db, '2026-08-18T09:00').late).toHaveLength(1)
    })

    it('leaves undated and already-published posts alone', async () => {
      await createPost(db, root, post({ title: 'Idea' }), TODAY)
      const published = await createPost(
        db,
        root,
        post({ scheduledAt: '2026-08-16T09:00' }),
        TODAY
      )
      await updatePost(db, root, published.id, { status: 'published' }, TODAY)

      const { due, late } = duePosts(db, '2026-08-17T09:30')
      expect(due).toHaveLength(1)
      expect(late).toHaveLength(0)
    })

    it('stops reporting a post once it has been flagged', () => {
      const { late } = duePosts(db, '2026-08-19T09:00')
      markNeedsAttention(db, late.map((p) => p.id))
      expect(duePosts(db, '2026-08-19T09:00').late).toHaveLength(0)
    })
  })

  describe('evergreen', () => {
    it('re-posts as a copy, keeping the original intact', async () => {
      const original = await createPost(
        db,
        root,
        post({ scheduledAt: '2026-08-01T09:00', evergreenDays: 30, status: 'published' }),
        TODAY
      )
      expect(original.nextRepeatOn).toBe('2026-08-31')

      const created = await runEvergreen(db, root, '2026-08-31')
      expect(created).toHaveLength(1)
      expect(created[0]?.id).not.toBe(original.id)
      expect(created[0]?.parentPostId).toBe(original.id)
      expect(getPost(db, original.id).status).toBe('published')
    })

    it('keeps the original time of day', async () => {
      await createPost(
        db,
        root,
        post({ scheduledAt: '2026-08-01T14:30', evergreenDays: 30, status: 'published' }),
        TODAY
      )
      const [copy] = await runEvergreen(db, root, '2026-08-31')
      expect(copy?.scheduledAt).toBe('2026-08-31T14:30')
    })

    it('carries the targets and media across', async () => {
      const source = join(root, 'shot.jpg')
      await writeFile(source, 'not really a jpeg')

      await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-01T09:00',
          evergreenDays: 30,
          status: 'published',
          targets: [{ platform: 'linkedin' }],
          media: [{ file: source, altText: 'A photo' }]
        }),
        TODAY
      )

      const [copy] = await runEvergreen(db, root, '2026-08-31')
      expect(copy?.targets.map((t) => t.platform)).toEqual(['linkedin'])
      expect(copy?.media[0]?.altText).toBe('A photo')
    })

    it('does not pile up missed cycles into several posts at once', async () => {
      // Three cycles passed while the app was closed. That is one post to make
      // now, not three going out together.
      await createPost(
        db,
        root,
        post({ scheduledAt: '2026-01-01T09:00', evergreenDays: 30, status: 'published' }),
        TODAY
      )

      const created = await runEvergreen(db, root, '2026-05-01')
      expect(created).toHaveLength(1)
      expect(created[0]!.scheduledAt! >= '2026-05-01').toBe(true)
    })

    it('does nothing before the interval is up', async () => {
      await createPost(
        db,
        root,
        post({ scheduledAt: '2026-08-01T09:00', evergreenDays: 30, status: 'published' }),
        TODAY
      )
      expect(await runEvergreen(db, root, '2026-08-15')).toHaveLength(0)
    })

    it('ignores one-off posts', async () => {
      await createPost(db, root, post({ scheduledAt: '2026-08-01T09:00', status: 'published' }), TODAY)
      expect(await runEvergreen(db, root, '2026-12-01')).toHaveLength(0)
    })
  })

  describe('media', () => {
    it('files an asset by year and month and stores a relative path', async () => {
      const source = join(root, 'hero.png')
      await writeFile(source, 'x')

      const created = await createPost(
        db,
        root,
        post({ media: [{ file: source }] }),
        '2026-08-17'
      )

      expect(created.media[0]?.file).toBe(join('Marketing', 'Assets', '2026', '08', 'hero.png'))
      expect(await readdir(join(root, 'Marketing', 'Assets', '2026', '08'))).toEqual(['hero.png'])
    })

    it('does not copy the file again when the post is edited', async () => {
      const source = join(root, 'hero.png')
      await writeFile(source, 'x')

      const created = await createPost(db, root, post({ media: [{ file: source }] }), '2026-08-17')
      const stored = created.media[0]!.file

      // Re-saving with the relative path it already has must not produce
      // "hero 2.png" on every edit.
      await updatePost(db, root, created.id, { media: [{ file: stored }] }, '2026-08-17')

      expect(await readdir(join(root, 'Marketing', 'Assets', '2026', '08'))).toEqual(['hero.png'])
    })

    it('leaves asset files on disk when a post is deleted', async () => {
      const source = join(root, 'hero.png')
      await writeFile(source, 'x')
      const created = await createPost(db, root, post({ media: [{ file: source }] }), '2026-08-17')

      deletePost(db, created.id)

      expect(await readdir(join(root, 'Marketing', 'Assets', '2026', '08'))).toEqual(['hero.png'])
    })
  })

  describe('pillar mix', () => {
    it('reports the share of output per pillar', async () => {
      const education = createPillar(db, { name: 'Education', targetShare: 5000 })
      const proof = createPillar(db, { name: 'Proof', targetShare: 5000 })

      for (const pillarId of [education.id, education.id, education.id, proof.id]) {
        await createPost(db, root, post({ pillarId, scheduledAt: '2026-08-20T09:00' }), TODAY)
      }

      const mix = pillarMix(db, listPosts(db, { from: '2026-08-01', to: '2026-08-31' }))
      expect(mix.find((row) => row.name === 'Education')?.actualShare).toBe(7500)
      expect(mix.find((row) => row.name === 'Proof')?.actualShare).toBe(2500)
    })

    it('surfaces posts with no pillar rather than hiding them', async () => {
      createPillar(db, { name: 'Education', targetShare: 10_000 })
      await createPost(db, root, post({ scheduledAt: '2026-08-20T09:00' }), TODAY)

      const mix = pillarMix(db, listPosts(db, { from: '2026-08-01', to: '2026-08-31' }))
      expect(mix.find((row) => row.pillarId === null)?.actualShare).toBe(10_000)
    })

    it('does not divide by zero on an empty range', () => {
      createPillar(db, { name: 'Education', targetShare: 10_000 })
      const mix = pillarMix(db, [])
      expect(mix.every((row) => row.actualShare === 0)).toBe(true)
    })
  })

  describe('summary', () => {
    it('reports the days with nothing planned', async () => {
      await createPost(db, root, post({ scheduledAt: '2026-08-18T09:00' }), TODAY)

      const summary = marketingSummary(db, { from: '2026-08-17', to: '2026-08-19' })
      expect(summary.emptyDays).toEqual(['2026-08-17', '2026-08-19'])
    })

    it('counts by platform across targets', async () => {
      await createPost(
        db,
        root,
        post({
          scheduledAt: '2026-08-18T09:00',
          targets: [{ platform: 'linkedin' }, { platform: 'instagram' }]
        }),
        TODAY
      )

      const summary = marketingSummary(db, { from: '2026-08-01', to: '2026-08-31' })
      expect(summary.byPlatform.find((row) => row.platform === 'linkedin')?.scheduled).toBe(1)
      expect(summary.byPlatform.find((row) => row.platform === 'tiktok')?.scheduled).toBe(0)
    })
  })

  describe('campaigns', () => {
    it('counts its posts', async () => {
      const campaign = createCampaign(db, { name: 'Autumn push' })
      await createPost(db, root, post({ campaignId: campaign.id }), TODAY)

      expect(listCampaigns(db)[0]).toMatchObject({ name: 'Autumn push', postCount: 1 })
    })

    it('hides archived campaigns unless asked for', () => {
      createCampaign(db, { name: 'Old', status: 'archived' })
      expect(listCampaigns(db)).toHaveLength(0)
      expect(listCampaigns(db, true)).toHaveLength(1)
    })
  })
})

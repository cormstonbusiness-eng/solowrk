import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const {
  archiveCampaign,
  campaignWork,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign
} = await import('./campaigns')
const { createContent } = await import('./content')
const { createTask } = await import('./tasks')

/**
 * A campaign, and the three things that hang off one.
 *
 * The counts are where this earns its keep. Content and tasks are two
 * independent one-to-many relationships, and the obvious implementation —
 * two joins and a GROUP BY — multiplies them: four posts and three tasks
 * reports twelve of each. That is the bug these tests exist to catch.
 */

let db: InstanceType<typeof Database>
let workspace: string

beforeEach(async () => {
  db = new Database(':memory:')
  workspace = await mkdtemp(join(tmpdir(), 'solowrk-campaigns-'))
})

afterEach(async () => {
  db.close()
  await rm(workspace, { recursive: true, force: true })
})

describe('a campaign', () => {
  it('gets a folder of its own, under Marketing', async () => {
    const campaign = await createCampaign(db, workspace, { name: 'Spring push' })

    expect(campaign.folder).toBe('Marketing\\Campaigns\\Spring push')
    expect((await campaignWork(db, workspace, campaign.id)).files).toEqual([])
  })

  it('does not put two campaigns in one folder', async () => {
    // Two campaigns can share a name — a yearly push often does — and the
    // second must not quietly write into the first one's folder.
    const first = await createCampaign(db, workspace, { name: 'Spring push' })
    const second = await createCampaign(db, workspace, { name: 'Spring push' })

    expect(second.folder).not.toBe(first.folder)
  })

  it('lists the files somebody dropped in, without being told about them', async () => {
    // Read from the directory rather than a table of file rows. A table would
    // be a second copy of the folder, wrong the moment anything is moved from
    // outside the app — which it will be, because it is their disk.
    const campaign = await createCampaign(db, workspace, { name: 'Launch' })
    await writeFile(join(workspace, campaign.folder, 'poster.png'), 'x')

    const work = await campaignWork(db, workspace, campaign.id)
    expect(work.files.map((file) => file.name)).toEqual(['poster.png'])
  })

  it('opens even when its folder has been deleted from outside', async () => {
    const campaign = await createCampaign(db, workspace, { name: 'Launch' })
    await rm(join(workspace, campaign.folder), { recursive: true })

    const work = await campaignWork(db, workspace, campaign.id)
    expect(work.files).toEqual([])
  })
})

describe('the work on a campaign', () => {
  it('gathers its content, its tasks and its files', async () => {
    const campaign = await createCampaign(db, workspace, { name: 'Launch' })

    createContent(db, { title: 'Teaser', campaignId: campaign.id })
    createTask(db, { title: 'Book the photographer', campaignId: campaign.id })
    await writeFile(join(workspace, campaign.folder, 'brief.md'), '# Brief')

    const work = await campaignWork(db, workspace, campaign.id)
    expect(work.content).toHaveLength(1)
    expect(work.tasks).toHaveLength(1)
    expect(work.files).toHaveLength(1)
  })

  it('counts content and tasks independently of each other', () => {
    // The multiplication bug: two one-to-many joins in one query report the
    // product of the two counts rather than each of them.
    return createCampaign(db, workspace, { name: 'Launch' }).then((campaign) => {
      for (const title of ['A', 'B', 'C', 'D']) {
        createContent(db, { title, campaignId: campaign.id })
      }
      for (const title of ['One', 'Two', 'Three']) {
        createTask(db, { title, campaignId: campaign.id })
      }

      const fresh = getCampaign(db, campaign.id)
      expect(fresh.contentCount).toBe(4)
      expect(fresh.taskCount).toBe(3)
    })
  })

  it('counts what is done separately from what exists', async () => {
    const campaign = await createCampaign(db, workspace, { name: 'Launch' })

    createContent(db, { title: 'Out', campaignId: campaign.id, status: 'published' })
    createContent(db, { title: 'Not out', campaignId: campaign.id })
    createTask(db, { title: 'Done', campaignId: campaign.id, status: 'done' })
    createTask(db, { title: 'Not done', campaignId: campaign.id })

    const fresh = getCampaign(db, campaign.id)
    expect(fresh.publishedCount).toBe(1)
    expect(fresh.taskDoneCount).toBe(1)
  })

  it('keeps a task when its campaign goes', async () => {
    // SET NULL rather than CASCADE, unlike a project's tasks. Deleting a
    // campaign must not delete the work somebody did for it: an orphaned task
    // in the list is recoverable and a silently deleted one is not.
    const campaign = await createCampaign(db, workspace, { name: 'Launch' })
    const task = createTask(db, { title: 'Book the photographer', campaignId: campaign.id })

    db.run('DELETE FROM marketing_campaigns WHERE id = ?', [campaign.id])

    const after = db.get<{ campaign_id: number | null }>(
      'SELECT campaign_id FROM tasks WHERE id = ?',
      [task.id]
    )
    expect(after).toBeDefined()
    expect(after!.campaign_id).toBeNull()
  })
})

describe('the campaign list', () => {
  it('keeps templates out of it', async () => {
    // A template exists to be copied, not run. One in the list would read as
    // a campaign nobody is doing anything about.
    await createCampaign(db, workspace, { name: 'Real one' })
    await createCampaign(db, workspace, { name: 'Reusable', isTemplate: true })

    expect(listCampaigns(db).map((one) => one.name)).toEqual(['Real one'])
    expect(listCampaigns(db, { templates: true }).map((one) => one.name)).toEqual(['Reusable'])
  })

  it('hides an archived campaign without losing it', async () => {
    const campaign = await createCampaign(db, workspace, { name: 'Last year' })
    archiveCampaign(db, campaign.id)

    expect(listCampaigns(db)).toHaveLength(0)
    expect(listCampaigns(db, { includeArchived: true })).toHaveLength(1)
    // Its content and tasks still have somewhere to point.
    expect(getCampaign(db, campaign.id).name).toBe('Last year')
  })

  it('saves what was written on the record', async () => {
    const campaign = await createCampaign(db, workspace, { name: 'Launch' })
    const saved = updateCampaign(db, campaign.id, {
      status: 'complete',
      budget: 45_000,
      retrospective: 'The ads did nothing. The newsletter did everything.'
    })

    expect(saved.status).toBe('complete')
    expect(saved.budget).toBe(45_000)
    expect(saved.retrospective).toContain('newsletter')
  })
})

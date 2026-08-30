import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { chainFor, derivativesOf, repurpose } = await import('./repurpose')
const { alreadyHarvested, harvestProject } = await import('./harvest')
const { checkQuietPeriod, quietPeriodWarning, runwayWeeks, typicalLeadWeeks } = await import(
  './quietPeriod'
)
const { createChannel } = await import('./channels')
const { createContent } = await import('./content')
const { listLibrary } = await import('./library')
const { updateSettings } = await import('./settings')
const { listNotifications } = await import('./notifications')

/**
 * The three features §9 says make this more than a content calendar.
 *
 * All three do something on somebody's behalf, which is why the tests are
 * mostly about restraint: not making five things twice, not scheduling
 * anything nobody agreed to, and not warning about a pipeline when the
 * question cannot honestly be answered.
 */

const TODAY = '2026-06-01'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

function addProject(options: { due?: string | null; status?: string } = {}): number {
  db.run(
    `INSERT INTO clients (name, folder, created_at, updated_at)
     VALUES ('Harding', 'Clients\\Harding', datetime('now'), datetime('now'))`
  )
  db.run(
    `INSERT INTO projects (client_id, name, folder, status, due_on, created_at, updated_at)
     VALUES (1, 'Riverside barn', 'Clients\\Harding\\Riverside', ?, ?, datetime('now'), datetime('now'))`,
    [options.status ?? 'active', options.due ?? null]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

describe('repurpose chains', () => {
  it('makes one shell per channel, as ideas with no date', () => {
    // Derivatives that arrived pre-scheduled would put five things on the
    // calendar nobody agreed to write, which is how a calendar stops being
    // believed.
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const newsletter = createChannel(db, { name: 'Newsletter' }).id
    const source = createContent(db, { title: 'The Harding job' })

    const made = repurpose(db, { sourceId: source.id, channelIds: [linkedin, newsletter] })

    expect(made).toHaveLength(2)
    for (const item of made) {
      expect(item.status).toBe('idea')
      expect(item.scheduledFor).toBeNull()
      expect(item.parentContentId).toBe(source.id)
    }
  })

  it('names a derivative after its source and channel', () => {
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const source = createContent(db, { title: 'The Harding job' })

    expect(repurpose(db, { sourceId: source.id, channelIds: [linkedin] })[0]!.title).toBe(
      'The Harding job — for LinkedIn'
    )
  })

  it('does not repurpose twice onto the same channel', () => {
    // Almost always a double click rather than an intention.
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const source = createContent(db, { title: 'The Harding job' })

    repurpose(db, { sourceId: source.id, channelIds: [linkedin] })
    expect(repurpose(db, { sourceId: source.id, channelIds: [linkedin] })).toEqual([])
    expect(derivativesOf(db, source.id)).toHaveLength(1)
  })

  it('keeps a derivative with its source campaign', () => {
    db.run(
      `INSERT INTO marketing_campaigns (name, folder, created_at, updated_at)
       VALUES ('Spring', '', datetime('now'), datetime('now'))`
    )
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const source = createContent(db, { title: 'A', campaignId: 1 })

    expect(repurpose(db, { sourceId: source.id, channelIds: [linkedin] })[0]!.campaignId).toBe(1)
  })

  it('shows the thread in both directions', () => {
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const source = createContent(db, { title: 'The Harding job' })
    const [derivative] = repurpose(db, { sourceId: source.id, channelIds: [linkedin] })

    expect(chainFor(db, source.id).derivatives).toHaveLength(1)
    expect(chainFor(db, source.id).parent).toBeNull()
    expect(chainFor(db, derivative!.id).parent?.id).toBe(source.id)
  })

  it('does not copy the source body', () => {
    // A copy drifts the moment the original is edited, and then the
    // derivative quotes a version of the post that no longer exists.
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const source = createContent(db, { title: 'A', body: 'The original wording.' })

    expect(repurpose(db, { sourceId: source.id, channelIds: [linkedin] })[0]!.body).toBe('')
  })
})

describe('harvesting a finished project', () => {
  it('writes a case study and three ideas', () => {
    const project = addProject()
    const result = harvestProject(db, project)

    expect(result.caseStudy.type).toBe('case_study')
    expect(result.ideas).toHaveLength(3)
    expect(listLibrary(db)).toHaveLength(1)
  })

  it('leaves the ideas undated and unassigned', () => {
    const project = addProject()
    for (const idea of harvestProject(db, project).ideas) {
      expect(idea.status).toBe('idea')
      expect(idea.scheduledFor).toBeNull()
      expect(idea.channelId).toBeNull()
    }
  })

  it('ties everything back to the job it came from', () => {
    const project = addProject()
    const result = harvestProject(db, project)

    expect(result.caseStudy.sourceProjectId).toBe(project)
    for (const idea of result.ideas) expect(idea.sourceProjectId).toBe(project)
  })

  it('knows when a job has already been written up', () => {
    // Offering to turn a job into marketing when one has been written is how
    // a helpful prompt becomes an irritating one.
    const project = addProject()
    expect(alreadyHarvested(db, project)).toBe(false)

    harvestProject(db, project)
    expect(alreadyHarvested(db, project)).toBe(true)
  })
})

describe('the quiet-period trigger', () => {
  it('measures how far ahead the booked work runs', () => {
    addProject({ due: '2026-06-29' })
    expect(runwayWeeks(db, TODAY)).toBe(4)
  })

  it('says nothing when no live work has a date on it', () => {
    // Null is "cannot answer", not "no work" — and the honest response to an
    // unanswerable question is silence rather than a warning.
    addProject({ due: null })
    expect(runwayWeeks(db, TODAY)).toBeNull()
    expect(quietPeriodWarning(db, TODAY)).toBeNull()
  })

  it('ignores work that is finished', () => {
    addProject({ due: '2026-12-31', status: 'completed' })
    expect(runwayWeeks(db, TODAY)).toBeNull()
  })

  it('warns only below the threshold', () => {
    addProject({ due: '2026-06-29' })

    updateSettings(db, { quietPeriodWeeks: 4 })
    expect(quietPeriodWarning(db, TODAY)).toBeNull()

    updateSettings(db, { quietPeriodWeeks: 6 })
    expect(quietPeriodWarning(db, TODAY)?.weeks).toBe(4)
  })

  it('can be turned off entirely', () => {
    // Somebody on one long retainer has no pipeline to measure.
    addProject({ due: '2026-06-08' })
    updateSettings(db, { quietPeriodWeeks: 0 })

    expect(quietPeriodWarning(db, TODAY)).toBeNull()
  })

  it('appears once rather than every day', () => {
    addProject({ due: '2026-06-08' })
    updateSettings(db, { quietPeriodWeeks: 4 })

    expect(checkQuietPeriod(db, TODAY)).toBe(true)
    expect(checkQuietPeriod(db, TODAY)).toBe(false)
    expect(listNotifications(db, {})).toHaveLength(1)
  })

  it('speaks generally until it has enough history to be specific', () => {
    addProject({ due: '2026-06-08' })
    updateSettings(db, { quietPeriodWeeks: 4 })

    expect(quietPeriodWarning(db, TODAY)!.body).toContain('usually take several weeks')
  })

  it('quotes the user’s own figure once there is enough of it', () => {
    // "Six weeks" about freelancers in general is advice. "Six weeks, for
    // you, measured" is a fact, and the wording says which it is.
    const history: [string, string][] = [
      ['2026-01-01', '2026-02-12'],
      ['2026-01-05', '2026-02-16'],
      ['2026-02-01', '2026-03-15']
    ]

    for (const [first, started] of history) {
      db.run(
        `INSERT INTO clients (name, folder, interested_at, became_active_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [`C${first}`, `Clients\\C${first}`, first, started]
      )
    }

    expect(typicalLeadWeeks(db)).toBe(6)

    addProject({ due: '2026-06-08' })
    updateSettings(db, { quietPeriodWeeks: 4 })
    expect(quietPeriodWarning(db, TODAY)!.body).toContain('Your last few clients took about 6')
  })

  it('needs more than a couple of clients before claiming a pattern', () => {
    // A median of two is one person's story.
    db.run(
      `INSERT INTO clients (name, folder, interested_at, became_active_at, created_at, updated_at)
       VALUES ('A', 'Clients\\A', '2026-01-01', '2026-02-12', datetime('now'), datetime('now'))`
    )
    expect(typicalLeadWeeks(db)).toBeNull()
  })
})

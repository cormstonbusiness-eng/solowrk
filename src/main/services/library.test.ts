import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const {
  archiveLibraryAsset,
  caseStudyFromProject,
  createLibraryAsset,
  listLibrary,
  updateLibraryAsset
} = await import('./library')

/**
 * The library, and the case study it drafts from a finished job.
 *
 * The prefill gets most of the attention here, because it is the one thing in
 * this file that writes claims about a named client. Everything it states has
 * to be something the workspace actually recorded.
 */

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

/** A client, a project, and optionally some tracked time against it. */
function seedProject(options: { hours?: number; dates?: [string, string] } = {}): number {
  db.run(
    `INSERT INTO clients (name, folder, created_at, updated_at)
     VALUES ('Harding & Co', 'Clients\\Harding', datetime('now'), datetime('now'))`
  )
  db.run(
    `INSERT INTO projects (client_id, name, folder, starts_on, due_on, created_at, updated_at)
     VALUES (1, 'Riverside barn conversion', 'Clients\\Harding\\Riverside',
             '2026-01-05', '2026-02-20', datetime('now'), datetime('now'))`
  )

  if (options.hours) {
    const [from, to] = options.dates ?? ['2026-01-07', '2026-03-14']
    for (const [day, seconds] of [
      [from, options.hours * 3600 - 3600],
      [to, 3600]
    ] as const) {
      db.run(
        `INSERT INTO time_entries (project_id, started_at, ended_at, duration, billable, rate, created_at, updated_at)
         VALUES (1, ?, ?, ?, 1, 6500, datetime('now'), datetime('now'))`,
        [`${day}T09:00:00`, `${day}T17:00:00`, seconds]
      )
    }
  }

  return 1
}

describe('the library', () => {
  it('holds four different things in one grid', () => {
    createLibraryAsset(db, { type: 'swipe', title: 'A good landing page' })
    createLibraryAsset(db, { type: 'testimonial', title: 'Harding' })

    expect(listLibrary(db)).toHaveLength(2)
    expect(listLibrary(db, { type: 'swipe' }).map((one) => one.title)).toEqual([
      'A good landing page'
    ])
  })

  it('searches the body and the tags, not just the title', () => {
    // Somebody hunting a testimonial remembers what the client said, not what
    // they called the row.
    createLibraryAsset(db, {
      type: 'testimonial',
      title: 'Untitled',
      body: 'Turned it round in a week.',
      tags: 'planning'
    })

    expect(listLibrary(db, { search: 'round in a week' })).toHaveLength(1)
    expect(listLibrary(db, { search: 'planning' })).toHaveLength(1)
    expect(listLibrary(db, { search: 'nothing like this' })).toHaveLength(0)
  })

  it('holds permission to use a testimonial explicitly', () => {
    // Quoting a client without asking is something somebody does once, so it
    // is a field rather than an assumption.
    const asset = createLibraryAsset(db, { type: 'testimonial', title: 'Harding' })
    expect(asset.mayUse).toBe(false)

    expect(updateLibraryAsset(db, asset.id, { mayUse: true }).mayUse).toBe(true)
    expect(updateLibraryAsset(db, asset.id, { mayUse: false }).mayUse).toBe(false)
  })

  it('hides an archived item without losing it', () => {
    const asset = createLibraryAsset(db, { type: 'swipe', title: 'Old' })
    archiveLibraryAsset(db, asset.id)

    expect(listLibrary(db)).toHaveLength(0)
    expect(listLibrary(db, { includeArchived: true })).toHaveLength(1)
  })

  it('carries the client and project names through for the card to show', () => {
    seedProject()
    const asset = createLibraryAsset(db, {
      type: 'case_study',
      title: 'Riverside',
      clientId: 1,
      sourceProjectId: 1
    })

    expect(asset.clientName).toBe('Harding & Co')
    expect(asset.projectName).toBe('Riverside barn conversion')
  })
})

describe('drafting a case study from a project', () => {
  it('names it after the client and the job', () => {
    seedProject()
    expect(caseStudyFromProject(db, 1).title).toBe('Harding & Co — Riverside barn conversion')
  })

  it('states the dates the work really ran, not the ones that were planned', () => {
    // The project was due 20 February and the last time entry is 14 March. A
    // case study claiming it finished on time would be a false statement
    // about a named client.
    seedProject({ hours: 40, dates: ['2026-01-07', '2026-03-14'] })
    const draft = caseStudyFromProject(db, 1)

    expect(draft.body).toContain('**Ran.** 2026-01-07 to 2026-03-14')
    expect(draft.body).not.toContain('2026-02-20')
  })

  it('falls back to the planned dates, and says they are a plan', () => {
    seedProject()
    const draft = caseStudyFromProject(db, 1)

    expect(draft.body).toContain('**Planned.** 2026-01-05 to 2026-02-20')
    expect(draft.body).not.toContain('**Ran.**')
  })

  it('states the hours actually tracked', () => {
    seedProject({ hours: 40 })
    expect(caseStudyFromProject(db, 1).body).toContain('**Time on it.** 40 hours')
  })

  it('says nothing about time when none was tracked', () => {
    seedProject()
    expect(caseStudyFromProject(db, 1).body).not.toContain('Time on it')
  })

  it('lists what was finished, and only what was finished', () => {
    seedProject()
    db.run(
      `INSERT INTO tasks (project_id, title, status, created_at, updated_at)
       VALUES (1, 'Measured survey', 'done', datetime('now'), datetime('now')),
              (1, 'Planning drawings', 'done', datetime('now'), datetime('now')),
              (1, 'Never happened', 'todo', datetime('now'), datetime('now'))`
    )

    const body = caseStudyFromProject(db, 1).body
    expect(body).toContain('- Measured survey')
    expect(body).toContain('- Planning drawings')
    expect(body).not.toContain('Never happened')
  })

  it('leaves the judgement to the user', () => {
    // The problem, the approach and the outcome are the parts only they can
    // write. A confident guess at any of them would be fiction about a real
    // client, so they arrive as headings with prompts and nothing under them.
    const body = caseStudyFromProject(db, seedProject()).body

    expect(body).toContain('## The problem')
    expect(body).toContain('## What you did')
    expect(body).toContain('## What it was worth')
  })

  it('refuses a project that is not there', () => {
    expect(() => caseStudyFromProject(db, 99)).toThrow(/No project/)
  })
})

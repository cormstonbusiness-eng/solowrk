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
const { listClients } = await import('./clients')
const { migrateLeadsToClients, resetLeadMigration } = await import('./leadMigration')

/**
 * Moving the pipeline out of Marketing.
 *
 * The promise made when this was specified was that nothing is lost, and that
 * is what these check. A migration somebody did not ask for, that quietly
 * drops where a lead came from or makes a second copy of a client every time
 * the app starts, is worse than leaving the pipeline where it was.
 */

let db: InstanceType<typeof Database>
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'solo-leadmig-'))
  await scaffoldWorkspace(root)
  db = new Database(':memory:')
  resetLeadMigration()
})

afterEach(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})

function addLead(fields: Record<string, string | null> = {}): void {
  const row = {
    name: 'Jane Powell',
    company: 'Northgate Studio',
    email: 'jane@northgate.co.uk',
    phone: '0113 496 0000',
    source: 'Referral',
    stage: 'contacted',
    notes: '',
    lost_reason: null,
    lost_note: '',
    ...fields
  }

  db.run(
    `INSERT INTO leads (name, company, email, phone, source, stage, notes,
                        lost_reason, lost_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      row.name,
      row.company,
      row.email,
      row.phone,
      row.source,
      row.stage,
      row.notes,
      row.lost_reason,
      row.lost_note
    ]
  )
}

describe('every lead becomes a client', () => {
  it('takes the details rather than asking for them again', async () => {
    addLead()
    await migrateLeadsToClients(db, root)

    expect(listClients(db)[0]).toMatchObject({
      name: 'Northgate Studio',
      contactName: 'Jane Powell',
      email: 'jane@northgate.co.uk',
      phone: '0113 496 0000'
    })
  })

  it('falls back to the person when there is no company', async () => {
    addLead({ company: '' })
    await migrateLeadsToClients(db, root)

    expect(listClients(db)[0]?.name).toBe('Jane Powell')
  })

  it('maps each pipeline stage to where somebody actually stands', async () => {
    for (const stage of ['lead', 'contacted', 'conversation', 'proposal', 'won', 'lost']) {
      addLead({ stage, company: stage })
    }

    await migrateLeadsToClients(db, root)

    const stages = Object.fromEntries(
      listClients(db).map((client) => [client.name, client.relationshipStage])
    )

    expect(stages).toEqual({
      lead: 'lead',
      // Three collapse into one, and that is not information lost: all three
      // mean "talking, not decided", and which was true is in the lead's own
      // event history. A stage is where somebody stands, not how they got there.
      contacted: 'prospect',
      conversation: 'prospect',
      proposal: 'prospect',
      won: 'active',
      lost: 'former'
    })
  })
})

describe('what it refuses to lose', () => {
  it('keeps where the lead came from', async () => {
    // The single most useful thing on a lead — it is the beginning of knowing
    // what works — and a client has no column for it.
    addLead({ source: 'Referral from Halden' })
    await migrateLeadsToClients(db, root)

    expect(listClients(db)[0]?.notes).toContain('Referral from Halden')
  })

  it('keeps why a lead was lost', async () => {
    addLead({ stage: 'lost', lost_reason: 'price', lost_note: 'Went with someone cheaper' })
    await migrateLeadsToClients(db, root)

    const notes = listClients(db)[0]?.notes ?? ''
    expect(notes).toContain('price')
    expect(notes).toContain('Went with someone cheaper')
  })

  it('keeps the notes already written on it', async () => {
    addLead({ notes: 'Met at the Leeds meetup.' })
    await migrateLeadsToClients(db, root)

    expect(listClients(db)[0]?.notes).toContain('Met at the Leeds meetup.')
  })

  it('keeps the lead itself, linked', async () => {
    // It is the record of how that client arrived, and it is what stops this
    // running a second time.
    addLead()
    await migrateLeadsToClients(db, root)

    const lead = db.get<{ client_id: number | null }>('SELECT client_id FROM leads')
    expect(lead?.client_id).toBe(listClients(db)[0]?.id)
  })
})

describe('running it again', () => {
  it('does nothing the second time', async () => {
    // It runs on every workspace open. Making a second client each time would
    // turn one lead into a hundred over a fortnight.
    addLead()

    expect(await migrateLeadsToClients(db, root)).toBe(1)
    expect(await migrateLeadsToClients(db, root)).toBe(0)
    expect(listClients(db)).toHaveLength(1)
  })

  it('leaves a lead that was already won by hand alone', async () => {
    // `winLead` made a client before this existed. Converting it again would
    // give somebody two records of the same person.
    addLead({ stage: 'won' })
    await migrateLeadsToClients(db, root)

    expect(await migrateLeadsToClients(db, root)).toBe(0)
    expect(listClients(db)).toHaveLength(1)
  })

  it('ignores a lead that was deleted', async () => {
    addLead()
    db.run('UPDATE leads SET archived = 1')

    expect(await migrateLeadsToClients(db, root)).toBe(0)
    expect(listClients(db)).toHaveLength(0)
  })
})

describe('two of them at once', () => {
  it('makes one client, not two', async () => {
    /**
     * The bug this caught, on a real workspace.
     *
     * `workspace:status` reaches `restore()`, React runs its effects twice in
     * development, and both calls entered `open()` and suspended at the first
     * `await`. Both then read the same unconverted lead and both created a
     * client from it. One lead, two clients, and the only sign was the log
     * line appearing twice.
     *
     * `open()` serialises now, which is the real fix. This holds the
     * conversion itself to the same promise, because the next thing to call it
     * concurrently will not be `open()`.
     */
    addLead()

    await Promise.all([
      migrateLeadsToClients(db, root),
      migrateLeadsToClients(db, root)
    ])

    expect(listClients(db)).toHaveLength(1)
    expect(db.get<{ client_id: number | null }>('SELECT client_id FROM leads')?.client_id).toBe(
      listClients(db)[0]?.id
    )
  })
})

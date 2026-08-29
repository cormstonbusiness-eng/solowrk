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
const { createClient, getClient, listClients, updateClient } = await import('./clients')
const { createGoal, listGoals } = await import('./goals')

type Db = InstanceType<typeof Database>

let db: Db
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'solo-clients-'))
  await scaffoldWorkspace(root)
  db = new Database(':memory:')
})

afterEach(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})

/** Backdate a stamp, to put a transition in a past period. */
function backdate(column: string, id: number, day: string): void {
  db.run(`UPDATE clients SET ${column} = ? WHERE id = ?`, [`${day} 12:00:00`, id])
}

describe('a client’s relationship stage', () => {
  it('defaults a new client to active', async () => {
    const client = await createClient(db, root, { name: 'Acme' })
    expect(client.relationshipStage).toBe('active')
    expect(client.becameActiveAt).not.toBeNull()
  })

  it('records when somebody became a prospect, and not that they are active', async () => {
    const client = await createClient(db, root, { name: 'Acme', relationshipStage: 'prospect' })
    expect(client.relationshipStage).toBe('prospect')
    expect(client.interestedAt).not.toBeNull()
    expect(client.becameActiveAt).toBeNull()
  })

  it('stamps the transition when a lead is won', async () => {
    const lead = await createClient(db, root, { name: 'Acme', relationshipStage: 'prospect' })
    expect(lead.becameActiveAt).toBeNull()

    const won = await updateClient(db, root, lead.id, { relationshipStage: 'active' })
    expect(won.relationshipStage).toBe('active')
    expect(won.becameActiveAt).not.toBeNull()
    // The lead stamp survives, so the period they enquired in still counts them.
    expect(won.interestedAt).toBe(lead.interestedAt)
  })

  it('never moves a stamp once it is set', async () => {
    // The stamps are what the goals count. A client cycling active → past →
    // active must not be counted as a new client twice.
    const client = await createClient(db, root, { name: 'Acme' })
    const first = client.becameActiveAt

    await updateClient(db, root, client.id, { relationshipStage: 'dormant' })
    const back = await updateClient(db, root, client.id, { relationshipStage: 'active' })

    expect(back.becameActiveAt).toBe(first)
  })

  it('saves the stage at all', async () => {
    // The boolean this replaced was missing from the update map entirely, so
    // the toggle in the client editor silently never saved.
    const client = await createClient(db, root, { name: 'Acme' })
    await updateClient(db, root, client.id, { relationshipStage: 'former' })
    expect(getClient(db, client.id).relationshipStage).toBe('former')
  })

  it('keeps every stage in the directory', async () => {
    await createClient(db, root, { name: 'A', relationshipStage: 'active' })
    await createClient(db, root, { name: 'B', relationshipStage: 'prospect' })
    await createClient(db, root, { name: 'C', relationshipStage: 'former' })

    // A client who said no is still a contact worth having the details of.
    expect(listClients(db)).toHaveLength(3)
  })
})

describe('goals count the right clients', () => {
  const thisYear = new Date().getFullYear()
  const period = { period: 'year' as const, target: 5 }

  it('counts only clients who became active, not every row created', async () => {
    await createClient(db, root, { name: 'Won', relationshipStage: 'active' })
    await createClient(db, root, { name: 'Still deciding', relationshipStage: 'prospect' })
    await createClient(db, root, { name: 'Said no', relationshipStage: 'former' })

    createGoal(db, { name: 'New clients', kind: 'clients', ...period })
    const [goal] = listGoals(db)

    // Two of the three were never clients. Counting rows created would say 3
    // and make the goal meaningless.
    expect(goal!.current).toBe(1)
  })

  it('credits a won lead to the period it was won in, not created in', async () => {
    const lead = await createClient(db, root, { name: 'Slow burner', relationshipStage: 'prospect' })
    backdate('interested_at', lead.id, `${thisYear - 1}-01-15`)
    await updateClient(db, root, lead.id, { relationshipStage: 'active' })

    createGoal(db, { name: 'New clients', kind: 'clients', ...period })
    expect(listGoals(db)[0]!.current).toBe(1)
  })

  it('does not count a client won in an earlier period', async () => {
    const client = await createClient(db, root, { name: 'Old', relationshipStage: 'active' })
    backdate('became_active_at', client.id, `${thisYear - 2}-06-01`)

    createGoal(db, { name: 'New clients', kind: 'clients', ...period })
    expect(listGoals(db)[0]!.current).toBe(0)
  })

  it('counts leads separately from clients', async () => {
    await createClient(db, root, { name: 'Lead one', relationshipStage: 'prospect' })
    await createClient(db, root, { name: 'Lead two', relationshipStage: 'prospect' })
    await createClient(db, root, { name: 'Straight in', relationshipStage: 'active' })

    createGoal(db, { name: 'Interested', kind: 'leads', ...period })
    const [leads] = listGoals(db)

    // The client added straight in as active was never a lead.
    expect(leads!.current).toBe(2)
  })

  it('still counts a lead that has since been won or turned down', async () => {
    // Otherwise a good quarter's lead count shrinks as those leads convert,
    // which reads as the number going backwards for doing well.
    const won = await createClient(db, root, { name: 'Won', relationshipStage: 'prospect' })
    const lost = await createClient(db, root, { name: 'Lost', relationshipStage: 'prospect' })

    await updateClient(db, root, won.id, { relationshipStage: 'active' })
    await updateClient(db, root, lost.id, { relationshipStage: 'former' })

    createGoal(db, { name: 'Interested', kind: 'leads', ...period })
    expect(listGoals(db)[0]!.current).toBe(2)
  })

  it('counts a won lead towards both goals', async () => {
    const lead = await createClient(db, root, { name: 'Acme', relationshipStage: 'prospect' })
    await updateClient(db, root, lead.id, { relationshipStage: 'active' })

    createGoal(db, { name: 'Clients', kind: 'clients', ...period })
    createGoal(db, { name: 'Leads', kind: 'leads', ...period })

    const goals = listGoals(db)
    expect(goals.find((goal) => goal.kind === 'clients')!.current).toBe(1)
    expect(goals.find((goal) => goal.kind === 'leads')!.current).toBe(1)
  })
})

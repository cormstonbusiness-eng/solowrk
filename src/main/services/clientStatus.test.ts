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

describe('client status', () => {
  it('defaults a new client to active', async () => {
    const client = await createClient(db, root, { name: 'Acme' })
    expect(client.status).toBe('active')
    expect(client.becameActiveAt).not.toBeNull()
  })

  it('records when a lead was marked interested, and not that they are active', async () => {
    const client = await createClient(db, root, { name: 'Acme', status: 'interested' })
    expect(client.status).toBe('interested')
    expect(client.interestedAt).not.toBeNull()
    expect(client.becameActiveAt).toBeNull()
  })

  it('stamps the transition when a lead is won', async () => {
    const lead = await createClient(db, root, { name: 'Acme', status: 'interested' })
    expect(lead.becameActiveAt).toBeNull()

    const won = await updateClient(db, root, lead.id, { status: 'active' })
    expect(won.status).toBe('active')
    expect(won.becameActiveAt).not.toBeNull()
    // The lead stamp survives, so the period they enquired in still counts them.
    expect(won.interestedAt).toBe(lead.interestedAt)
  })

  it('never moves a stamp once it is set', async () => {
    // The stamps are what the goals count. A client cycling active → past →
    // active must not be counted as a new client twice.
    const client = await createClient(db, root, { name: 'Acme' })
    const first = client.becameActiveAt

    await updateClient(db, root, client.id, { status: 'past' })
    const back = await updateClient(db, root, client.id, { status: 'active' })

    expect(back.becameActiveAt).toBe(first)
  })

  it('saves the status at all', async () => {
    // The boolean this replaced was missing from the update map entirely, so
    // the toggle in the client editor silently never saved.
    const client = await createClient(db, root, { name: 'Acme' })
    await updateClient(db, root, client.id, { status: 'not_interested' })
    expect(getClient(db, client.id).status).toBe('not_interested')
  })

  it('keeps every status in the directory', async () => {
    await createClient(db, root, { name: 'A', status: 'active' })
    await createClient(db, root, { name: 'B', status: 'interested' })
    await createClient(db, root, { name: 'C', status: 'not_interested' })

    // A client who said no is still a contact worth having the details of.
    expect(listClients(db)).toHaveLength(3)
  })
})

describe('goals count the right clients', () => {
  const thisYear = new Date().getFullYear()
  const period = { period: 'year' as const, target: 5 }

  it('counts only clients who became active, not every row created', async () => {
    await createClient(db, root, { name: 'Won', status: 'active' })
    await createClient(db, root, { name: 'Still deciding', status: 'interested' })
    await createClient(db, root, { name: 'Said no', status: 'not_interested' })

    createGoal(db, { name: 'New clients', kind: 'clients', ...period })
    const [goal] = listGoals(db)

    // Two of the three were never clients. Counting rows created would say 3
    // and make the goal meaningless.
    expect(goal!.current).toBe(1)
  })

  it('credits a won lead to the period it was won in, not created in', async () => {
    const lead = await createClient(db, root, { name: 'Slow burner', status: 'interested' })
    backdate('interested_at', lead.id, `${thisYear - 1}-01-15`)
    await updateClient(db, root, lead.id, { status: 'active' })

    createGoal(db, { name: 'New clients', kind: 'clients', ...period })
    expect(listGoals(db)[0]!.current).toBe(1)
  })

  it('does not count a client won in an earlier period', async () => {
    const client = await createClient(db, root, { name: 'Old', status: 'active' })
    backdate('became_active_at', client.id, `${thisYear - 2}-06-01`)

    createGoal(db, { name: 'New clients', kind: 'clients', ...period })
    expect(listGoals(db)[0]!.current).toBe(0)
  })

  it('counts leads separately from clients', async () => {
    await createClient(db, root, { name: 'Lead one', status: 'interested' })
    await createClient(db, root, { name: 'Lead two', status: 'interested' })
    await createClient(db, root, { name: 'Straight in', status: 'active' })

    createGoal(db, { name: 'Interested', kind: 'leads', ...period })
    const [leads] = listGoals(db)

    // The client added straight in as active was never a lead.
    expect(leads!.current).toBe(2)
  })

  it('still counts a lead that has since been won or turned down', async () => {
    // Otherwise a good quarter's lead count shrinks as those leads convert,
    // which reads as the number going backwards for doing well.
    const won = await createClient(db, root, { name: 'Won', status: 'interested' })
    const lost = await createClient(db, root, { name: 'Lost', status: 'interested' })

    await updateClient(db, root, won.id, { status: 'active' })
    await updateClient(db, root, lost.id, { status: 'not_interested' })

    createGoal(db, { name: 'Interested', kind: 'leads', ...period })
    expect(listGoals(db)[0]!.current).toBe(2)
  })

  it('counts a won lead towards both goals', async () => {
    const lead = await createClient(db, root, { name: 'Acme', status: 'interested' })
    await updateClient(db, root, lead.id, { status: 'active' })

    createGoal(db, { name: 'Clients', kind: 'clients', ...period })
    createGoal(db, { name: 'Leads', kind: 'leads', ...period })

    const goals = listGoals(db)
    expect(goals.find((goal) => goal.kind === 'clients')!.current).toBe(1)
    expect(goals.find((goal) => goal.kind === 'leads')!.current).toBe(1)
  })
})

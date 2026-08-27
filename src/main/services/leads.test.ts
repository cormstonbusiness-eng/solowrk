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
const {
  createLead,
  deleteLead,
  leadsNeedingAttention,
  listLeads,
  moveLead,
  pipelineReport,
  updateLead,
  winLead
} = await import('./leads')

/**
 * The lead pipeline against a real database.
 *
 * `@shared/pipeline.test.ts` proves the arithmetic. This proves the parts that
 * touch state: that moving a lead records where it has been, that winning one
 * does not make two clients, and that dragging a lost lead back onto the board
 * really does make it live again.
 */

const TODAY = '2026-08-24'

describe('the board', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('puts a new lead at the end of its column', () => {
    // A new lead should not jump the queue of things somebody has ordered.
    const first = createLead(db, { name: 'A' })
    const second = createLead(db, { name: 'B' })

    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('flags a lead with nothing planned', () => {
    createLead(db, { name: 'Adrift' })
    createLead(db, { name: 'Planned', nextAction: 'Call', nextActionOn: '2026-09-01' })

    const leads = listLeads(db, TODAY)
    expect(leads.find((one) => one.name === 'Adrift')!.health).toBe('adrift')
    expect(leads.find((one) => one.name === 'Planned')!.health).toBe('scheduled')
  })

  it('records every stage a lead passes through', () => {
    // Without this a lead that went lead → proposal → lost is
    // indistinguishable from one that was never contacted.
    const lead = createLead(db, { name: 'A' })
    moveLead(db, lead.id, 'contacted')
    moveLead(db, lead.id, 'proposal')

    const stages = db
      .all<{ stage: string }>('SELECT stage FROM lead_events WHERE lead_id = ? ORDER BY id', [
        lead.id
      ])
      .map((row) => row.stage)

    expect(stages).toEqual(['lead', 'contacted', 'proposal'])
  })

  it('does not record a move that was not a move', () => {
    const lead = createLead(db, { name: 'A' })
    moveLead(db, lead.id, 'lead')

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM lead_events')!.n).toBe(1)
  })

  it('stamps the day a lead closed', () => {
    const lead = createLead(db, { name: 'A' })
    expect(moveLead(db, lead.id, 'lost', { lostReason: 'price' }).closedAt).not.toBeNull()
  })

  it('does not move the date when a closed lead is saved again', () => {
    const lead = createLead(db, { name: 'A' })
    const lost = moveLead(db, lead.id, 'lost', { lostReason: 'price' })

    db.run("UPDATE leads SET closed_at = '2026-01-01' WHERE id = ?", [lead.id])
    const again = moveLead(db, lead.id, 'lost', { lostNote: 'They said so again' })

    expect(again.closedAt).toBe('2026-01-01')
    expect(lost.closedAt).not.toBeNull()
  })

  it('makes a lead live again when it is dragged back onto the board', () => {
    // Leaving "too expensive" attached would put it in the lost breakdown
    // while somebody is still working on it.
    const lead = createLead(db, { name: 'A' })
    moveLead(db, lead.id, 'lost', { lostReason: 'price', lostNote: 'Too dear' })

    const back = moveLead(db, lead.id, 'conversation')

    expect(back.closedAt).toBeNull()
    expect(back.lostReason).toBeNull()
    expect(back.lostNote).toBe('')
  })

  it('gives a lost lead a reason even when none was chosen', () => {
    const lead = createLead(db, { name: 'A' })
    expect(moveLead(db, lead.id, 'lost').lostReason).toBe('other')
  })

  it('routes a stage change through the move rules', () => {
    // Otherwise a lead could reach `won` without ever being recorded as
    // having got there.
    const lead = createLead(db, { name: 'A' })
    updateLead(db, lead.id, { stage: 'proposal', company: 'Northgate' })

    const stages = db
      .all<{ stage: string }>('SELECT stage FROM lead_events WHERE lead_id = ?', [lead.id])
      .map((row) => row.stage)

    expect(stages).toContain('proposal')
    expect(listLeads(db, TODAY)[0]!.company).toBe('Northgate')
  })

  it('hides a deleted lead without losing it', () => {
    const lead = createLead(db, { name: 'A' })
    deleteLead(db, lead.id)

    expect(listLeads(db, TODAY)).toHaveLength(0)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM leads')!.n).toBe(1)
  })
})

describe('winning one', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-leads-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('makes a client out of the lead s own details', () => {
    // Somebody who has just won work should not have to retype the name they
    // have been looking at for three weeks.
    const lead = createLead(db, {
      name: 'Jane Powell',
      company: 'Northgate Studio',
      email: 'jane@northgate.co.uk',
      phone: '0113 496 0000'
    })

    return winLead(db, root, lead.id).then(({ clientId }) => {
      const client = db.get<{ name: string; contact_name: string; email: string }>(
        'SELECT name, contact_name, email FROM clients WHERE id = ?',
        [clientId]
      )!

      expect(client).toMatchObject({
        name: 'Northgate Studio',
        contact_name: 'Jane Powell',
        email: 'jane@northgate.co.uk'
      })
    })
  })

  it('falls back to the person s name when there is no company', () => {
    const lead = createLead(db, { name: 'Jane Powell' })

    return winLead(db, root, lead.id).then(({ clientId }) => {
      expect(db.get<{ name: string }>('SELECT name FROM clients WHERE id = ?', [clientId])!.name).toBe(
        'Jane Powell'
      )
    })
  })

  it('does not make a second client when it is won twice', async () => {
    const lead = createLead(db, { name: 'Jane', company: 'Northgate' })

    const first = await winLead(db, root, lead.id)
    const second = await winLead(db, root, lead.id)

    expect(second.clientId).toBe(first.clientId)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM clients')!.n).toBe(1)
  })

  it('keeps the lead rather than consuming it', async () => {
    // It is the record of how that client arrived, and the only thing the
    // source report is built from.
    const lead = createLead(db, { name: 'Jane', company: 'Northgate', source: 'Referral' })
    await winLead(db, root, lead.id)

    const report = pipelineReport(db, TODAY)
    expect(report.sources[0]).toMatchObject({ source: 'Referral', won: 1 })
  })
})

describe('what needs attention', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('puts the unplanned ones above the late ones', () => {
    createLead(db, { name: 'Late', nextAction: 'Call', nextActionOn: '2026-08-01' })
    createLead(db, { name: 'Adrift' })
    createLead(db, { name: 'Fine', nextAction: 'Call', nextActionOn: '2026-12-01' })

    expect(leadsNeedingAttention(db, TODAY).map((one) => one.name)).toEqual(['Adrift', 'Late'])
  })

  it('leaves a closed lead alone', () => {
    const lead = createLead(db, { name: 'Won' })
    moveLead(db, lead.id, 'won')

    expect(leadsNeedingAttention(db, TODAY)).toHaveLength(0)
  })
})

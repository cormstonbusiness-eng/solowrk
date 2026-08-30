import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { campaignReturns, channelConsistency, clientsByChannel, marketingResults, spendAgainstBudget } =
  await import('./results')
const { recordCampaignMetric } = await import('./metrics')
const { createChannel, updateChannel, updatePlan } = await import('./channels')
const { createContent, updateContent } = await import('./content')

/**
 * What actually worked.
 *
 * Every number on this page is one a freelancer will believe without
 * checking, which is exactly why the tests are about the ways a query can be
 * quietly wrong: a join that multiplies, a period that clips revenue it
 * should not, a tracker built on promises rather than on what went out.
 */

const FROM = '2026-01-01'
const TO = '2026-12-31'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

function addClient(name: string, options: { channelId?: number; campaignId?: number; on?: string } = {}): number {
  db.run(
    `INSERT INTO clients (name, folder, source_channel_id, source_campaign_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      name,
      `Clients\\${name}`,
      options.channelId ?? null,
      options.campaignId ?? null,
      `${options.on ?? '2026-03-01'} 09:00:00`
    ]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function addPaidInvoice(clientId: number, gross: number, issued = '2026-04-01'): void {
  db.run(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, paid_at, gross, created_at, updated_at)
     VALUES (?, ?, 'paid', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [`INV-${Math.random().toString(36).slice(2, 8)}`, clientId, issued, issued, issued, gross]
  )
}

function addCampaign(name: string, budget = 0): number {
  db.run(
    `INSERT INTO marketing_campaigns (name, budget, folder, created_at, updated_at)
     VALUES (?, ?, '', datetime('now'), datetime('now'))`,
    [name, budget]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

describe('where clients came from', () => {
  it('counts clients against the channel they were attributed to', () => {
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const referrals = createChannel(db, { name: 'Referrals' }).id

    addClient('A', { channelId: linkedin })
    addClient('B', { channelId: linkedin })
    addClient('C', { channelId: referrals })

    const rows = clientsByChannel(db, FROM, TO)
    expect(rows.find((r) => r.channelId === linkedin)?.clients).toBe(2)
    expect(rows.find((r) => r.channelId === referrals)?.clients).toBe(1)
  })

  it('does not multiply the client count by the number of invoices', () => {
    // The classic failure: joining clients and invoices in one query reports
    // one client with three invoices as three clients.
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const client = addClient('A', { channelId: linkedin })
    addPaidInvoice(client, 10_000)
    addPaidInvoice(client, 20_000)
    addPaidInvoice(client, 30_000)

    const row = clientsByChannel(db, FROM, TO)[0]!
    expect(row.clients).toBe(1)
    expect(row.revenue).toBe(60_000)
  })

  it('counts only money actually received', () => {
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const client = addClient('A', { channelId: linkedin })
    addPaidInvoice(client, 10_000)
    db.run(
      `INSERT INTO invoices (number, client_id, status, issue_date, due_date, gross, created_at, updated_at)
       VALUES ('INV-DRAFT', ?, 'draft', '2026-04-01', '2026-05-01', 99_000, datetime('now'), datetime('now'))`,
      [client]
    )

    expect(clientsByChannel(db, FROM, TO)[0]!.revenue).toBe(10_000)
  })

  it('keeps revenue earned after the period, for a client won inside it', () => {
    // The period bounds who counts, not what they are worth. A client won in
    // March who is still paying in November is exactly what makes a channel
    // worth doing, and clipping them would make every channel look worse the
    // more recently it worked.
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    const client = addClient('A', { channelId: linkedin, on: '2026-03-01' })
    addPaidInvoice(client, 50_000, '2027-06-01')

    expect(clientsByChannel(db, FROM, TO)[0]!.revenue).toBe(50_000)
  })

  it('leaves out a client won outside the period', () => {
    const linkedin = createChannel(db, { name: 'LinkedIn' }).id
    addClient('Old', { channelId: linkedin, on: '2024-01-01' })

    expect(clientsByChannel(db, FROM, TO)).toEqual([])
  })

  it('says nothing about a channel nobody came from', () => {
    // An empty bar is worse than no bar. §8.3.
    createChannel(db, { name: 'LinkedIn' })
    expect(clientsByChannel(db, FROM, TO)).toEqual([])
  })
})

describe('campaign returns', () => {
  it('adds up spend and enquiries across readings', () => {
    const id = addCampaign('Spring push', 100_000)
    recordCampaignMetric(db, id, { spend: 20_000, enquiries: 3, recordedOn: '2026-03-01' })
    recordCampaignMetric(db, id, { spend: 30_000, enquiries: 2, recordedOn: '2026-04-01' })

    const row = campaignReturns(db, FROM, TO)[0]!
    expect(row.spend).toBe(50_000)
    expect(row.enquiries).toBe(5)
  })

  it('works out cost per enquiry, and says nothing when there were none', () => {
    const id = addCampaign('Spring push')
    recordCampaignMetric(db, id, { spend: 30_000, enquiries: 3 })
    expect(campaignReturns(db, FROM, TO)[0]!.costPerEnquiry).toBe(10_000)

    const quiet = addCampaign('Quiet one')
    recordCampaignMetric(db, quiet, { spend: 10_000 })
    expect(campaignReturns(db, FROM, TO).find((r) => r.campaignId === quiet)!.costPerEnquiry).toBeNull()
  })

  it('reports no ratio for a campaign that cost nothing', () => {
    // Null rather than infinity: a campaign that spent nothing and won a
    // client has no meaningful ratio, and printing one would put a nonsense
    // number at the top of a table sorted by it.
    const id = addCampaign('Free one')
    const client = addClient('A', { campaignId: id })
    addPaidInvoice(client, 40_000)

    const row = campaignReturns(db, FROM, TO)[0]!
    expect(row.ratio).toBeNull()
    expect(row.revenue).toBe(40_000)
  })

  it('sorts by return, with the unmeasurable ones last', () => {
    const good = addCampaign('Good')
    recordCampaignMetric(db, good, { spend: 10_000 })
    addPaidInvoice(addClient('A', { campaignId: good }), 100_000)

    const poor = addCampaign('Poor')
    recordCampaignMetric(db, poor, { spend: 50_000 })

    addCampaign('No spend')

    expect(campaignReturns(db, FROM, TO).map((r) => r.name)).toEqual(['Good', 'Poor', 'No spend'])
  })
})

describe('spend against budget', () => {
  it('reports what is left of the year', () => {
    updatePlan(db, { annualBudget: 120_000 })
    const id = addCampaign('Spring push')
    recordCampaignMetric(db, id, { spend: 45_000, recordedOn: '2026-03-01' })

    expect(spendAgainstBudget(db, FROM, TO)).toEqual({
      budget: 120_000,
      spent: 45_000,
      remaining: 75_000
    })
  })

  it('goes negative rather than clamping when a budget is blown', () => {
    // Somebody £20 over needs to see that, not a bar sitting flat at zero.
    updatePlan(db, { annualBudget: 10_000 })
    recordCampaignMetric(db, addCampaign('Spring'), { spend: 30_000, recordedOn: '2026-03-01' })

    expect(spendAgainstBudget(db, FROM, TO).remaining).toBe(-20_000)
  })
})

describe('the consistency strip', () => {
  it('counts what went out, not what was promised', () => {
    // A tracker built on scheduled items would show a perfect year to
    // somebody who scheduled everything and posted nothing.
    const channel = createChannel(db, { name: 'LinkedIn', cadenceCount: 1, cadencePeriod: 'week' })
    createContent(db, { channelId: channel.id, title: 'Promised', scheduledFor: '2026-03-02T09:00' })

    const strip = channelConsistency(db, '2026-03-02', '2026-03-08')
    expect(strip[0]!.periods[0]!.fill).toBe('none')
  })

  it('dates an item by when it was due out, not by when the box was ticked', () => {
    /*
      `published_at` is stamped at the moment somebody marks an item
      published, which is very often a Sunday afternoon spent catching up.
      Dating the strip by it would redraw a whole year as one enormous week,
      and show empty months for posts that actually went out in them.
    */
    const channel = createChannel(db, { name: 'LinkedIn', cadenceCount: 1, cadencePeriod: 'week' })
    const item = createContent(db, {
      channelId: channel.id,
      title: 'Went out in March',
      scheduledFor: '2026-03-02T09:00'
    })
    // Ticked today, whenever today is.
    updateContent(db, item.id, { status: 'published' })

    expect(channelConsistency(db, '2026-03-02', '2026-03-08')[0]!.periods[0]!.fill).toBe('met')
  })

  it('fills a period once the commitment is met', () => {
    const channel = createChannel(db, { name: 'LinkedIn', cadenceCount: 1, cadencePeriod: 'week' })
    const item = createContent(db, {
      channelId: channel.id,
      title: 'Out',
      scheduledFor: '2026-03-02T09:00'
    })
    updateContent(db, item.id, { status: 'published' })

    const strip = channelConsistency(db, '2026-03-02', '2026-03-08')
    expect(strip[0]!.periods[0]!.fill).toBe('met')
  })

  it('leaves out a channel that promised nothing', () => {
    // A channel with no commitment cannot be inconsistent, and a row of empty
    // cells against it would read as failure at something nobody undertook.
    createChannel(db, { name: 'Directories', cadenceCount: 0 })
    expect(channelConsistency(db, FROM, TO)).toEqual([])
  })

  it('leaves out a retired channel', () => {
    const channel = createChannel(db, { name: 'LinkedIn', cadenceCount: 2, cadencePeriod: 'week' })
    updateChannel(db, channel.id, { isActive: false })

    expect(channelConsistency(db, FROM, TO)).toEqual([])
  })
})

describe('the empty state', () => {
  it('says the page is empty when there is genuinely nothing', () => {
    // §8.3: one honest line beats four empty charts.
    expect(marketingResults(db, FROM, TO).empty).toBe(true)
  })

  it('is not empty once a single client has been attributed', () => {
    const channel = createChannel(db, { name: 'LinkedIn' })
    addClient('A', { channelId: channel.id })

    expect(marketingResults(db, FROM, TO).empty).toBe(false)
  })

  it('is still empty for a campaign nobody has measured', () => {
    addCampaign('Untouched')
    expect(marketingResults(db, FROM, TO).empty).toBe(true)
  })
})

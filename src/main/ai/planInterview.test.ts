import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { applyFigures, applyToMarketing, marketingFromPlan, prefillAnswers } = await import(
  './planInterview'
)
const { createChannel, getPlan, listChannels, updatePlan } = await import('../services/channels')
const { getSettings, updateSettings } = await import('../services/settings')
const { capacityDefaults } = await import('../services/capacity')

/**
 * What the app can answer for you, and what it does with the plan afterwards.
 *
 * The derivation is the part that can quietly do the wrong thing: it reads a
 * document somebody wrote in prose and proposes changes to a different
 * document they also wrote. Every test here is about it staying a proposal.
 */

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

const PLAN = `# Test — business plan

## Target market

Architecture practices of two to six people who take on more work than they
can draw.

## Marketing and sales

- Word of mouth
- LinkedIn, two posts a week
- A directory listing (paid)

An enquiry becomes a call, then a fixed-fee quote.
`

describe('what the app fills in for you', () => {
  it('offers nothing it does not actually know', () => {
    // A confident wrong prefill is worse than an empty box, because a filled
    // field gets accepted without being read. On a fresh workspace the only
    // thing the app can honestly answer is the rate, which is a real setting
    // even before anybody changes it — it is what invoices bill at.
    expect(prefillAnswers(db)).toEqual({ rate: '£50 an hour' })
  })

  it('says nothing about channels until some exist', () => {
    expect(prefillAnswers(db).channels).toBeUndefined()
  })

  it('takes the rate the user has been invoicing at', () => {
    updateSettings(db, { defaultHourlyRate: 6500 })
    expect(prefillAnswers(db).rate).toBe('£65 an hour')
  })

  it('does not drop the pence off an awkward rate', () => {
    updateSettings(db, { defaultHourlyRate: 6250 })
    expect(prefillAnswers(db).rate).toBe('£62.50 an hour')
  })

  it('lists the channels already set up, one per line', () => {
    createChannel(db, { name: 'LinkedIn' })
    createChannel(db, { name: 'Newsletter' })

    expect(prefillAnswers(db).channels).toBe('LinkedIn\nNewsletter')
  })

  it('says nothing about where you work when no address is set', () => {
    updateSettings(db, { city: 'Chester', postcode: 'CH1 1AA' })
    expect(prefillAnswers(db).location).toBe('Chester, CH1 1AA')

    updateSettings(db, { city: '', postcode: '' })
    expect(prefillAnswers(db).location).toBeUndefined()
  })
})

describe('what the plan tells Marketing', () => {
  it('reads the audience out of the target market section', () => {
    expect(marketingFromPlan(db, PLAN).audience).toContain('Architecture practices')
  })

  it('finds the channels named as a list, not the prose around them', () => {
    // The section ends with a sentence about quotes. A parser that took every
    // line would propose "An enquiry becomes a call" as a channel.
    expect(marketingFromPlan(db, PLAN).newChannels).toEqual([
      'Word of mouth',
      'LinkedIn',
      'A directory listing'
    ])
  })

  it('does not offer a channel that already exists', () => {
    createChannel(db, { name: 'LinkedIn' })
    expect(marketingFromPlan(db, PLAN).newChannels).not.toContain('LinkedIn')
  })

  it('ignores case when deciding what already exists', () => {
    createChannel(db, { name: 'linkedin' })
    expect(marketingFromPlan(db, PLAN).newChannels).not.toContain('LinkedIn')
  })

  it('counts a retired channel as existing', () => {
    // Re-creating one somebody deliberately retired would be the app
    // overruling a decision they made on purpose.
    const channel = createChannel(db, { name: 'LinkedIn' })
    db.run('UPDATE marketing_channels SET is_active = 0 WHERE id = ?', [channel.id])

    expect(marketingFromPlan(db, PLAN).newChannels).not.toContain('LinkedIn')
  })

  it('says so when a plan has nothing Marketing can use', () => {
    const thin = '# Plan\n\n## The business\n\nI draw planning applications.\n'
    expect(marketingFromPlan(db, thin).empty).toBe(true)
  })

  it('changes nothing on its own', () => {
    // The whole contract: suggesting is not applying.
    updatePlan(db, { audience: 'Written by hand' })
    marketingFromPlan(db, PLAN)

    expect(getPlan(db).audience).toBe('Written by hand')
    expect(listChannels(db)).toHaveLength(0)
  })
})

describe('applying what was accepted', () => {
  it('writes only the audience when only that was accepted', () => {
    applyToMarketing(db, { audience: 'Architecture practices' })

    expect(getPlan(db).audience).toBe('Architecture practices')
    expect(listChannels(db)).toHaveLength(0)
  })

  it('creates the channels that were ticked, with no commitment on any of them', () => {
    // A plan mentioning LinkedIn is not somebody promising to post twice a
    // week, and a cadence they never agreed to would draw gaps on their
    // calendar from day one.
    const result = applyToMarketing(db, { channels: ['LinkedIn', 'Newsletter'] })

    expect(result.channelsCreated).toBe(2)
    for (const channel of listChannels(db)) expect(channel.cadenceCount).toBe(0)
  })

  it('does not create the same channel twice', () => {
    createChannel(db, { name: 'LinkedIn' })
    const result = applyToMarketing(db, { channels: ['LinkedIn', 'linkedin', 'Newsletter'] })

    expect(result.channelsCreated).toBe(1)
    expect(listChannels(db)).toHaveLength(2)
  })

  it('leaves a hand-written audience alone when it was not accepted', () => {
    updatePlan(db, { audience: 'Written by hand' })
    applyToMarketing(db, { channels: ['LinkedIn'] })

    expect(getPlan(db).audience).toBe('Written by hand')
  })

  it('refuses to blank an audience with an empty acceptance', () => {
    // An empty string arriving from the UI must read as "nothing to apply",
    // never as "replace what is there with nothing".
    updatePlan(db, { audience: 'Written by hand' })
    applyToMarketing(db, { audience: '   ' })

    expect(getPlan(db).audience).toBe('Written by hand')
  })
})

describe('the figures behind the capacity calculator', () => {
  it('sets the rate, the costs and the target from the plan', () => {
    applyFigures(db, { charge: '£65 an hour', costs: 'About £4,000', target: '£36,000' })

    const settings = getSettings(db)
    expect(settings.defaultHourlyRate).toBe(6500)
    expect(settings.plannedAnnualCosts).toBe(400_000)
    expect(settings.takeHomeTarget).toBe(3_600_000)
  })

  it('reaches the calculator, which is the whole point', () => {
    // The join this change exists to make: what somebody typed into the
    // interview is what the card at the top of the page works from.
    applyFigures(db, { charge: '£65 an hour', costs: '£4,000', target: '£36,000' })

    const defaults = capacityDefaults(db)
    expect(defaults.rate).toBe(6500)
    expect(defaults.annualCosts).toBe(400_000)
    expect(defaults.costsFromPlan).toBe(true)
    expect(defaults.takeHomeTarget).toBe(3_600_000)
  })

  it('leaves the rate alone when the plan quotes a day rate', () => {
    updateSettings(db, { defaultHourlyRate: 5000 })
    applyFigures(db, { charge: '£450 a day', costs: '£4,000' })

    // Setting 45000 here would have re-priced every timer in the app.
    expect(getSettings(db).defaultHourlyRate).toBe(5000)
    expect(getSettings(db).plannedAnnualCosts).toBe(400_000)
  })

  it('writes nothing for a figure the plan does not state', () => {
    updateSettings(db, { defaultHourlyRate: 5000, plannedAnnualCosts: 100_000 })
    applyFigures(db, { target: '£36,000' })

    expect(getSettings(db).defaultHourlyRate).toBe(5000)
    expect(getSettings(db).plannedAnnualCosts).toBe(100_000)
  })

  it('lets real expenses beat the stated figure', () => {
    // Tracked reality is the point of the calculator and always wins where it
    // exists. The plan is only a fallback for somebody with no history yet.
    applyFigures(db, { costs: '£4,000' })
    db.run(
      `INSERT INTO expenses
         (date, vendor, description, net, vat, total, category, created_at, updated_at)
       VALUES (date('now'), 'Someone', 'Insurance', 20000, 0, 20000, 'Insurance',
               datetime('now'), datetime('now'))`
    )

    const defaults = capacityDefaults(db)
    expect(defaults.annualCosts).toBe(20000)
    expect(defaults.costsFromPlan).toBe(false)
  })
})

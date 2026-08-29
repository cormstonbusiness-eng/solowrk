import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../db'
import { listMail } from './mailQueue'

/**
 * Whether a chaser goes out on its own.
 *
 * This is the one place in SoloWrk where the software can do something to
 * somebody else's relationship with their client. Every test below is a
 * variation on the same question: what does it take to make that happen, and
 * does anything less than that make it happen by accident?
 *
 * The mail module is stubbed because it reaches into Electron's keychain, which
 * does not exist in a test runner — and because the point here is what gets
 * queued, not what gets on the wire.
 */

const sent: string[] = []
let credentials: object | null = null

vi.mock('./mail', () => ({
  credentialsFor: async () => credentials,
  smtpConfigured: () => credentials !== null,
  smtpTransport: () => ({
    async send(message: { subject: string }) {
      sent.push(message.subject)
    }
  })
}))

const { runChasers } = await import('./chaseRun')

const TODAY = '2026-08-25'

function setUp(db: Database, options: { chaseSend?: string; email?: string } = {}): void {
  db.run(
    `INSERT INTO clients (name, contact_name, email, folder, relationship_stage, created_at, updated_at)
     VALUES ('Acme Ltd', 'Dana', ?, 'Clients\\Acme', 'active', datetime('now'), datetime('now'))`,
    [options.email ?? 'dana@acme.test']
  )

  db.run(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, gross, created_at, updated_at)
     VALUES ('INV-1', 1, 'sent', '2026-06-01', '2026-07-01', 120000, datetime('now'), datetime('now'))`
  )

  db.run(`UPDATE settings SET chase_enabled = 1, chase_days = '7,14,30', chase_send = ? WHERE id = 1`, [
    options.chaseSend ?? 'hold'
  ])
}

describe('drafting a chaser', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    sent.length = 0
    credentials = null
  })
  afterEach(() => db.close())

  it('does nothing at all while chasing is switched off', async () => {
    setUp(db)
    db.run(`UPDATE settings SET chase_enabled = 0 WHERE id = 1`)

    expect((await runChasers(db, TODAY)).drafted).toBe(0)
    expect(listMail(db)).toEqual([])
  })

  it('writes one and holds it', async () => {
    setUp(db)

    const result = await runChasers(db, TODAY)

    expect(result.drafted).toBe(1)
    expect(result.queued).toBe(0)
    expect(listMail(db)[0]!.status).toBe('held')
    expect(sent).toEqual([])
  })

  it('writes nothing the second time it runs the same day', async () => {
    // The sweep is allowed to run twice. The client is not chased twice.
    setUp(db)

    await runChasers(db, TODAY)
    expect((await runChasers(db, TODAY)).drafted).toBe(0)
    expect(listMail(db)).toHaveLength(1)
  })

  it('skips a client with no email address', async () => {
    // Queuing it would produce a message that fails and reports a mail server
    // problem, when what is actually missing is the address.
    setUp(db, { email: '' })

    expect((await runChasers(db, TODAY)).drafted).toBe(0)
  })
})

describe('sending one automatically', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    sent.length = 0
    credentials = null
  })
  afterEach(() => db.close())

  it('holds it when the setting says auto but no mail account is set up', async () => {
    // Two of the three conditions. Falling back to holding is the whole point:
    // the alternative queues a message that cannot go and then blames the mail
    // server for a server the user never configured.
    setUp(db, { chaseSend: 'auto' })

    const result = await runChasers(db, TODAY)

    expect(result.queued).toBe(0)
    expect(listMail(db)[0]!.status).toBe('held')
    expect(sent).toEqual([])
  })

  it('holds it when mail is set up but the setting still says hold', async () => {
    // The other two of the three. Configuring a mail server is not consent to
    // send in somebody's name; that is a separate decision and stays separate.
    setUp(db)
    credentials = { host: 'smtp.test' }

    expect((await runChasers(db, TODAY)).queued).toBe(0)
    expect(listMail(db)[0]!.status).toBe('held')
    expect(sent).toEqual([])
  })

  it('sends only when the setting and the mail account are both there', async () => {
    setUp(db, { chaseSend: 'auto' })
    credentials = { host: 'smtp.test' }

    const result = await runChasers(db, TODAY)

    expect(result.queued).toBe(1)
    expect(result.drained.sent).toBe(1)
    expect(sent).toHaveLength(1)
    expect(listMail(db)[0]!.status).toBe('sent')
  })

  it('marks the invoice chased when it queues, not when it lands', async () => {
    // Otherwise a message sitting in the queue for two hours after a network
    // failure gets a second identical chaser written underneath it.
    setUp(db, { chaseSend: 'auto' })
    credentials = { host: 'smtp.test' }

    await runChasers(db, TODAY)

    const step = db.get<{ chase_step: number }>('SELECT chase_step FROM invoices WHERE id = 1')!

    // Whatever milestone was reached, the invoice records it. Compared against
    // the queued message rather than a fixed number, because the milestone
    // depends on how late the invoice is and that is not what this is testing.
    expect(step.chase_step).toBe(listMail(db)[0]!.attempt)
  })

  it('does not chase the same invoice again the next day', async () => {
    setUp(db, { chaseSend: 'auto' })
    credentials = { host: 'smtp.test' }

    await runChasers(db, TODAY)
    await runChasers(db, '2026-08-26')

    expect(sent).toHaveLength(1)
  })

  it('moves on to the firmer note at the next milestone', async () => {
    // 7, 14 and 30 days past a 1 July due date. By late August the invoice is
    // well past the last of them, so the sweep should reach the final note
    // rather than working through all three in a morning.
    setUp(db, { chaseSend: 'auto' })
    credentials = { host: 'smtp.test' }

    await runChasers(db, TODAY)

    expect(listMail(db)[0]!.attempt).toBe(3)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import {
  approveMail,
  cancelMail,
  drainMail,
  enqueueMail,
  heldCount,
  listMail,
  sendableMail,
  type MailTransport
} from './mailQueue'
import { MAX_ATTEMPTS } from './mailPolicy'

/**
 * The outbound queue.
 *
 * Every test here is about one of two failures. Chasing a client twice for the
 * same invoice is the one they would remember and mention to other people.
 * Silently not chasing at all is the one that costs money. The queue exists to
 * make both visible rather than possible.
 */

/** A transport that records what it was asked to send, and can be told to fail. */
function fakeTransport(): MailTransport & { sent: string[]; fail: null | object } {
  return {
    sent: [],
    fail: null as null | object,
    async send(message) {
      if (this.fail) throw this.fail
      this.sent.push(message.subject)
    }
  }
}

/**
 * Real invoice rows, because the queue has a foreign key to them.
 *
 * Worth keeping: it is the constraint that stops a chaser outliving the invoice
 * it is about, which would otherwise leave a message in the outbox referring to
 * something the user has deleted.
 */
function addInvoices(db: Database, count = 2): void {
  for (let n = 1; n <= count; n += 1) {
    db.run(
      `INSERT INTO invoices (id, number, status, issue_date, due_date, gross, created_at, updated_at)
       VALUES (?, ?, 'sent', '2026-07-01', '2026-07-15', 50000, datetime('now'), datetime('now'))`,
      [n, `INV-${n}`]
    )
  }
}

const CHASER = { invoiceId: 1, attempt: 1, to: 'dana@acme.test', subject: 'INV-1', body: 'Hello' }

describe('putting something on the queue', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    addInvoices(db)
  })
  afterEach(() => db.close())

  it('holds it for the user by default', () => {
    // Nothing goes out because the app decided to. The default has to be the
    // safe one, because a default is what happens to somebody who never opened
    // the setting.
    expect(enqueueMail(db, CHASER)!.status).toBe('held')
  })

  it('refuses a message with nowhere to go', () => {
    // A client with no email address on file. Queuing it would produce a
    // message that fails five times and then reports a mail server problem,
    // which is not what is wrong.
    expect(() => enqueueMail(db, { ...CHASER, to: '   ' })).toThrow()
  })

  it('will not queue the same invoice and milestone twice', () => {
    // The sweep runs every morning and must be able to run twice.
    expect(enqueueMail(db, CHASER)).not.toBeNull()
    expect(enqueueMail(db, CHASER)).toBeNull()
    expect(listMail(db)).toHaveLength(1)
  })

  it('allows the next milestone through', () => {
    // A second, firmer note a fortnight later is a different message.
    expect(enqueueMail(db, CHASER)).not.toBeNull()
    expect(enqueueMail(db, { ...CHASER, attempt: 2 })).not.toBeNull()
  })

  it('does not confuse two invoices at the same milestone', () => {
    expect(enqueueMail(db, CHASER)).not.toBeNull()
    expect(enqueueMail(db, { ...CHASER, invoiceId: 2 })).not.toBeNull()
  })
})

describe('holding, sending and cancelling', () => {
  let db: Database
  let transport: ReturnType<typeof fakeTransport>

  beforeEach(() => {
    db = new Database(':memory:')
    addInvoices(db)
    transport = fakeTransport()
  })
  afterEach(() => db.close())

  it('does not send what is being held', async () => {
    enqueueMail(db, CHASER)

    expect(await drainMail(db, transport)).toEqual({ sent: 0, failed: 0, retrying: 0 })
    expect(transport.sent).toEqual([])
  })

  it('sends it once the user says so', async () => {
    const mail = enqueueMail(db, CHASER)!
    approveMail(db, mail.id)

    expect((await drainMail(db, transport)).sent).toBe(1)
    expect(transport.sent).toEqual(['INV-1'])
  })

  it('never sends the same message twice', async () => {
    // The drain can run on a timer, on launch, and on a button. All three
    // firing at once must not mean three emails.
    const mail = enqueueMail(db, CHASER)!
    approveMail(db, mail.id)

    await drainMail(db, transport)
    await drainMail(db, transport)

    expect(transport.sent).toHaveLength(1)
  })

  it('keeps a cancelled message out of the queue for good', () => {
    // Cancelling is a decision, and tomorrow's sweep must not undo it.
    const mail = enqueueMail(db, CHASER)!
    cancelMail(db, mail.id)

    expect(enqueueMail(db, CHASER)).toBeNull()
    expect(sendableMail(db)).toEqual([])
  })

  it('will not cancel something already sent', async () => {
    const mail = enqueueMail(db, CHASER)!
    approveMail(db, mail.id)
    await drainMail(db, transport)

    expect(cancelMail(db, mail.id).status).toBe('sent')
  })

  it('counts what is waiting on a person', () => {
    enqueueMail(db, CHASER)
    enqueueMail(db, { ...CHASER, invoiceId: 2 })
    approveMail(db, listMail(db)[0]!.id)

    expect(heldCount(db)).toBe(1)
  })
})

describe('when sending fails', () => {
  let db: Database
  let transport: ReturnType<typeof fakeTransport>

  beforeEach(() => {
    db = new Database(':memory:')
    addInvoices(db)
    transport = fakeTransport()
  })
  afterEach(() => db.close())

  const queued = (): number => {
    const mail = enqueueMail(db, CHASER)!
    approveMail(db, mail.id)
    return mail.id
  }

  it('waits and tries again when the network is down', async () => {
    const id = queued()
    transport.fail = { code: 'ECONNECTION', message: 'no route to host' }

    expect((await drainMail(db, transport, 0)).retrying).toBe(1)

    const mail = listMail(db).find((m) => m.id === id)!
    expect(mail.status).toBe('queued')
    expect(mail.sendAfter).not.toBeNull()
    expect(mail.lastError).toContain('no route')
  })

  it('honours the wait rather than hammering the server', async () => {
    queued()
    transport.fail = { code: 'ECONNECTION' }
    await drainMail(db, transport, 0)

    // A second later, it is not due.
    expect(sendableMail(db, new Date(1_000).toISOString())).toHaveLength(0)
    // A minute later, it is.
    expect(sendableMail(db, new Date(120_000).toISOString())).toHaveLength(1)
  })

  it('gives up immediately on a bad password', async () => {
    // The whole point of classifying the error. Five retries here is five
    // failed sign-ins against the user's real mail account.
    const id = queued()
    transport.fail = { code: 'EAUTH', message: '535 Incorrect authentication data' }

    expect((await drainMail(db, transport, 0)).failed).toBe(1)

    const mail = listMail(db).find((m) => m.id === id)!
    expect(mail.status).toBe('failed')
    expect(mail.attempts).toBe(1)
  })

  it('gives up after the last attempt rather than retrying forever', async () => {
    queued()
    transport.fail = { code: 'ECONNECTION' }

    // Far enough into the future each time that the wait is always satisfied.
    let now = 0
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await drainMail(db, transport, now)
      now += 24 * 60 * 60_000
    }

    expect(listMail(db)[0]!.status).toBe('failed')
    expect(listMail(db)[0]!.attempts).toBe(MAX_ATTEMPTS)
  })

  it('lets the user try a failed message again', async () => {
    const id = queued()
    transport.fail = { code: 'EAUTH' }
    await drainMail(db, transport, 0)

    // They fixed the password. Approving resets the count, because a message
    // somebody has just chosen to send deserves the full set of retries.
    approveMail(db, id)
    transport.fail = null

    expect((await drainMail(db, transport)).sent).toBe(1)
  })

  it('does not let one bad message stop the rest', async () => {
    // A wrong address on the third invoice is a fact about that invoice.
    const first = enqueueMail(db, CHASER)!
    const second = enqueueMail(db, { ...CHASER, invoiceId: 2, subject: 'INV-2' })!
    approveMail(db, first.id)
    approveMail(db, second.id)

    const failing: MailTransport = {
      async send(message) {
        if (message.subject === 'INV-1') throw { responseCode: 550, message: 'no such mailbox' }
        transport.sent.push(message.subject)
      }
    }

    const result = await drainMail(db, failing, 0)

    expect(result).toEqual({ sent: 1, failed: 1, retrying: 0 })
    expect(transport.sent).toEqual(['INV-2'])
  })
})

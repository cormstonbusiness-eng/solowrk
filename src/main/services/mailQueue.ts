import type { Database, Row } from '../db'
import type { MailStatus, QueuedMail } from '@shared/types'
import { nowStamp } from '@shared/calendar'
import { classifyMailError, describeMailError, nextAttemptAt, MAX_ATTEMPTS } from './mailPolicy'

/**
 * Outbound mail, as a queue.
 *
 * A queue rather than a function call because the moment the app decides to
 * send is very often not a moment it can: the sweep runs at nine and the laptop
 * is shut at nine. A send attempted and lost is worse than one never attempted,
 * because nobody finds out it did not go.
 *
 * The other reason is the one the chaser drafts were written around. Sending a
 * note in somebody's name to their client is the most consequential thing this
 * app does, and a queue makes it a thing with a state you can look at, hold,
 * read, cancel, and be told about — rather than an event that either happened
 * or did not.
 */

export type { MailStatus, QueuedMail }

interface MailRow extends Row {
  id: number
  kind: string
  invoice_id: number | null
  attempt: number
  to_address: string
  subject: string
  body: string
  status: MailStatus
  attempts: number
  last_error: string | null
  send_after: string | null
  created_at: string
  sent_at: string | null
}

function toMail(row: MailRow): QueuedMail {
  return {
    id: row.id,
    kind: row.kind,
    invoiceId: row.invoice_id,
    attempt: row.attempt,
    to: row.to_address,
    subject: row.subject,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    sendAfter: row.send_after,
    createdAt: row.created_at,
    sentAt: row.sent_at
  }
}

/**
 * What actually puts a message on the wire.
 *
 * An interface rather than a direct call into the mail library, so the queue —
 * which is the part with the interesting decisions in it — can be tested
 * without a server to send to, and so the library can be swapped without
 * touching any of the logic that matters.
 */
export interface MailTransport {
  send(message: { to: string; subject: string; body: string }): Promise<void>
}

export interface EnqueueInput {
  kind?: string
  invoiceId?: number | null
  attempt?: number
  to: string
  subject: string
  body: string
  /**
   * 'held' waits for the user to press send; 'queued' is already decided and
   * waits only for the network.
   */
  status?: Extract<MailStatus, 'held' | 'queued'>
}

/**
 * Put a message on the queue, or leave the one already there alone.
 *
 * Returns null when there is already a message for this invoice and milestone.
 * That is the normal case, not an error: the sweep runs every morning and is
 * supposed to be able to run twice without chasing anybody twice. The uniqueness
 * is enforced by an index in the database rather than by looking first, because
 * looking first and then inserting is two statements with a gap in the middle.
 */
export function enqueueMail(db: Database, input: EnqueueInput): QueuedMail | null {
  const to = input.to.trim()
  if (to === '') throw new Error('A message needs somewhere to go')

  try {
    db.run(
      `INSERT INTO mail_queue (kind, invoice_id, attempt, to_address, subject, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.kind ?? 'chaser',
        input.invoiceId ?? null,
        input.attempt ?? 1,
        to,
        input.subject,
        input.body,
        input.status ?? 'held',
        nowStamp()
      ]
    )
  } catch (error) {
    // The unique index doing its job. Anything else is a real problem.
    if (String(error).includes('UNIQUE')) return null
    throw error
  }

  const id = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  return getMail(db, id)
}

export function getMail(db: Database, id: number): QueuedMail {
  const row = db.get<MailRow>('SELECT * FROM mail_queue WHERE id = ?', [id])
  if (!row) throw new Error(`No queued message ${id}`)
  return toMail(row)
}

export function listMail(db: Database, status?: MailStatus): QueuedMail[] {
  const rows = status
    ? db.all<MailRow>('SELECT * FROM mail_queue WHERE status = ? ORDER BY created_at DESC', [status])
    : db.all<MailRow>('SELECT * FROM mail_queue ORDER BY created_at DESC')
  return rows.map(toMail)
}

/**
 * The user pressing send on a held message.
 *
 * Only moves it into the queue — the sending happens on the next drain, which
 * may be immediately or may be when the network comes back. Resets the attempt
 * count, because a message a person has just chosen to send deserves the full
 * set of retries whatever happened to it before.
 */
export function approveMail(db: Database, id: number): QueuedMail {
  db.run(
    `UPDATE mail_queue SET status = 'queued', attempts = 0, last_error = NULL, send_after = NULL
      WHERE id = ? AND status IN ('held', 'failed')`,
    [id]
  )
  return getMail(db, id)
}

/**
 * Bin it.
 *
 * Cancelled rows are kept rather than deleted, and the unique index counts
 * them: the sweep must not recreate tomorrow the message somebody decided
 * today not to send.
 */
export function cancelMail(db: Database, id: number): QueuedMail {
  db.run(`UPDATE mail_queue SET status = 'cancelled' WHERE id = ? AND status != 'sent'`, [id])
  return getMail(db, id)
}

/**
 * Messages that can be sent right now.
 *
 * `send_after` is how a transient failure gets its wait honoured across a
 * restart — the delay lives in the row, not in a timer that dies with the
 * process.
 */
export function sendableMail(db: Database, at = nowStamp()): QueuedMail[] {
  return db
    .all<MailRow>(
      `SELECT * FROM mail_queue
        WHERE status = 'queued' AND (send_after IS NULL OR send_after <= ?)
        ORDER BY created_at ASC`,
      [at]
    )
    .map(toMail)
}

export interface DrainResult {
  sent: number
  failed: number
  retrying: number
}

/**
 * Try to send everything that is ready.
 *
 * Sequential rather than parallel, deliberately. These go through one small
 * provider account and arriving as a burst of ten simultaneous connections is
 * how a personal mailbox gets rate-limited or flagged for spam — which would
 * cost the user their email over a feature meant to save them an afternoon.
 *
 * One failure does not stop the others: a bad address on the third message is
 * a fact about that message.
 */
export async function drainMail(
  db: Database,
  transport: MailTransport,
  now = Date.now()
): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, retrying: 0 }

  for (const mail of sendableMail(db, new Date(now).toISOString())) {
    try {
      await transport.send({ to: mail.to, subject: mail.subject, body: mail.body })
      db.run(`UPDATE mail_queue SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?`, [
        nowStamp(),
        mail.id
      ])
      result.sent += 1
    } catch (error) {
      const attempts = mail.attempts + 1
      const failure = classifyMailError(error as { code?: string; responseCode?: number })
      const retryAt = failure === 'transient' ? nextAttemptAt(attempts, now) : null

      if (retryAt === null) {
        db.run(
          `UPDATE mail_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`,
          [attempts, describeMailError(error as { message?: string }), mail.id]
        )
        result.failed += 1
      } else {
        db.run(
          `UPDATE mail_queue SET attempts = ?, last_error = ?, send_after = ? WHERE id = ?`,
          [attempts, describeMailError(error as { message?: string }), new Date(retryAt).toISOString(), mail.id]
        )
        result.retrying += 1
      }
    }
  }

  return result
}

/** How many messages are waiting on a person rather than on the network. */
export function heldCount(db: Database): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM mail_queue WHERE status = 'held'`)!.n
}

export { MAX_ATTEMPTS }

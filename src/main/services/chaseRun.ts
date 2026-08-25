import type { Database } from '../db'
import { today } from '@shared/taxYear'
import { draftChaser, dueChasers, markChased } from './chasers'
import { credentialsFor, smtpConfigured, smtpTransport } from './mail'
import { drainMail, enqueueMail, type DrainResult } from './mailQueue'
import { getSettings } from './settings'

/**
 * Turning "this invoice is late" into a message that exists.
 *
 * Kept apart from both the sweep that calls it and the queue it writes to,
 * because this is where the one genuinely consequential decision in the app is
 * made: whether a note goes to somebody's client without them reading it first.
 *
 * The answer is that it does not, unless the user has gone into Settings, given
 * SoloWrk their mail account, and then changed chasing from 'hold' to 'auto'.
 * Three deliberate acts. Anything less and the chaser is written, queued, and
 * left waiting for a press.
 */

export interface SweepResult {
  /** Chasers written this run. */
  drafted: number
  /** Of those, how many were queued to send rather than held. */
  queued: number
  drained: DrainResult
}

const NOTHING: SweepResult = {
  drafted: 0,
  queued: 0,
  drained: { sent: 0, failed: 0, retrying: 0 }
}

/**
 * Write chasers for everything that has crossed a milestone, and try to send
 * whatever is already waiting.
 *
 * Drafting and draining are one call because they are one intent — *deal with
 * the late invoices* — and because the drain has to happen on a schedule
 * anyway: a message that failed at nine because the wifi was not up yet needs
 * something to come back for it.
 */
export async function runChasers(db: Database, day = today()): Promise<SweepResult> {
  const settings = getSettings(db)
  if (!settings.chaseEnabled) return NOTHING

  const credentials = await credentialsFor(settings)

  /**
   * Automatic sending needs all three: the setting, a configured server, and a
   * password we can actually read. Missing any of them silently falls back to
   * holding, rather than queueing messages that will fail five times and then
   * tell the user their mail is broken when the truth is it was never set up.
   */
  const sending = settings.chaseSend === 'auto' && credentials !== null

  let drafted = 0
  let queued = 0

  for (const chase of dueChasers(db, day)) {
    const draft = draftChaser(db, chase.invoice.id, chase.attempt)

    // No address on file. Nothing to do but leave it for the user, who will see
    // the invoice is late on the Invoices page regardless.
    if (draft.to.trim() === '') continue

    const mail = enqueueMail(db, {
      kind: 'chaser',
      invoiceId: chase.invoice.id,
      attempt: chase.attempt,
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      status: sending ? 'queued' : 'held'
    })

    // Already written at this milestone by an earlier run today.
    if (!mail) continue

    drafted += 1

    if (sending) {
      queued += 1
      /**
       * Recorded as chased at the point it is queued, not at the point it
       * lands. The step is what stops tomorrow's sweep writing the same note
       * again, and a queue that retries for two hours would otherwise get a
       * second, identical chaser written underneath it in the meantime.
       */
      markChased(db, chase.invoice.id, chase.attempt, day)
    }
  }

  const drained = credentials
    ? await drainMail(db, smtpTransport(credentials))
    : { sent: 0, failed: 0, retrying: 0 }

  return { drafted, queued, drained }
}

/**
 * Send whatever is waiting, without writing anything new.
 *
 * Called on launch and after the user presses send on a held message. Separate
 * from the sweep because draining is safe to do at any moment — every message
 * in the queue is one somebody or something already decided to send — whereas
 * drafting is tied to the once-a-day schedule.
 */
export async function drainOutbox(db: Database): Promise<DrainResult> {
  const settings = getSettings(db)
  const credentials = await credentialsFor(settings)
  if (!credentials) return { sent: 0, failed: 0, retrying: 0 }

  return drainMail(db, smtpTransport(credentials))
}

/** Whether the user could send if they wanted to, for the UI to say so. */
export async function canSend(db: Database): Promise<boolean> {
  const settings = getSettings(db)
  return smtpConfigured(settings, (await credentialsFor(settings)) !== null)
}

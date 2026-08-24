import type { Database } from '../db'
import type { DueChase, Settings } from '@shared/types'
import { today } from '@shared/taxYear'
import { getClient } from './clients'
import { getInvoice, overdueInvoices } from './invoices'
import { getSettings } from './settings'

/**
 * Chasing late invoices.
 *
 * SoloWrk drafts, it does not send. There is no mail server here and there is
 * not going to be one: an email going out in somebody's name, to their client,
 * without them reading it first, is not a decision to take on their behalf —
 * and the first time it got the tone wrong it would cost them the relationship,
 * not us. So the app writes the note, tells them it is waiting, and stops.
 *
 * The value is in never forgetting. Most late invoices are late because chasing
 * is uncomfortable and easy to defer, not because the words are hard.
 */

/** Days past due at which to raise each chaser, if the user has not set their own. */
export const DEFAULT_CHASE_DAYS = [7, 14, 30]

export function chaseSchedule(settings: Settings): number[] {
  const parsed = (settings.chaseDays ?? '')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isFinite(day) && day >= 0)

  // Sorted and de-duplicated, so a schedule typed as "14,7,7" still means what
  // the person meant. Falling back rather than failing: a schedule someone has
  // mangled by hand should chase sensibly, not stop chasing.
  const unique = [...new Set(parsed)].sort((a, b) => a - b)
  return unique.length > 0 ? unique : DEFAULT_CHASE_DAYS
}

function daysBetween(from: string, to: string): number {
  // Both are yyyy-mm-dd. Parsed as UTC midnight deliberately: building a local
  // Date from a date-only string and subtracting can come out a day wrong
  // across a DST boundary, which would chase a client a day early.
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

/**
 * Invoices that have crossed the next milestone in the schedule.
 *
 * Only ever returns each invoice once per milestone: `chase_step` records how
 * far along it has been chased, so the sweep can run every morning without
 * raising the same nudge twice. An invoice that sat unopened for a fortnight
 * comes back at the milestone it has actually reached, not at every milestone
 * it passed while the laptop was shut.
 */
export function dueChasers(db: Database, asOf = today()): DueChase[] {
  const settings = getSettings(db)
  if (!settings.chaseEnabled) return []

  const schedule = chaseSchedule(settings)

  return overdueInvoices(db, asOf)
    .map((invoice) => {
      const daysLate = daysBetween(invoice.dueDate, asOf)
      const step = invoice.chaseStep ?? 0

      // The furthest milestone this invoice has passed. Not the next one after
      // the last chase, so a long silence catches up in one note rather than
      // three in a morning.
      const reached = schedule.filter((day) => daysLate >= day).length
      if (reached <= step) return null

      return { invoice, daysLate, attempt: reached, attempts: schedule.length }
    })
    .filter((chase): chase is DueChase => chase !== null)
}

/**
 * Record that an invoice has been chased to this point.
 *
 * Called when the user acts on the draft, not when it is raised — a chaser
 * sitting unread in the notification list has not chased anybody, and marking
 * it done would mean the next milestone silently replaced it.
 */
export function markChased(db: Database, id: number, attempt: number, at = today()): void {
  db.run(`UPDATE invoices SET chase_step = ?, last_chased_at = ?, updated_at = ? WHERE id = ?`, [
    attempt,
    at,
    new Date().toISOString(),
    id
  ])
}

/**
 * Stop chasing this invoice without marking it paid.
 *
 * The case this exists for: the client rang, it is being paid on Friday, and
 * another note on Thursday would be rude. Sets the step past the end of the
 * schedule rather than adding a flag, so it needs no extra column and resumes
 * naturally if the schedule is ever lengthened.
 */
export function stopChasing(db: Database, id: number): void {
  const settings = getSettings(db)
  markChased(db, id, chaseSchedule(settings).length)
}

/**
 * The note itself, in the user's voice, getting firmer with each attempt.
 *
 * Three registers rather than one because a fourth-week note that opens "I hope
 * you are well" reads as though nobody is paying attention. None of them are
 * rude: the relationship usually outlives the invoice, and a freelancer sending
 * a solicitor's letter over three hundred pounds has already lost more than
 * they are chasing.
 */
export function draftChaser(
  db: Database,
  id: number,
  attempt = 1
): { subject: string; body: string; to: string } {
  const invoice = getInvoice(db, id)
  const settings = getSettings(db)
  const client = invoice.clientId ? getClient(db, invoice.clientId) : null

  const daysLate = Math.max(0, daysBetween(invoice.dueDate, today()))
  const amount = `£${(invoice.gross / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
  const dueDate = new Date(`${invoice.dueDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
  const greeting = `Hi ${client?.contactName || client?.name || 'there'},`
  const signOff = ['Many thanks,', settings.contactName || settings.businessName]

  const late = daysLate > 0 ? `, which is ${daysLate} day${daysLate === 1 ? '' : 's'} ago` : ''

  if (attempt <= 1) {
    return {
      to: client?.email ?? '',
      subject: `Invoice ${invoice.number} — payment overdue`,
      body: [
        greeting,
        '',
        `I hope you are well. Invoice ${invoice.number} for ${amount} was due on ${dueDate}${late}.`,
        '',
        'Could you let me know when I can expect payment? If it has already been sent,',
        'please ignore this note and accept my apologies.',
        '',
        ...signOff
      ].join('\n')
    }
  }

  if (attempt === 2) {
    return {
      to: client?.email ?? '',
      subject: `Invoice ${invoice.number} — still outstanding`,
      body: [
        greeting,
        '',
        `Following up on invoice ${invoice.number} for ${amount}, which was due on ${dueDate}${late}.`,
        'I have not had a reply to my last note, so I wanted to check it reached you.',
        '',
        'If there is a problem with the invoice, or it needs to go to someone else in',
        'accounts, tell me and I will sort it out. Otherwise, could you let me know the',
        'date it will be paid?',
        '',
        ...signOff
      ].join('\n')
    }
  }

  return {
    to: client?.email ?? '',
    subject: `Invoice ${invoice.number} — overdue by ${daysLate} days`,
    body: [
      greeting,
      '',
      `Invoice ${invoice.number} for ${amount} is now ${daysLate} days past its due date of ${dueDate},`,
      'and I have not been able to reach anyone about it.',
      '',
      'I would rather resolve this between us than take it further, so please could you',
      'either arrange payment this week or tell me what is holding it up.',
      '',
      'If you have already paid and we have crossed wires, let me know and I will chase',
      'it at my end.',
      '',
      ...signOff
    ].join('\n')
  }
}

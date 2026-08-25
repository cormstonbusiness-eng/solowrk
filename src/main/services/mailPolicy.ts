/**
 * When to try sending again, and when to stop.
 *
 * Kept apart from the sending itself so it can be tested without a mail server,
 * and because the interesting decision here is not how to open a socket — it is
 * knowing the difference between a server that is busy and a password that is
 * wrong. Retrying the first is polite; retrying the second gets the account
 * locked.
 */

/**
 * The gaps between attempts — four of them, so five attempts in all.
 *
 * Gaps rather than attempts, because there is always one fewer gap than there
 * are tries, and writing it the other way round is how an off-by-one gets into
 * a retry loop and either drops the first wait or adds a sixth attempt nobody
 * intended.
 *
 * Shaped for the two real outages: a laptop that woke up before its wifi did,
 * which the first two cover, and a provider having a bad half-hour, which the
 * last two do. Past that it is not a blip and somebody needs to look at it — a
 * queue that quietly retries for a week is a queue nobody finds out is broken.
 */
export const RETRY_DELAYS_MS = [
  60_000, // a minute — almost always the network catching up
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000
] as const

/** Five: the first try, plus one for each gap above. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

export type MailFailure =
  /** Try again later. The message is fine; the world was busy. */
  | 'transient'
  /** Stop. Trying again will fail the same way and cost something. */
  | 'permanent'

/**
 * Anything the mail library or the socket can hand back.
 *
 * Deliberately structural rather than nodemailer's own type: this decides
 * policy from two fields, and typing it to the library would mean the policy
 * could not be tested without one.
 */
export interface MailErrorLike {
  /** nodemailer's classification: EAUTH, ECONNECTION, ETIMEDOUT, and so on. */
  code?: string
  /** The SMTP numeric reply, when the server got far enough to give one. */
  responseCode?: number
  message?: string
}

/**
 * Codes that will fail identically every time.
 *
 * `EAUTH` is the one that matters. A wrong password retried five times is five
 * failed sign-ins against the user's real mail account, and Gmail and Microsoft
 * both respond to that by locking it — so a typo in Settings would cost
 * somebody their email rather than one chaser.
 */
const PERMANENT_CODES = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE'])

/**
 * Codes that are the network, not the message.
 *
 * Listed explicitly rather than inferred, but the default is transient anyway:
 * an unrecognised failure is more likely to be something passing than something
 * structural, and the cost of being wrong is four more attempts rather than a
 * chaser that silently never goes.
 */
const TRANSIENT_CODES = new Set([
  'ECONNECTION',
  'ECONNRESET',
  'ESOCKET',
  'ETIMEDOUT',
  'ETLS',
  'EDNS',
  'ENOTFOUND',
  'EAI_AGAIN'
])

export function classifyMailError(error: MailErrorLike): MailFailure {
  // The SMTP reply wins when there is one, because it is the server's own
  // account of itself. 5xx is "do not ask me this again"; 4xx is "not now".
  if (typeof error.responseCode === 'number') {
    if (error.responseCode >= 500) return 'permanent'
    if (error.responseCode >= 400) return 'transient'
  }

  if (error.code && PERMANENT_CODES.has(error.code)) return 'permanent'
  if (error.code && TRANSIENT_CODES.has(error.code)) return 'transient'

  return 'transient'
}

/**
 * When to try again, given how many times it has already been tried.
 *
 * Returns null once there is no next attempt, which is the caller's signal to
 * mark the message failed rather than to schedule nothing and leave it looking
 * like it is still waiting.
 */
export function nextAttemptAt(attempts: number, now: number): number | null {
  // `attempts` counts failures so far, and the gap after failure number one is
  // the first one in the list — hence the minus one.
  const delay = RETRY_DELAYS_MS[attempts - 1]
  return delay === undefined ? null : now + delay
}

/**
 * What to write in `last_error`.
 *
 * This ends up in front of somebody trying to work out why their chaser did not
 * go, so it keeps the server's own words — "535 Incorrect authentication data"
 * tells them what to fix, and "Send failed" tells them nothing.
 */
export function describeMailError(error: MailErrorLike): string {
  const parts = [error.message?.trim(), error.code].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'The mail server refused the message'
}

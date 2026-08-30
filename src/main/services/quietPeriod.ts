import type { Database, Row } from '../db'
import { daysBetween } from '@shared/calendar'
import { today } from '@shared/taxYear'
import { getSettings } from './settings'
import { notify } from './notifications'

/**
 * Saying something before the gap, not during it (§9.3).
 *
 * Freelance work arrives in a cycle everybody recognises and nobody escapes:
 * head down on a big job, marketing stops, the job ends, the pipeline is
 * empty, and now marketing is panic rather than habit. The lag is what makes
 * it vicious — effort put in during the panic pays off weeks after the rent
 * was due.
 *
 * So the only useful moment to say anything is while there is still work on.
 * This measures how far ahead the booked work runs and raises exactly one
 * quiet item when that gets short.
 *
 * **Not a nag, and not a modal.** One Needs Attention item, deduped so it
 * cannot appear twice for the same stretch. §9.3 is explicit about that, and
 * it is the difference between a prompt somebody acts on and one they learn
 * to dismiss.
 */

/**
 * How many weeks of committed work are booked.
 *
 * Measured as the distance to the furthest deadline on live work, which is
 * how a freelancer actually thinks about it — "I'm booked till the end of
 * March". It deliberately does not try to weigh how *full* those weeks are:
 * that needs per-task estimates, most of which are never filled in, and a
 * measure that silently reports zero because nobody estimates anything would
 * fire this warning every single month.
 *
 * Null when nothing live has a date on it at all. That is not the same as
 * "no work" and must not be treated as such — it means the question cannot
 * be answered, and the honest response to an unanswerable question is silence.
 */
export function runwayWeeks(db: Database, asOf: string = today()): number | null {
  const furthest = db.get<Row & { latest: string | null }>(
    `SELECT MAX(due_on) AS latest
       FROM projects
      WHERE archived = 0
        AND status IN ('active', 'planned')
        AND due_on IS NOT NULL`
  )

  if (!furthest?.latest) return null

  const days = daysBetween(asOf, furthest.latest)
  return days <= 0 ? 0 : Math.round((days / 7) * 10) / 10
}

/**
 * How long it has historically taken somebody to become a client.
 *
 * §9.3 leaves this open: state a general figure, or compute it from the
 * user's own history. Computed is better when there is enough of it, because
 * "six weeks" said about freelancers in general is advice, and "six weeks,
 * for you, measured" is a fact.
 *
 * The median rather than the mean — one client who took a year to sign would
 * drag an average into uselessness.
 *
 * Null below three data points, where a median is just one person's story.
 */
export function typicalLeadWeeks(db: Database): number | null {
  const lags = db
    .all<Row & { first: string; started: string }>(
      `SELECT interested_at AS first, became_active_at AS started
         FROM clients
        WHERE interested_at IS NOT NULL
          AND became_active_at IS NOT NULL
          AND became_active_at >= interested_at`
    )
    .map((row) => daysBetween(row.first.slice(0, 10), row.started.slice(0, 10)))
    .filter((days) => days >= 0)
    .sort((a, b) => a - b)

  if (lags.length < 3) return null

  const middle = Math.floor(lags.length / 2)
  const median =
    lags.length % 2 === 0 ? (lags[middle - 1]! + lags[middle]!) / 2 : lags[middle]!

  return Math.max(1, Math.round(median / 7))
}

/** What the warning would say, or null when there is nothing to warn about. */
export function quietPeriodWarning(
  db: Database,
  asOf: string = today()
): { weeks: number; body: string } | null {
  const { quietPeriodWeeks } = getSettings(db)

  // Zero is off, deliberately. Somebody on one long retainer has no pipeline
  // to measure and does not want telling about it every month.
  if (quietPeriodWeeks <= 0) return null

  const weeks = runwayWeeks(db, asOf)
  if (weeks === null || weeks >= quietPeriodWeeks) return null

  const lead = typicalLeadWeeks(db)

  const booked = `You have ${weeks === 0 ? 'no' : `${weeks}`} ${
    weeks === 1 ? 'week' : 'weeks'
  } of booked work left.`

  /*
    Measured where it can be, general where it cannot — and the wording says
    which. "Your last few clients took about six weeks" is a fact somebody can
    act on; the same sentence dressed up as a fact when it is a rule of thumb
    would be the kind of thing that makes people stop believing the app.
  */
  const lag = lead
    ? `Your last few clients took about ${lead} ${lead === 1 ? 'week' : 'weeks'} from first contact to starting, so work put in now lands about then.`
    : 'Enquiries usually take several weeks to turn into booked work, so effort now lands about when the gap would have been.'

  return { weeks, body: `${booked} ${lag}` }
}

/**
 * Raise it, once.
 *
 * The dedupe key carries the threshold rather than the date, so the warning
 * appears once per quiet stretch instead of once a day. Somebody who fills
 * their diary and then empties it again months later gets told again, because
 * the key clears when the notification is archived.
 */
export function checkQuietPeriod(db: Database, asOf: string = today()): boolean {
  const warning = quietPeriodWarning(db, asOf)
  if (!warning) return false

  const raised = notify(db, {
    kind: 'late',
    title: 'Work is running short',
    body: warning.body,
    link: '/marketing',
    dedupeKey: `quiet-period-${Math.floor(warning.weeks)}`
  })

  return raised !== null
}

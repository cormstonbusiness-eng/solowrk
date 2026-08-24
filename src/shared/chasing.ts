/**
 * The chase schedule: turning a line of text somebody typed into a decision
 * about when to email their customer.
 *
 * Shared rather than living beside the service because Settings shows the
 * schedule back to the user before it is ever used, and a preview that parsed
 * the text its own way would eventually disagree with the sweep — which is the
 * one thing it exists to prevent. Pure arithmetic on a string, no database and
 * no Electron, so both sides can import it.
 */

/** Days past due at which to raise each chaser, if the user has not set their own. */
export const DEFAULT_CHASE_DAYS = [7, 14, 30]

/**
 * Reads the schedule, forgivingly.
 *
 * Sorted and de-duplicated, so "14,7,7" still means what the person meant —
 * chasing hardest first would be the opposite of it. Falls back rather than
 * failing: a schedule someone has mangled by hand should chase sensibly, not
 * stop chasing, because silence here looks exactly like nobody owing anything.
 */
export function parseChaseDays(text: string): number[] {
  const parsed = (text ?? '')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isFinite(day) && day >= 0)

  const unique = [...new Set(parsed)].sort((a, b) => a - b)
  return unique.length > 0 ? unique : DEFAULT_CHASE_DAYS
}

/** The schedule as a sentence, for the hint under the input. */
export function describeSchedule(days: number[]): string {
  const parts = days.map((day) =>
    day === 0 ? 'on the due date' : `${day} day${day === 1 ? '' : 's'} after`
  )

  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

  return `Chases ${list}.`
}
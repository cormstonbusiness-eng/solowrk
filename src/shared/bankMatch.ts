/**
 * Matching a statement line to something in the app.
 *
 * Suggestions, and only ever suggestions. Marking an invoice paid on a wrong
 * match is a mistake with two heads: it stops the chasing on money still owed,
 * and it puts income in the accounts that never arrived. Neither is visible
 * afterwards, which is why nothing here writes and every result is offered to
 * a person with its reasons attached.
 *
 * Scored rather than ranked by rules, so the reasons can be shown. "Exact
 * amount, invoice number in the reference" is a different thing from "roughly
 * the right amount, a client whose name is a common word", and a person
 * deciding in two seconds needs to see which one they are looking at.
 */

export interface MatchCandidate {
  id: number
  /** Integer pence, positive. */
  amount: number
  /** The invoice number, or an expense's supplier. */
  reference: string
  /** Client or supplier name. */
  name: string | null
  /** `yyyy-mm-dd` — the due date for an invoice, the date for an expense. */
  date: string
}

export interface Match {
  id: number
  /**
   * Uncapped. Only the ordering and the gaps are meaningful — clamp it for a
   * progress bar at the point of drawing one, never here: capping first
   * collapses the daylight between a certain match and a plausible one, which
   * is exactly what `isClearWinner` measures.
   */
  score: number
  /** Said in the UI, verbatim. */
  reasons: string[]
  confidence: 'strong' | 'likely' | 'possible'
}

/**
 * How far apart two amounts may be and still be the same payment.
 *
 * Zero. A bank transfer of an invoice is the invoice, to the penny, and the
 * cases where it is not — a client rounding down, a foreign transfer with a
 * fee taken out — are exactly the cases somebody should look at rather than
 * have decided for them. Near-misses still appear, scored lower and labelled.
 */
const EXACT = 0

/** Beyond this, two amounts are not the same payment by any reading. */
const NEAR_PENCE = 500

/** Payments arrive around the due date, not on it. */
const NEAR_DAYS = 45

/**
 * Words that match everything and therefore mean nothing.
 *
 * A client called "The Design Company" would otherwise match every line with
 * "company" in it, which on a business account is most of them.
 */
const NOISE_WORDS = new Set([
  'the', 'ltd', 'limited', 'plc', 'llp', 'and', 'group', 'company', 'co',
  'services', 'service', 'solutions', 'consulting', 'consultancy', 'design',
  'studio', 'media', 'digital', 'uk', 'gb', 'inc'
])

/** Words worth matching on: long enough, and not one of the above. */
export function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NOISE_WORDS.has(word))
}

function daysApart(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.abs(Math.round((end - start) / 86_400_000))
}

/**
 * Does the statement text contain this reference?
 *
 * Compared with everything but letters and digits stripped, because a bank
 * turns `INV-0012` into `INV0012`, `INV 0012`, and occasionally `NV0012` when
 * the field runs out of room.
 */
export function mentionsReference(text: string, reference: string): boolean {
  if (reference.trim() === '') return false
  const flat = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = reference.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (wanted.length < 3) return false
  if (flat.includes(wanted)) return true

  // The digits alone, when there are enough of them to be distinctive.
  const digits = wanted.replace(/[^0-9]/g, '')
  return digits.length >= 4 && flat.includes(digits)
}

/**
 * Score one candidate against one statement line.
 *
 * Returns null when there is no reason at all to connect them — an empty list
 * is more useful than a list of everything sorted by how little it matches.
 */
export function scoreCandidate(
  line: { date: string; text: string; amount: number },
  candidate: MatchCandidate
): Match | null {
  const reasons: string[] = []
  let score = 0

  const difference = Math.abs(Math.abs(line.amount) - candidate.amount)

  if (difference === EXACT) {
    score += 55
    reasons.push('Exactly the right amount')
  } else if (difference <= NEAR_PENCE) {
    score += 20
    reasons.push('Within a few pence')
  } else {
    // A different amount is a different payment unless the reference says
    // otherwise, so it starts with nothing and has to earn its way back.
    score -= 10
  }

  if (mentionsReference(line.text, candidate.reference)) {
    score += 40
    reasons.push(`${candidate.reference} is in the reference`)
  }

  if (candidate.name) {
    const words = significantWords(candidate.name)
    const text = line.text.toLowerCase()
    const hit = words.find((word) => text.includes(word))
    if (hit) {
      score += 20
      reasons.push(`Mentions ${candidate.name}`)
    }
  }

  const apart = daysApart(line.date, candidate.date)
  if (apart <= 7) {
    score += 10
    reasons.push('Around the right date')
  } else if (apart > NEAR_DAYS) {
    // Not disqualifying on its own: invoices do get paid three months late,
    // and that is precisely when somebody is reconciling a statement.
    score -= 10
  }

  if (score <= 0 || reasons.length === 0) return null

  return {
    id: candidate.id,
    score,
    reasons,
    confidence: score >= 85 ? 'strong' : score >= 55 ? 'likely' : 'possible'
  }
}

/**
 * The candidates worth showing, best first.
 *
 * Capped, because a list of fourteen possibles is a list nobody reads — and
 * a second nearly-as-good match is the useful part of the answer, so it is
 * never reduced to one.
 */
export function matchesFor(
  line: { date: string; text: string; amount: number },
  candidates: readonly MatchCandidate[],
  limit = 4
): Match[] {
  return candidates
    .map((candidate) => scoreCandidate(line, candidate))
    .filter((match): match is Match => match !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Whether the best match is safe to offer as *the* answer.
 *
 * Strong on its own is not enough: two invoices to the same client for the
 * same amount both score strongly, and picking either one is a coin toss
 * dressed up as a suggestion. A clear winner needs daylight behind it.
 */
export function isClearWinner(matches: readonly Match[]): boolean {
  const [best, next] = matches
  if (!best || best.confidence !== 'strong') return false
  return !next || best.score - next.score >= 20
}

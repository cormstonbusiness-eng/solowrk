import { LIMIT_LABELS, MONTHLY_LIMITS, TIER_NAMES, type Limit, type Tier } from './entitlements'

/**
 * Hitting a limit, in a form that survives the gap between the processes.
 *
 * Electron serialises a thrown error across `ipcRenderer.invoke` down to its
 * message and nothing else — the class is gone, and so is any property hung on
 * it. So the facts travel *inside* the message, behind a sentinel, and are
 * unpacked on the other side.
 *
 * That matters because §5.1 is emphatic that a limit must never be a silently
 * disabled control: the modal has to say which limit, how many they have, and
 * which tier lifts it. Without the numbers there is nothing to render but a
 * shrug, and a shrug is the worst possible answer to somebody who was halfway
 * through adding a client.
 */

/**
 * Chosen to be unmistakable and never a thing a person would type. Electron
 * prefixes the message with "Error invoking remote method '…': Error: " on the
 * way through, so the reader looks for this anywhere in the string rather than
 * at the start of it.
 */
const SENTINEL = '@@solowrk/limit@@'

export interface LimitFacts {
  limit: Limit
  /** How many they have. The count that was measured, not the cap. */
  used: number
  /** The cap they are on. Always finite — an unlimited tier cannot get here. */
  cap: number
  /** What they are on now. */
  tier: Tier
  /** The cheapest tier that lets them carry on. */
  needs: Tier
}

export class LimitReachedError extends Error {
  readonly facts: LimitFacts

  constructor(facts: LimitFacts) {
    super(`${SENTINEL}${JSON.stringify(facts)}`)
    this.name = 'LimitReachedError'
    this.facts = facts
  }
}

/**
 * Read the facts back out, from anything.
 *
 * Takes `unknown` because that is what a `catch` gives you and what every call
 * site actually holds. Returns null for any other failure, so a caller can ask
 * "was this a limit?" without first proving it was an error at all.
 */
export function limitFactsFrom(error: unknown): LimitFacts | null {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  const at = message.indexOf(SENTINEL)
  if (at === -1) return null

  try {
    const parsed = JSON.parse(message.slice(at + SENTINEL.length)) as Partial<LimitFacts>

    // Trust nothing that crossed a process boundary as a string. A half-parsed
    // envelope rendering "undefined of undefined" is worse than no modal.
    if (
      typeof parsed.limit !== 'string' ||
      typeof parsed.used !== 'number' ||
      typeof parsed.cap !== 'number' ||
      typeof parsed.tier !== 'string' ||
      typeof parsed.needs !== 'string'
    ) {
      return null
    }

    return parsed as LimitFacts
  } catch {
    return null
  }
}

/**
 * What to say, in one sentence.
 *
 * Lives here so the modal, the fallback toast and any log line all say the
 * same thing. §5.1 orders the modal's contents; this is its first line — what
 * they were trying to do, before anything about money.
 */
export function limitSentence(facts: LimitFacts): string {
  const label = LIMIT_LABELS[facts.limit].toLowerCase()
  const monthly = MONTHLY_LIMITS.includes(facts.limit)

  return monthly
    ? `You have used all ${facts.cap} of your ${label.replace(' this month', '')} for this month on ${TIER_NAMES[facts.tier]}.`
    : `You have reached ${facts.cap} ${label} on ${TIER_NAMES[facts.tier]}.`
}
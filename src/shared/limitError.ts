import {
  LIMIT_LABELS,
  MONTHLY_LIMITS,
  TIER_NAMES,
  type Feature,
  type Limit,
  type Tier
} from './entitlements'

/**
 * Being refused, in a form that survives the gap between the processes.
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
 *
 * **Two kinds of refusal, one mechanism.** A *limit* is "you have three and
 * three is the most". A *lock* is "this tier does not include that at all".
 * They read differently and they are both a reason to upgrade, so they travel
 * the same way and land in the same modal.
 *
 * Only the first was structured to begin with, and the cost showed up
 * immediately: the logo button failed in complete silence, and the update pack
 * rendered a hundred-and-fifty-character sentence into a `whitespace-nowrap`
 * span that ran off the edge of the window. Neither call site was wrong. There
 * was simply nowhere for a lock to go.
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

/* ------------------------------------------------------------------ *
 * The other kind: a feature this tier does not include
 * ------------------------------------------------------------------ */

const LOCKED = '@@solowrk/locked@@'

export interface LockedFacts {
  feature: Feature
  /** What they are on now. */
  tier: Tier
  /** The cheapest tier that includes it. */
  needs: Tier
  /**
   * The gate's own sentence, written by hand.
   *
   * Carried rather than rebuilt in the renderer, because the half that matters
   * — what still works without the feature — is a product judgement written
   * beside each gate and cannot be derived from the entitlement map.
   */
  message: string
}

export class FeatureLockedError extends Error {
  readonly facts: LockedFacts

  constructor(facts: LockedFacts) {
    // The human sentence comes first, so anything that does end up showing
    // `error.message` raw shows something readable before the envelope. The
    // reader finds the sentinel by index, not by position.
    super(`${facts.message} ${LOCKED}${JSON.stringify(facts)}`)
    this.name = 'FeatureLockedError'
    this.facts = facts
  }
}

export function lockedFactsFrom(error: unknown): LockedFacts | null {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  const at = message.indexOf(LOCKED)
  if (at === -1) return null

  try {
    const parsed = JSON.parse(message.slice(at + LOCKED.length)) as Partial<LockedFacts>

    if (
      typeof parsed.feature !== 'string' ||
      typeof parsed.tier !== 'string' ||
      typeof parsed.needs !== 'string' ||
      typeof parsed.message !== 'string'
    ) {
      return null
    }

    return parsed as LockedFacts
  } catch {
    return null
  }
}

/** Either kind of refusal, or null for an ordinary failure. */
export type Refusal =
  | { kind: 'limit'; facts: LimitFacts }
  | { kind: 'locked'; facts: LockedFacts }

export function refusalFrom(error: unknown): Refusal | null {
  const limit = limitFactsFrom(error)
  if (limit) return { kind: 'limit', facts: limit }

  const locked = lockedFactsFrom(error)
  if (locked) return { kind: 'locked', facts: locked }

  return null
}

import { describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  classifyMailError,
  describeMailError,
  nextAttemptAt
} from './mailPolicy'

/**
 * Retry policy for outbound mail.
 *
 * Two mistakes are possible and only one of them is cheap. Giving up on a
 * message that would have gone means a client is never chased and nobody finds
 * out. Retrying a message that can never go means hammering somebody's real
 * mail account with failed sign-ins until the provider locks it. The second is
 * the one worth being careful about.
 */
describe('what is worth trying again', () => {
  it('retries a server that says it is busy', () => {
    // 421 and 450 are the classic "come back later" replies.
    expect(classifyMailError({ responseCode: 421 })).toBe('transient')
    expect(classifyMailError({ responseCode: 450 })).toBe('transient')
  })

  it('gives up when the server says never', () => {
    // 550 is the mailbox that does not exist. Asking again does not create it.
    expect(classifyMailError({ responseCode: 550 })).toBe('permanent')
    expect(classifyMailError({ responseCode: 535 })).toBe('permanent')
  })

  it('gives up immediately on a bad password', () => {
    // The important one. Five retries here is five failed sign-ins against a
    // real mail account, and both Gmail and Microsoft lock it for that — so a
    // typo in Settings would cost somebody their email, not one chaser.
    expect(classifyMailError({ code: 'EAUTH' })).toBe('permanent')
  })

  it('retries the network', () => {
    for (const code of ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ENOTFOUND']) {
      expect(classifyMailError({ code }), code).toBe('transient')
    }
  })

  it('lets the server reply override the code', () => {
    // nodemailer reports a rejected recipient as EENVELOPE whether the server
    // said 450 or 550. The number is the server's own account of itself and is
    // the better answer of the two.
    expect(classifyMailError({ code: 'EENVELOPE', responseCode: 450 })).toBe('transient')
    expect(classifyMailError({ code: 'EENVELOPE', responseCode: 550 })).toBe('permanent')
  })

  it('treats something it has never seen as worth another go', () => {
    // Better four wasted attempts than a chaser that silently never went.
    expect(classifyMailError({})).toBe('transient')
    expect(classifyMailError({ code: 'ESOMETHINGNEW' })).toBe('transient')
  })
})

describe('when to try again', () => {
  it('waits a minute after the first failure', () => {
    // Long enough for wifi to finish connecting, short enough that a chaser
    // still goes out the morning it was meant to.
    expect(nextAttemptAt(1, 0)).toBe(60_000)
  })

  it('waits longer each time', () => {
    // Failures one through four each have a next attempt; the fifth does not.
    const waits = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => nextAttemptAt(i + 1, 0))

    expect(waits.every((wait) => wait !== null)).toBe(true)
    for (let i = 1; i < waits.length; i += 1) {
      expect(waits[i]!).toBeGreaterThan(waits[i - 1]!)
    }
  })

  it('stops after the last delay is used up', () => {
    // Null is the caller's signal to mark it failed. Scheduling nothing and
    // leaving the status alone would show a message as still waiting forever.
    expect(nextAttemptAt(MAX_ATTEMPTS, 0)).toBeNull()
    expect(nextAttemptAt(MAX_ATTEMPTS + 3, 0)).toBeNull()
  })

  it('gives up inside a working day', () => {
    // A queue that retries for a week is a queue nobody finds out is broken.
    const total = RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)
    expect(total).toBeLessThan(24 * 60 * 60_000)
  })
})

describe('what the user is told', () => {
  it('keeps the server’s own words', () => {
    // "535 Incorrect authentication data" tells somebody what to fix.
    expect(describeMailError({ message: '535 Incorrect authentication data' })).toContain('535')
  })

  it('still says something when there is nothing to go on', () => {
    expect(describeMailError({})).not.toBe('')
  })
})

import type { IpcChannel } from '@shared/ipc'

/**
 * Which paid feature a channel belongs to, and what to say when it is missing.
 *
 * Its own module rather than sitting in `ipc/index.ts` so it can be tested
 * without pulling in every service in the app — the failure this guards against
 * is a channel quietly escaping the gate, and that is only worth asserting if
 * asserting it is cheap.
 *
 * Matched longest-prefix-first, so `marketing:` covers all sixteen of its
 * channels and a seventeenth added tomorrow is gated without anyone
 * remembering to come back here.
 *
 * **This fails closed**, which is the opposite of `allowedWhenReadOnly` in
 * `@shared/ipc`. That one classifies by verb and lets an unrecognised name
 * through on purpose, because wrongly blocking an export is worse than wrongly
 * allowing a write. Here the trade runs the other way: a new marketing channel
 * that slipped the net would be a paid feature given away, so anything under a
 * gated prefix is refused unless it is named in `GATE_EXCEPTIONS`.
 */
export interface Gate {
  prefix: string
  feature: string
  /** Shown to the user verbatim, so it says what to do about it. */
  message: string
}

export const GATES: Gate[] = [
  {
    prefix: 'marketing:',
    feature: 'marketing',
    message:
      'Marketing is part of SoloWrk Pro. Upgrade at solo-wrk.com/account and it appears here.'
  },
  {
    /**
     * The schedule that runs itself, not the act of chasing.
     *
     * `invoices:chaser` — the button on an overdue invoice that writes one note
     * on demand — is deliberately outside this prefix and stays in Basic.
     * Selling somebody the ability to ask for their own money would be
     * indefensible; what Pro buys is not having to remember.
     */
    prefix: 'chasing:',
    feature: 'chasing',
    message:
      'The automatic chaser schedule is part of SoloWrk Pro. Upgrade at solo-wrk.com/account to switch it on. You can still chase any overdue invoice by hand.'
  },
  {
    /**
     * Assembling the year, not access to it.
     *
     * Every file the pack contains is free on its own — each CSV from Settings
     * and every invoice PDF from the invoice — so this gates the evening spent
     * gathering them, not the records. `export:` is deliberately a different
     * prefix and is never gated.
     */
    prefix: 'yearEnd:',
    feature: 'yearend',
    message:
      'The year-end pack is part of SoloWrk Pro. Upgrade at solo-wrk.com/account. Every file in it is still free on its own — the CSVs from Settings, and each invoice from the Invoices page.'
  },
  {
    // Only sending. The rest of `ai:*` is the business plan and the status the
    // upsell panel reads, both of which Basic keeps.
    prefix: 'ai:send',
    feature: 'assistant',
    message:
      'The assistant is part of SoloWrk Pro. Upgrade at solo-wrk.com/account to switch it on.'
  }
]

/**
 * Channels inside a gated prefix that Basic still needs.
 *
 * Empty today. If a locked page ever needs to read something to describe what
 * it is locked out of, it goes here — and every addition is a hole in the gate,
 * so each one wants a reason next to it.
 */
export const GATE_EXCEPTIONS = new Set<string>([])

export function gateFor(channel: IpcChannel | string): Gate | null {
  if (GATE_EXCEPTIONS.has(channel)) return null

  // Longest prefix wins, so a specific channel can be gated differently from
  // the group it sits in.
  return (
    [...GATES]
      .sort((a, b) => b.prefix.length - a.prefix.length)
      .find((gate) => channel.startsWith(gate.prefix)) ?? null
  )
}

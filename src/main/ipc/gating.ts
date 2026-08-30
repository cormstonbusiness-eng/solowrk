import type { IpcChannel } from '@shared/ipc'
import { SITE_HOST } from '@shared/site'
import {
  FEATURE_LABELS,
  TIER_NAMES,
  requires,
  type Feature,
  type Limit
} from '@shared/entitlements'

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
 * **This fails closed.** Anything under a gated prefix is refused unless it is
 * named in `GATE_EXCEPTIONS`, because a new marketing channel that slipped the
 * net would be a paid feature given away.
 *
 * **The messages are generated, not written.** `feature` is the only thing
 * declared; the tier that unlocks it comes from the entitlement map, so moving
 * a feature between tiers — or renaming a tier — cannot leave a message behind
 * saying something that is no longer true. Only the sentence that explains
 * what still works without it is written by hand, because that part is a
 * product judgement rather than a fact about the map.
 */
export interface Gate {
  prefix: string
  feature: Feature
  /** Shown to the user verbatim, so it says what to do about it. */
  message: string
}

/** Where the user goes to change what they are on. */
export const ACCOUNT_URL = `${SITE_HOST}/account`

/**
 * The sentence, built from the map.
 *
 * `reassurance` is the important half and the reason this is not fully
 * automatic: every gate in this app sits next to something the user keeps, and
 * saying so is what stops a paywall reading as a hostage note.
 */
function messageFor(feature: Feature, reassurance: string): string {
  const tier = TIER_NAMES[requires(feature)]
  return `SoloWrk ${tier} includes ${FEATURE_LABELS[feature]}. Upgrade at ${ACCOUNT_URL}. ${reassurance}`
}

export const GATES: Gate[] = [
  {
    prefix: 'marketing:',
    feature: 'marketing',
    message: messageFor('marketing', 'Your clients, projects and invoices are unaffected.')
  },
  {
    /**
     * The rest of Marketing: channels, the plan and content.
     *
     * Basic+ rather than Pro (§12). Content planning is the module somebody
     * touches most days, and habitual use is most of what makes a subscription
     * feel worth renewing — locking the whole thing away left Basic+ with no
     * daily reason to open the app. What stays behind Pro is the measurement
     * layer, which is a cleaner line than all-or-nothing.
     */
    prefix: 'channels:',
    feature: 'marketing',
    message: messageFor('marketing', 'Your clients, projects and invoices are unaffected.')
  },
  {
    /**
     * Results, attribution, spend and the consistency tracker — all Pro (§12).
     *
     * This is the measurement layer the Marketing split was drawn around:
     * Basic+ gets the doing, Pro gets knowing whether it worked.
     */
    prefix: 'results:',
    feature: 'marketingresults',
    message: messageFor(
      'marketingresults',
      'Your channels, campaigns and content are all still here — this is the reckoning, not the work.'
    )
  },
  {
    /** Recording a figure is part of measurement, so it goes with it. */
    prefix: 'metrics:',
    feature: 'marketingresults',
    message: messageFor(
      'marketingresults',
      'Your channels, campaigns and content are all still here — this is the reckoning, not the work.'
    )
  },
  {
    /**
     * The library itself is Basic+ (§12): somebody who has written a case
     * study or been sent a testimonial must always be able to keep it.
     */
    prefix: 'library:',
    feature: 'marketing',
    message: messageFor('marketing', 'Your clients, projects and invoices are unaffected.')
  },
  {
    /**
     * Writing one *from a finished project* is Pro, and it is a longer prefix
     * than `library:` so it wins — which is exactly what longest-prefix-first
     * exists for.
     */
    prefix: 'library:draftCaseStudy',
    feature: 'casestudies',
    message: messageFor(
      'casestudies',
      'You can still write one by hand and keep it in your library.'
    )
  },
  {
    prefix: 'campaigns:',
    feature: 'marketing',
    message: messageFor('marketing', 'Your clients, projects and invoices are unaffected.')
  },
  {
    prefix: 'content:',
    feature: 'marketing',
    message: messageFor('marketing', 'Your clients, projects and invoices are unaffected.')
  },
  {
    prefix: 'plan:',
    feature: 'marketing',
    message: messageFor('marketing', 'Your business plan and its figures are somewhere else entirely.')
  },
  {
    /**
     * The schedule that runs itself, not the act of chasing.
     *
     * `invoices:chaser` — the button on an overdue invoice that writes one note
     * on demand — is deliberately outside this prefix and stays free. Selling
     * somebody the ability to ask for their own money would be indefensible;
     * what a paid tier buys is not having to remember.
     */
    prefix: 'chasing:',
    feature: 'chasing',
    message: messageFor('chasing', 'You can still chase any overdue invoice by hand.')
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
    message: messageFor(
      'yearend',
      'Every file in it is still free on its own — the CSVs from Settings, and each invoice from the Invoices page.'
    )
  },
  {
    /**
     * Reading a statement and reconciling it.
     *
     * The whole prefix, because the import and the matching are one feature —
     * importing without being able to reconcile would be a list of numbers.
     *
     * §2.1 says import is free on every tier, and this is the deliberate
     * carve-out: that clause is about data portability, about getting your own
     * records in and out. A bank statement is neither. It is held at the user's
     * own bank, and every invoice and expense it touches stays free to read
     * and export either way.
     */
    prefix: 'bank:',
    feature: 'bank',
    message: messageFor(
      'bank',
      'Your invoices and expenses are still yours either way — this is the reconciling, not the records.'
    )
  },
  {
    /**
     * The weekly review, not the assistant.
     *
     * Sending a message is no longer gated at all: §2.1 gives Free twenty a
     * month and the paid tiers unlimited, so `ai:send` is governed by a limit
     * rather than by a feature. What stays here is the review that writes
     * itself every Monday.
     */
    prefix: 'review:',
    feature: 'aireview',
    message: messageFor('aireview', 'The figures it reads are all still on your dashboard.')
  },
  {
    /**
     * Putting your own logo on an invoice (§2.2).
     *
     * `settings:setLogo` only — reading one stays free, deliberately. Somebody
     * who uploaded a logo before this line existed keeps it on their invoices;
     * what a paid tier buys is *changing* it, and taking an existing one off
     * a customer's documents to make a point would be indefensible.
     *
     * `settings:clearLogo` is free for the same reason in reverse: removing
     * something of your own must never need a subscription.
     */
    prefix: 'settings:setLogo',
    feature: 'branding',
    message: messageFor(
      'branding',
      'Your invoices carry a small SoloWrk line until then, and nothing else changes.'
    )
  },
  {
    /**
     * One channel rather than a prefix, because it lives under `clients:` and
     * everything else there — the list, the record, the folder — stays free.
     * Longest-prefix-first is what makes that work.
     *
     * Gated on the same reasoning as the statement of account: it is a
     * document *derived* from records, not the records themselves. Every
     * figure in it is on the client and project pages either way.
     */
    prefix: 'clients:updatePack',
    feature: 'updatepack',
    message: messageFor('updatepack', 'Every figure in it is still on the client and project pages.')
  }
]

/**
 * Channels inside a gated prefix that a lower tier still needs.
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

/* ------------------------------------------------------------------ *
 * Volume
 * ------------------------------------------------------------------ */

/**
 * Which channels create one of something counted.
 *
 * Exact names, never prefixes — the opposite of the feature gates above, and
 * deliberately so. `clients:` as a prefix would catch `clients:list` and count
 * a limit against reading, which is precisely the behaviour §4.2 forbids:
 * loading data that exceeds a limit is always allowed, and only creating the
 * next one is refused.
 *
 * Two creation paths are missing from this list on purpose, because neither is
 * a user pressing "new":
 *
 * - `runRecurringInvoices` mints retainer invoices at workspace open and never
 *   touches IPC. A Free user has none — recurring invoices are Basic+ — so
 *   there is nothing to exempt in practice, and blocking one would silently
 *   skip a month's billing for somebody who *is* paying.
 * - The assistant's own tools mutate through `canUseTool`, not through this
 *   gate. They are checked where they are implemented instead; see
 *   `main/ai/tools.ts`. An assistant that could create a client would
 *   otherwise walk straight past the client limit.
 */
const LIMITED: Partial<Record<string, Limit>> = {
  'clients:create': 'clients',
  'projects:create': 'projects',
  'invoices:create': 'invoicesPerMonth',
  'goals:create': 'goals',
  'time:start': 'activeTimers',
  'ai:send': 'assistantMessages',
  'channels:create': 'channels',
  'campaigns:create': 'campaigns'
}

/**
 * `quotes:convert` makes a project *and* an invoice in one call.
 *
 * It is the one channel that consumes two allowances, and it is easy to miss
 * because its name says neither. Checked against both, so a Free user at three
 * projects cannot get a fourth through the side door.
 */
export const MULTI_LIMITED: Partial<Record<string, readonly Limit[]>> = {
  'quotes:convert': ['projects', 'invoicesPerMonth']
}

/** Every limit a channel must have room for. Empty for most channels. */
export function limitsFor(channel: IpcChannel | string): readonly Limit[] {
  const multiple = MULTI_LIMITED[channel]
  if (multiple) return multiple

  const single = LIMITED[channel]
  return single ? [single] : []
}
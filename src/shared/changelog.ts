/**
 * What changed, in the user's words.
 *
 * Shipped with the build rather than fetched, for three reasons: it works
 * offline like everything else here, it cannot disagree with the code it was
 * built alongside, and the GitHub release notes it would otherwise come from
 * say nothing but "SoloWrk 0.1.11".
 *
 * Written for somebody who uses the app, not somebody who wrote it. "Statements
 * of account" rather than "widen DocumentForPdf"; the reason a change matters
 * rather than the file it happened in.
 *
 * `changelog[0]` must be the version in package.json — there is a test for it,
 * and it fails during `npm run release`, which is the right moment to be told
 * that nobody wrote the notes.
 */

/**
 * `changed` exists so a feature moving between tiers is labelled as what it
 * is. Filing "Marketing is now part of Pro" under "improved" would be the kind
 * of thing that loses somebody's trust in the whole list.
 */
export type ChangeKind = 'added' | 'improved' | 'changed' | 'fixed'

export interface Change {
  kind: ChangeKind
  /** One line, sentence case, no trailing full stop. */
  text: string
  /** The bit worth knowing, when the headline is not self-explanatory. */
  detail?: string
}

export interface Release {
  version: string
  /** `yyyy-mm-dd`, the day it was published. */
  date: string
  /** One sentence on what this release is for. */
  headline: string
  changes: Change[]
}

export const changelog: Release[] = [
  {
    version: '0.1.12',
    date: '2026-08-24',
    headline: 'Everything an accountant asks for in January, and your data out whenever you want it.',
    changes: [
      {
        kind: 'added',
        text: 'Export anything as a CSV',
        detail:
          'Clients, invoices, quotes, expenses and time, from Settings → App. Opens in Excel or anything else, and it is free on every plan — including a lapsed one. Your work is yours.'
      },
      {
        kind: 'added',
        text: 'Year-end pack for your accountant (Pro)',
        detail:
          'One folder for the tax year: a summary on a single page, the records as CSV, and every invoice you raised rendered as a PDF. Scoped to 6 April, so nothing lands in the wrong year.'
      },
      {
        kind: 'added',
        text: 'Update notes, which is what you are reading'
      },
      {
        kind: 'improved',
        text: 'The year-end summary says which basis it used',
        detail:
          'Income is what was received, not what was invoiced. An accountant handed a figure with no basis stated has to ask.'
      }
    ]
  },
  {
    version: '0.1.11',
    date: '2026-08-24',
    headline: 'A refresh button, so you are never waiting on a background check.',
    changes: [
      {
        kind: 'added',
        text: 'Refresh button next to the SoloWrk wordmark',
        detail:
          'Re-reads your workspace, re-checks your licence and looks for a new version, all at once. It is not a reload — you keep your place and anything half-typed.'
      },
      {
        kind: 'improved',
        text: 'Buying Pro no longer takes up to six hours to appear',
        detail: 'The refresh button re-checks the licence, so an upgrade unlocks straight away.'
      }
    ]
  },
  {
    version: '0.1.10',
    date: '2026-08-24',
    headline: 'The documents that get you paid.',
    changes: [
      {
        kind: 'added',
        text: 'Your logo on invoices, quotes and receipts',
        detail: 'Set it in Settings → Business. Nothing else to do.'
      },
      {
        kind: 'added',
        text: 'Receipts for paid invoices',
        detail: 'A button on any invoice marked paid. Files itself beside the invoice it settles.'
      },
      {
        kind: 'added',
        text: 'Statements of account (Pro)',
        detail:
          'Everything one client owes, on one page, with the outstanding total split by how long it has been outstanding. On the client page.'
      },
      {
        kind: 'fixed',
        text: 'Dates on PDFs could read a day early',
        detail:
          'An invoice issued on the first showed as the last day of the previous month in some timezones.'
      },
      {
        kind: 'fixed',
        text: 'A slash in your invoice prefix silently broke exporting',
        detail: 'The PDF button appeared to do nothing rather than saying why.'
      }
    ]
  },
  {
    version: '0.1.9',
    date: '2026-08-24',
    headline: 'SoloWrk chases your late invoices, without asking you twice.',
    changes: [
      {
        kind: 'added',
        text: 'Automatic chaser schedule (Pro)',
        detail:
          'Switch it on in Settings → Invoicing & tax. Each morning it tells you which invoices have gone quiet — once for the batch, not once per invoice — with the note already written and getting firmer each time. Nothing is ever sent for you.'
      },
      {
        kind: 'added',
        text: 'A "needs chasing" list on the Invoices page',
        detail: 'Read the note, send it yourself, or stop chasing one invoice without marking it paid.'
      },
      {
        kind: 'changed',
        text: 'Marketing is now part of Pro'
      },
      {
        kind: 'improved',
        text: 'Chasing one invoice by hand stays free, on every plan',
        detail: 'Pro sells not having to remember, not the ability to ask for your own money.'
      }
    ]
  }
]

/** The notes for a specific version, if this build knows about it. */
export function releaseFor(version: string): Release | undefined {
  return changelog.find((release) => release.version === version)
}
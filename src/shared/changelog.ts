/**
 * What changed, in the user's words.
 *
 * Shipped with the build rather than fetched, for three reasons: it works
 * offline like everything else here, it cannot disagree with the code it was
 * built alongside, and the GitHub release notes it would otherwise come from
 * say nothing but "SoloWork 0.1.11".
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
    version: '0.1.18',
    date: '2026-09-07',
    headline: 'The free Pro trial is a week rather than a fortnight.',
    changes: [
      {
        kind: 'changed',
        text: 'The free Pro trial is now seven days',
        detail:
          'It was fourteen. If you are already on a trial you keep the fourteen days you were given — this applies to accounts made from now on. What happens at the end has not changed: SoloWork drops to Free, which is a smaller app rather than a locked one, and everything you made during the trial stays exactly where it is.'
      },
      {
        kind: 'changed',
        text: 'The trial countdown starts on day four',
        detail:
          'It used to appear on day ten of fourteen, which on a seven-day trial would have meant it never appeared at all and the trial ended with no warning. Four gives three days of notice, which is enough to still be there on a weekday.'
      }
    ]
  },
  {
    version: '0.1.17',
    date: '2026-09-06',
    headline: 'The app is called SoloWork now, which is what the website has called it all along.',
    changes: [
      {
        kind: 'changed',
        text: 'SoloWrk is now SoloWork',
        detail:
          'One name in one spelling, everywhere: the window title, the Start Menu, the installer, and every message the app writes. The website, the guides and your receipts have said SoloWork since launch, and having the thing on your desktop disagree with them was a small confusion nobody needed.'
      },
      {
        kind: 'fixed',
        text: 'Updating to the new name keeps your workspace and your licence',
        detail:
          'Windows files an app\'s settings under its name, so renaming moves them — and left alone that would have looked like a brand new install: no workspace, signed out, and your business sitting in a folder the app had forgotten about. It now reads the old location and moves itself across the first time you open it. You should notice nothing at all.'
      }
    ]
  },
  {
    version: '0.1.16',
    date: '2026-09-06',
    headline: 'The guides move to the website, and four things that quietly did not work now do.',
    changes: [
      {
        kind: 'changed',
        text: 'Guides have moved to the website',
        detail:
          'Every guide is now a page at solowrk-website.vercel.app/guides, which means a search engine can find the answer for you and a confusing paragraph can be fixed the same day rather than waiting for an app update. The trade is honest: reading them now needs an internet connection, where the in-app version did not.'
      },
      {
        kind: 'changed',
        text: 'Settings is reached from your account menu',
        detail:
          'It had a row in the sidebar and an entry in the account menu a few pixels above it, both going to the same place. The row has gone. Ctrl K still finds Settings like any other section.'
      },
      {
        kind: 'changed',
        text: 'A new app icon'
      },
      {
        kind: 'fixed',
        text: 'Ctrl K now understands "log 2h yesterday"',
        detail:
          'Typing a duration and a day was supposed to offer to record the time. The offer was worked out once, when the panel opened and before you had typed anything, and never again — so it never appeared, however exactly you phrased it. It is now worked out as you type, which is what it always claimed to do.'
      },
      {
        kind: 'fixed',
        text: 'Notes, quotes and expenses could be missing from search',
        detail:
          'Whether they appeared in Ctrl K depended on which part of your workspace finished loading last, so the same search could find a note one day and not the next.'
      },
      {
        kind: 'fixed',
        text: 'Changing your default block length now affects dropped tasks',
        detail:
          'Dragging a task onto the calendar with a gap found for it used whatever the default block length was when the app started, so changing it in your calendar settings had no effect until you restarted.'
      },
      {
        kind: 'fixed',
        text: 'Browse on the first-run screen could do nothing at all',
        detail:
          'If the folder picker could not open — an unreadable drive, a permission it did not have — pressing Browse produced no picker, no message and nothing to try again against, on the very first screen of the app. It now tells you what went wrong.'
      },
      {
        kind: 'fixed',
        text: 'A command that fails now says so',
        detail:
          'Commands run from Ctrl K that could not finish closed the panel and said nothing, which looks exactly like having worked. Failures now appear as a notification.'
      },
      {
        kind: 'improved',
        text: 'The guided tour covers the whole app again',
        detail:
          'It was written in August and had not moved since, while the app gained workspaces, a Library, notifications and an assistant. It now walks through all of them. Replay it any time from Settings.'
      }
    ]
  },
  {
    version: '0.1.15',
    date: '2026-09-03',
    headline: 'A licence server having a bad minute no longer signs you out.',
    changes: [
      {
        kind: 'fixed',
        text: 'A server error is treated as offline, not as a cancelled licence',
        detail:
          'If the licence server returned an error rather than an answer — a deploy restarting, a request taking too long, a rate limit — SoloWork read it as being told the licence was gone. It signed you out and removed the licence from this computer. It now treats that the same as having no internet: nothing changes, and it tries again later. Only an actual answer from the server ends a session.'
      }
    ]
  },
  {
    version: '0.1.14',
    date: '2026-09-02',
    headline: 'Every project gets a board, so moving work along is a drag rather than a form.',
    changes: [
      {
        kind: 'added',
        text: 'A board inside every project',
        detail:
          'Open a project and its tasks are three columns — to do, in progress, done. Drag a card across and that is the status changed; there is no dropdown to open and nothing to save. The list is still there behind the switcher next to Add, and whichever you pick is remembered.'
      },
      {
        kind: 'improved',
        text: 'Cards in a project no longer repeat its name',
        detail:
          'On the Tasks page, where work from every project sits together, naming the project on each card earns its place. Inside one project it was the same words down the screen.'
      }
    ]
  },
  {
    version: '0.1.13',
    date: '2026-09-01',
    headline: 'A first run that works, and a way in that does not ask you to configure anything.',
    changes: [
      {
        kind: 'fixed',
        text: 'A fresh install could start with licensing switched off',
        detail:
          'Two settings were saved at the same moment on the very first launch and overwrote each other, and the app read that as having no account server at all. It never asked you to sign in and never checked your licence. It now saves both cleanly.'
      },
      {
        kind: 'fixed',
        text: 'The window could stay on the sign-in screen after signing in',
        detail:
          'The sign-in worked and the app knew it, but the screen never changed — so the only way forward was to close it and open it again.'
      },
      {
        kind: 'changed',
        text: 'The account server is set by the app now, not by you',
        detail:
          'It used to be a box in Settings, from a time before there was a server to point at. An address typed in once outlived its reason and quietly became the one that install used forever, and no update could correct it. It has gone, and updates move it instead.'
      },
      {
        kind: 'added',
        text: 'A proper first screen',
        detail:
          'The app opens on a title card rather than straight into a form, and carries the SoloWork wordmark.'
      }
    ]
  },
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
        text: 'Refresh button next to the SoloWork wordmark',
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
    headline: 'SoloWork chases your late invoices, without asking you twice.',
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
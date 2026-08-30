import type { Feature } from './entitlements'

/**
 * How to use the thing you are already looking at.
 *
 * SoloWrk has a first-run tour and an unlock catalogue, and neither is a
 * reference. The tour runs once and points at where things are; this answers
 * "how does the calendar actually work" three weeks later, when the tour is a
 * memory and the person is trying to get something done.
 *
 * **Content, not a help system.** No search index, no article ids, no CMS.
 * Guides ship with the app as data, which means they are versioned with the
 * features they describe, work with no network, and cannot rot into a
 * knowledge base full of pages about screens that no longer exist.
 *
 * **Every guide names the feature it describes and where to find it**, so the
 * page can link straight there. A guide you have to go hunting after reading
 * is a guide that gets read once.
 *
 * Written in the second person and in order of what somebody does, not in
 * order of what the module contains. "Start a timer, stop it, and it lands on
 * the invoice" is useful; "the Time module has four views" is a description
 * of a screenshot.
 */

export interface GuideSection {
  heading: string
  /** Paragraphs. Plain prose — no markdown parsing, so no syntax to get wrong. */
  body?: string[]
  /** Numbered, for things done in an order. */
  steps?: string[]
  /** The one thing somebody would not work out on their own. */
  tip?: string
}

export interface Guide {
  id: string
  title: string
  /** Which sidebar group it belongs under, matching `navGroups`. */
  group: 'Work' | 'Business' | 'Library' | 'Getting around'
  /** One line, shown in the index. */
  summary: string
  /** Where the feature lives, for the "Open it" link. Omit if it has no page. */
  route?: string
  /** Named so the guide can say plainly that it needs a paid tier. */
  feature?: Feature
  sections: GuideSection[]
}

export const GUIDES: Guide[] = [
  /* Getting around ---------------------------------------------------- */
  {
    id: 'workspace',
    title: 'Your workspace',
    group: 'Getting around',
    summary: 'Where everything is kept, and why it is a folder rather than an account.',
    sections: [
      {
        heading: 'It is a folder on your computer',
        body: [
          'Everything SoloWrk holds lives in one folder you chose when you set it up: your clients, your projects, your invoices, your notes, your files. You can open it in Explorer any time and everything will be where you would expect it.',
          'That is deliberate. If SoloWrk disappeared tomorrow you would still have every document, every PDF and every note, in ordinary folders with ordinary names. Nothing is locked in a format only this app can read.'
        ]
      },
      {
        heading: 'What is in it',
        body: [
          'Clients holds a folder per client, with a folder per project inside it. Invoices, Quotes and Statements hold the PDFs SoloWrk generates. Documents is your own paperwork — insurance, contracts, certificates. Marketing holds campaign folders and assets.',
          'The only folder that is not for you is _app, which holds the database and the backups.'
        ],
        tip: 'Drop files straight into a project folder in Explorer and they appear in SoloWrk. It reads the folder rather than keeping its own copy.'
      },
      {
        heading: 'Backups',
        body: [
          'A snapshot of the database is taken before every migration, so an update can never be the thing that loses your data. Automatic daily backups are a paid feature; the folder they go in is _app\\backups either way.'
        ]
      }
    ]
  },
  {
    id: 'palette',
    title: 'Getting anywhere fast',
    group: 'Getting around',
    summary: 'Ctrl K, and the sentences you can type into it.',
    sections: [
      {
        heading: 'Ctrl K opens everything',
        body: [
          'Press Ctrl K anywhere in the app. Start typing and it searches your clients, projects, invoices and notes, alongside every command and every page.',
          'It is almost always faster than the sidebar once you know the name of the thing you want.'
        ]
      },
      {
        heading: 'Log time you forgot to track',
        body: [
          'Type a sentence like "log 2h yesterday" or "log 90m Tuesday drawings" and the palette offers to record it.',
          'It is deliberately cautious — if it is not certain about the duration or the day it offers nothing rather than guessing, because a command that quietly books ninety minutes to the wrong day is worse than one that does not appear.'
        ]
      }
    ]
  },

  /* Work --------------------------------------------------------------- */
  {
    id: 'projects',
    title: 'Projects',
    group: 'Work',
    route: '/projects',
    summary: 'The jobs you are doing, each with a real folder behind it.',
    sections: [
      {
        heading: 'Creating one',
        body: [
          'A project belongs to a client, or to nobody if it is your own work. Creating one makes a folder for it inside that client\'s folder, with a standard set of subfolders — brief, assets, working, deliverables — so every job is laid out the same way.',
          'You can change that standard set, or seed a project from a template that also creates its opening task list.'
        ]
      },
      {
        heading: 'What hangs off a project',
        body: [
          'Tasks, notes, time entries, expenses and invoices all point at a project. That is what makes the profitability figures possible: SoloWrk knows what a job earned and what it cost you in hours.'
        ]
      }
    ]
  },
  {
    id: 'tasks',
    title: 'Tasks',
    group: 'Work',
    route: '/tasks',
    summary: 'The to-do list, and the one-line syntax that fills it in for you.',
    sections: [
      {
        heading: 'Type the whole thing in one line',
        body: [
          'The box at the top of Tasks reads a sentence. Type "Call Dana tomorrow 2pm #Rebrand ~Admin !2" and it will pick out the date, the time, the project, the category and the priority, leaving "Call Dana" as the title.',
          'It underlines what it understood as you type, so you can see it read "tomorrow" as a date before you press enter.'
        ],
        steps: [
          '#project — matches against your real projects',
          '@client — matches against your clients',
          '~category — the colour-coded task categories',
          '!0 to !3 — priority, where !3 is highest',
          'Dates in plain words: tomorrow, Friday, next week, 12 March'
        ],
        tip: 'Anything it is not sure about is left in the title rather than guessed at. If a task comes out with "#Rebrand" still in the name, there is no project by that name yet.'
      },
      {
        heading: 'List or board',
        body: [
          'The list is one row per task and is the faster of the two for working through things. The board groups by status — to do, in progress, done — and you drag cards between columns.',
          'Click a title in the list to rename it in place. There is no edit mode and no save button.'
        ]
      },
      {
        heading: 'Archiving rather than deleting',
        body: [
          'Archiving takes a task off the board and keeps everything about it. Deleting puts it in Trash, where you can still get it back. Neither is permanent straight away.'
        ]
      }
    ]
  },
  {
    id: 'time',
    title: 'Time',
    group: 'Work',
    route: '/time',
    summary: 'Timers, what makes an hour billable, and how it reaches an invoice.',
    sections: [
      {
        heading: 'Tracking',
        body: [
          'Start a timer against a project and it runs in the corner of the app until you stop it. One timer at a time on the free tier.',
          'Every entry carries a rate and a billable flag. The rate comes from the project, then the client, then your default in Settings — so setting a client\'s rate once means every hour on their work is priced correctly without thinking about it.'
        ]
      },
      {
        heading: 'Getting it onto an invoice',
        body: [
          'When you create an invoice for a client, unbilled billable time for their projects can be pulled straight in as lines. Once it is on an invoice it is marked billed, so the same hour cannot be charged twice.'
        ],
        tip: 'Untracked time is the thing that quietly makes a job unprofitable. The capacity calculator on the Business plan page uses your real tracked hours, which is usually a shock the first time.'
      }
    ]
  },
  {
    id: 'calendar',
    title: 'Calendar',
    group: 'Work',
    route: '/calendar',
    summary: 'Blocks, tasks with due dates, and what your week actually holds.',
    sections: [
      {
        heading: 'Blocks are hours you have committed',
        body: [
          'A block is a piece of time set aside — a meeting, a morning on a job, a deadline. Blocks can be attached to a project, which is how the calendar knows what a week is actually spent on.',
          'Tasks with a due date appear alongside them, so a day shows both what is booked and what is owed.'
        ]
      },
      {
        heading: 'Working capacity',
        body: [
          'Your working days and daily hours are set in the calendar settings. They are not decoration: the capacity calculator on the Business plan page works out what the business can earn from them.'
        ]
      }
    ]
  },
  {
    id: 'notes',
    title: 'Notes',
    group: 'Work',
    route: '/notes',
    summary: 'Markdown files in your workspace, not rows in a database.',
    sections: [
      {
        heading: 'Every note is a file',
        body: [
          'Notes are markdown files saved in your workspace, next to the work they are about. You can open one in any editor, and anything you write outside SoloWrk shows up inside it.',
          'A note either belongs to a project or stands on its own in Notes.'
        ]
      }
    ]
  },

  /* Business ------------------------------------------------------------ */
  {
    id: 'business-plan',
    title: 'Business plan',
    group: 'Business',
    route: '/business-plan',
    summary: 'Attach the plan you have, or answer questions and let SoloWrk write one.',
    sections: [
      {
        heading: 'Two ways in',
        body: [
          'If you already have a plan — Word, PDF, markdown, plain text — attach it. SoloWrk reads it, lays out its contents down the side, and shows you which standard sections it does not cover.',
          'If you do not have one, choose "Build one with me". It asks plain questions about your business, one section at a time, and turns your answers into the document. Every question can be skipped, and you can finish at any point.'
        ],
        tip: 'Nothing in the interview is written by a model. The questions are phrased so your answers go straight in as prose, which means the plan says exactly what you said and cannot invent a fact about your business.'
      },
      {
        heading: 'What this business can earn',
        body: [
          'The card at the top multiplies your working hours by your billable share and your rate. Most freelancers have never done that sum, and find the income they are planning for is not reachable at the rate they charge.',
          'It starts from your own tracked history where there is enough of it, and says so. If you told the interview what you charge and what you need to take home, those numbers are used here.'
        ]
      },
      {
        heading: 'It feeds Marketing',
        body: [
          'What you wrote about who you are trying to reach, and the channels you mentioned, can be sent to the marketing plan. Nothing is copied across without you seeing it first.'
        ]
      },
      {
        heading: 'Starting over',
        body: [
          '"Start again" makes SoloWrk forget the current plan and offers you the two routes again. The file stays in Documents\\Business — it is never deleted — so you can attach it back at any point.'
        ]
      }
    ]
  },
  {
    id: 'clients',
    title: 'Clients',
    group: 'Business',
    route: '/clients',
    summary: 'Who you work for, what stage they are at, and where they came from.',
    sections: [
      {
        heading: 'Stages',
        body: [
          'A client sits at one of five stages: lead, prospect, active, dormant or former. The board view lets you drag between them.',
          'This is the sales pipeline. It lives here rather than in Marketing because a person should exist in one place, and marketing is about how work gets found rather than what happens after somebody puts their hand up.'
        ]
      },
      {
        heading: 'Where they came from',
        body: [
          'At the bottom of the client form there is an optional question about which channel or campaign brought them. It is the only thing the Marketing Results tab is built from — there is no tracking of any kind, so if you do not answer it, nothing can be attributed.',
          'It takes two seconds when you add somebody and is almost impossible to reconstruct a year later.'
        ]
      }
    ]
  },
  {
    id: 'invoices',
    title: 'Invoices and quotes',
    group: 'Business',
    route: '/invoices',
    summary: 'Raising them, getting paid, and chasing what is late.',
    sections: [
      {
        heading: 'The life of an invoice',
        body: [
          'Draft, sent, paid, cancelled. Overdue is not a status — it is worked out from the due date and today, so it can never be stale or wrong.',
          'Unbilled time and expenses for the client can be pulled in as lines when you create one.'
        ]
      },
      {
        heading: 'Quotes become work',
        body: [
          'Accepting a quote can create the project and the first invoice in one step, so the thing you priced is the thing you deliver.'
        ]
      },
      {
        heading: 'Chasing',
        body: [
          'Any overdue invoice can have a chaser drafted from its row, on any tier. What a paid tier adds is the schedule: chasers raised automatically at the intervals you choose.',
          'Nothing is emailed to a client without you pressing send, unless you have explicitly turned that on.'
        ]
      }
    ]
  },
  {
    id: 'marketing',
    title: 'Marketing',
    group: 'Business',
    route: '/marketing',
    feature: 'marketing',
    summary: 'Five tabs: what you plan, what you write, what you spend, and what it returned.',
    sections: [
      {
        heading: 'Start in Plan',
        body: [
          'Add the channels you actually use, then set a commitment against each: two a week on LinkedIn, one a month by email. The commitment is the point of the whole module.',
          'Zero is a real answer. A directory listing does not need posting to, and a channel with no commitment simply never appears as a gap.'
        ]
      },
      {
        heading: 'Content is where the gaps show',
        body: [
          'The calendar draws the difference between what you promised and what is actually there, as dashed outlines on the days a rhythm would put them. Click one and it creates the post, dated and on the right channel.',
          'Freelance marketing fails on consistency rather than strategy — everybody knows they should post, and almost nobody does in the weeks when work is busy, which are exactly the weeks that decide whether there is work in three months.'
        ],
        tip: 'Nothing is posted for you and nothing ever will be. Copy to clipboard is the whole publishing step, and marking something published is you telling SoloWrk what you did.'
      },
      {
        heading: 'Campaigns gather the work',
        body: [
          'A campaign holds the posts written for it, the jobs that have to happen first, and a real folder for the files they produce. The tasks appear on your normal Tasks page; the folder appears in Files.'
        ]
      },
      {
        heading: 'Library is what you reuse',
        body: [
          'Case studies, testimonials, reusable files, and a swipe file of other people\'s marketing worth stealing from. All of it searchable when you sit down to write.',
          'On Pro, a case study can be drafted from a finished project with the real dates, hours and deliverables filled in.'
        ]
      },
      {
        heading: 'Results is the reckoning',
        body: [
          'Where clients came from, what campaigns returned, whether you kept your commitments, and spend against budget. It is built entirely from what you have told it, so it is only as good as the source question on the client form.'
        ]
      }
    ]
  },
  {
    id: 'goals',
    title: 'Goals',
    group: 'Business',
    route: '/goals',
    summary: 'Targets measured from your real numbers rather than ticked off by hand.',
    sections: [
      {
        heading: 'They measure themselves',
        body: [
          'A goal points at something SoloWrk already counts — revenue, clients, projects, hours — over a period you set. Progress is worked out from your records rather than updated manually, so it cannot flatter you.'
        ]
      }
    ]
  },
  {
    id: 'finance',
    title: 'Finance',
    group: 'Business',
    route: '/finance',
    summary: 'What came in, what went out, and what to put aside for tax.',
    sections: [
      {
        heading: 'The shape of it',
        body: [
          'Income comes from paid invoices. Expenses are what you record, with receipts attached where you have them. Mileage is claimed at the rate for the year.',
          'The tax set-aside percentage in Settings drives the figure it suggests you keep back. It is a working estimate to stop a January surprise, not a tax return.'
        ]
      }
    ]
  },

  /* Library -------------------------------------------------------------- */
  {
    id: 'files',
    title: 'Files',
    group: 'Library',
    route: '/files',
    summary: 'A browser for your workspace folder, not a separate store.',
    sections: [
      {
        heading: 'It is the same folder',
        body: [
          'Files shows your workspace as it is on disk. Adding a file here puts it there; putting a file there in Explorer shows it here. There is no import step and no second copy.'
        ]
      }
    ]
  },
  {
    id: 'documents',
    title: 'Documents',
    group: 'Library',
    route: '/documents',
    summary: 'Your paperwork, with reminders before it expires.',
    sections: [
      {
        heading: 'What belongs here',
        body: [
          'Insurance, certificates, contracts, licences — the paperwork that is about your business rather than about a job. Each one can carry an expiry date, and you get a notification before it runs out.'
        ]
      }
    ]
  },
  {
    id: 'trash',
    title: 'Trash',
    group: 'Library',
    route: '/trash',
    summary: 'Where deleted things wait, and how to get them back.',
    sections: [
      {
        heading: 'Deleting is not final',
        body: [
          'Deleting a record moves it out of its table and keeps enough to put it back. Restore returns it whole.',
          'It is in the Library rather than pinned at the bottom because it is a place things are kept, and it wants finding when you are already looking for something you cannot see.'
        ]
      }
    ]
  },

  /* Assistant ----------------------------------------------------------- */
  {
    id: 'assistant',
    title: 'The assistant',
    group: 'Getting around',
    route: '/assistant',
    summary: 'What it can see, what it can change, and what it asks first.',
    sections: [
      {
        heading: 'It reads your business plan',
        body: [
          'Before every answer, the assistant is given your business plan and the shape of your workspace. That is what makes the advice about your business rather than about freelancing in general.'
        ]
      },
      {
        heading: 'It asks before it changes anything',
        body: [
          'Reading your data runs unattended — asking permission to look at a list you are already looking at would be theatre. Anything that creates, edits or deletes stops and waits for you to say yes.'
        ]
      },
      {
        heading: 'It cannot leave your workspace',
        body: [
          'The assistant can only read and write inside your workspace folder. It has no access to the rest of your computer.'
        ]
      }
    ]
  }
]

/** The groups, in the order the page draws them. */
export const GUIDE_GROUPS: Guide['group'][] = ['Getting around', 'Work', 'Business', 'Library']

/**
 * Guides matching a search.
 *
 * Searches the body as well as the title, because somebody looking for help
 * types the word that is confusing them — "billable", "overdue", "cadence" —
 * rather than the name of the page it is on.
 */
export function searchGuides(guides: Guide[], query: string): Guide[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return guides

  return guides.filter((guide) => {
    const haystack = [
      guide.title,
      guide.summary,
      ...guide.sections.flatMap((section) => [
        section.heading,
        ...(section.body ?? []),
        ...(section.steps ?? []),
        section.tip ?? ''
      ])
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(needle)
  })
}

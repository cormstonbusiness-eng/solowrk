/**
 * The first-run tour.
 *
 * `target` is the value of a `data-tour` attribute on a real element — the tour
 * measures whatever is on screen rather than holding its own copy of the
 * layout, so a step breaks loudly (no highlight) instead of quietly pointing at
 * the wrong thing if a component moves. A step with no target is centred.
 *
 * Copy rule: describe what the section is *for*. Several sections are still
 * being built, and the closing step says so rather than overselling.
 */
export interface TourStep {
  id: string
  title: string
  body: string
  /** data-tour value to highlight. Omit for a centred card. */
  target?: string
  /** Route to be on before this step shows. */
  route?: string
  placement?: 'right' | 'bottom' | 'top' | 'left'
}

export const tourSteps: TourStep[] = [
  {
    id: 'welcome',
    title: 'A quick tour',
    body: "Six steps and you will know where everything lives. You can skip it now and replay it any time from Settings.",
    route: '/'
  },
  {
    id: 'sidebar',
    title: 'Everything is in here',
    body: 'Your sections, grouped three ways: Work is the day to day, Business is the money, Library is your files and paperwork.',
    target: 'sidebar',
    placement: 'right'
  },
  {
    id: 'nav-work',
    title: 'Work',
    body: 'Projects hold the jobs you are doing. Tasks are the to-do list underneath them, colour-coded by category with due dates. Calendar shows both alongside your meetings.',
    target: 'nav-work',
    placement: 'right'
  },
  {
    id: 'nav-business',
    title: 'Business',
    body: 'Clients keep rates and contacts in one place. Invoices raises and chases them. Finance shows what you made and spent by day, month and tax year.',
    target: 'nav-business',
    placement: 'right'
  },
  {
    id: 'dashboard-stats',
    title: 'Your HQ',
    body: 'The dashboard opens on the numbers that matter: invoiced this month, what you are owed, what is overdue, and hours tracked. These figures are samples until the money sections are built.',
    target: 'dashboard-stats',
    route: '/',
    placement: 'bottom'
  },
  {
    id: 'dashboard-actions',
    title: 'Start from anywhere',
    body: 'The things you do most often sit at the top of the dashboard, so starting a timer or a new project is never more than one click away.',
    target: 'dashboard-actions',
    route: '/',
    placement: 'bottom'
  },
  {
    id: 'nav-assistant',
    title: 'Claude, and your settings',
    body: 'The Assistant runs on your own Claude subscription and will be able to read your files and draft real work, asking before it changes anything. Settings holds your business details and your workspace folder.',
    target: 'nav-footer',
    placement: 'right'
  },
  {
    id: 'done',
    title: 'That is the shape of it',
    body: 'Your files live in the folder you chose — open it any time from Settings. Sections still being built say so on the page, so you always know what is real.',
    route: '/'
  }
]
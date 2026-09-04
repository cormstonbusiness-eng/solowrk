/**
 * The first-run tour.
 *
 * `target` is the value of a `data-tour` attribute on a real element — the tour
 * measures whatever is on screen rather than holding its own copy of the
 * layout, so a step breaks loudly (no highlight) instead of quietly pointing at
 * the wrong thing if a component moves. A step with no target is centred.
 *
 * Copy rule: describe what the section is *for*. When this was first written
 * several sections were still shells and the closing step said so; most are
 * built now, so the hedge has gone rather than being left to read as false
 * modesty about work that is finished.
 *
 * Two rules learned by getting them wrong, both worth keeping:
 *
 * **Only anchor to something a brand new workspace actually renders.** The
 * tour runs against an empty database on a first launch. The title bar timer
 * was an obvious candidate for a step and is the wrong one: it draws an empty
 * wrapper until a timer is running, so the spotlight would have collapsed to
 * nothing on the only run that matters. Things like it are described in the
 * copy of a step anchored to something permanent instead.
 *
 * **Do not walk the tour through the sections themselves.** Routing to
 * Calendar or Finance on a first run means touring empty screens, and routing
 * to Marketing on a free licence means touring an upsell. The sidebar groups
 * are the anchors, so every section can be described from a page that has
 * something on it.
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
    body: 'A minute, and you will know where everything lives. You can skip it now and replay it any time from Settings.',
    route: '/'
  },
  {
    id: 'workspace',
    title: 'One folder, one business',
    body: 'Your workspace is a folder on your computer with its own database — its own clients, its own invoice numbering, its own tax settings. Run a second business and it gets a second workspace, and you switch between them here.',
    target: 'workspace',
    placement: 'right'
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
    body: 'Projects hold the jobs, each with a real folder behind it. Tasks are the list underneath — type one line and it fills in the rest. Time runs the timers that end up on an invoice, and Calendar shows what is booked alongside what is due.',
    target: 'nav-work',
    placement: 'right'
  },
  {
    id: 'nav-business',
    title: 'Business',
    body: 'Clients keeps who you work for and what stage they are at. Invoices raises them and chases what is late. Finance is what came in, what went out, and what to put aside for tax. Marketing is where the next job comes from.',
    target: 'nav-business',
    placement: 'right'
  },
  {
    id: 'nav-library',
    title: 'Library',
    body: 'Files browses the workspace folder itself rather than a separate store. Documents holds your paperwork and reminds you before it expires. Trash is why nothing is ever really lost — deleted things wait there until you say otherwise.',
    target: 'nav-library',
    placement: 'right'
  },
  {
    id: 'dashboard-stats',
    title: 'Your HQ',
    body: 'The dashboard opens on the numbers that matter: paid this month, what you are owed, what is overdue, and hours tracked. Every card is a link to the page that deals with it.',
    target: 'dashboard-stats',
    route: '/',
    placement: 'bottom'
  },
  {
    id: 'dashboard-actions',
    title: 'Start from anywhere',
    body: 'The things you do most often sit at the top of the dashboard, so tracking time or starting a project is never more than one click away.',
    target: 'dashboard-actions',
    route: '/',
    placement: 'bottom'
  },
  {
    id: 'palette',
    title: 'Ctrl K finds anything',
    body: 'One keystroke, from any screen. Search every project, client, task, invoice and document, or type a command — "start timer on Rebrand", "new invoice" — and press Enter. Ctrl Shift I catches a stray idea without leaving what you are doing.',
    route: '/'
  },
  {
    id: 'sidebar-tools',
    title: 'Two things that are not sections',
    body: 'The bell collects what actually needs you — an invoice gone overdue, a document about to expire — so none of it depends on you remembering to go and look. Below it is the assistant.',
    target: 'sidebar-tools',
    placement: 'right'
  },
  {
    id: 'assistant',
    title: 'An assistant that knows your business',
    body: 'It reads your business plan before it answers, so the advice is about your business rather than freelancing in general. It asks before it creates, edits or deletes anything, and it cannot see past your workspace folder.',
    target: 'nav-assistant',
    placement: 'right'
  },
  {
    id: 'account',
    title: 'Your account and your settings',
    body: 'Everything about you rather than about the work: your business details, your tax set-aside, the automations that run in the background, your licence and your updates.',
    target: 'nav-footer',
    placement: 'right'
  },
  {
    id: 'done',
    title: 'That is the shape of it',
    body: 'Your work lives in the folder you chose, as ordinary files you can open by hand — open it any time from Settings. Replay this tour whenever you want it again, and the written guides to every section are on the SoloWork website.',
    route: '/'
  }
]
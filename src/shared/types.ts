/**
 * Types shared across the process boundary.
 *
 * Money is always stored and passed as **integer pence** — never a float. A
 * `Rate` of 5500 is £55.00. Formatting to pounds happens only at the edge, in
 * the renderer. Percentages are stored as **basis points** (2000 = 20.00%) so
 * VAT arithmetic stays in integers too.
 */

import type { Platform } from './social'

export type { Platform }

/** Integer pence. */
export type Pence = number
/** Hundredths of a percent. 2000 = 20%. */
export type BasisPoints = number

/**
 * What happens when a chaser comes due.
 *
 * Two words rather than a boolean, because `chaseAuto: false` reads as the
 * feature being off when what it actually means is that the note is written and
 * waiting for you.
 */
export type ChaseSend = 'hold' | 'auto'

/**
 * Where a message is up to.
 *
 * 'held' and 'queued' look similar and are not: one is waiting for a person,
 * the other is waiting for the network. A user looking at their outbox needs
 * to know which, because only one of them is going to resolve itself.
 */
export type MailStatus = 'held' | 'queued' | 'sent' | 'failed' | 'cancelled'

export interface QueuedMail {
  id: number
  kind: string
  invoiceId: number | null
  /** Which milestone of the chase schedule wrote this. */
  attempt: number
  to: string
  subject: string
  body: string
  status: MailStatus
  /** Sending attempts so far, not chase milestones. */
  attempts: number
  lastError: string | null
  /** Not before this, after a transient failure. */
  sendAfter: string | null
  createdAt: string
  sentAt: string | null
}

export interface BusinessSettings {
  businessName: string
  contactName: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  postcode: string
  country: string

  /** VAT registration drives whether invoices show a VAT line at all. */
  vatRegistered: boolean
  vatNumber: string
  vatRate: BasisPoints

  currency: string
  defaultHourlyRate: Pence
  paymentTermsDays: number

  /** Share of income to hold back for tax, shown as a set-aside pot. */
  taxSetAsidePercent: number
  /** UK default: 6 April. */
  taxYearStartDay: number
  taxYearStartMonth: number

  invoicePrefix: string
  nextInvoiceNumber: number
  quotePrefix: string
  nextQuoteNumber: number

  /** Workspace-relative path to the business logo, shown on the dashboard. */
  logoFile: string

  /** Workspace-relative path to the attached business plan document. */
  businessPlanFile: string

  /**
   * Whether to raise chasers for overdue invoices. Off until asked for — an
   * app that started drafting notes to a customer's clients because it was
   * installed would be indefensible, however good the drafts are.
   */
  chaseEnabled: boolean

  /**
   * The user's own mail server. Empty means chasers still only draft.
   *
   * The password is deliberately absent from this type: it lives in the OS
   * keychain, never in the workspace database, and never crosses the bridge.
   * See `main/services/mail.ts`.
   */
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  /** Who the client sees it from, when that differs from the sign-in address. */
  smtpFrom: string

  /**
   * 'hold' drafts the chaser and waits for a press; 'auto' sends it on the
   * schedule. Default 'hold' \u2014 automatically emailing somebody's client in
   * their name should never be the consequence of leaving a default alone.
   */
  chaseSend: ChaseSend
  /** Days past due at which to raise each chaser, comma-separated. */
  chaseDays: string
}

/** The attached business plan, as the Settings page sees it. */
export interface BusinessPlanStatus {
  /** Workspace-relative path, or empty when nothing is attached. */
  file: string
  /** Just the file name, for display. */
  name: string
  /** True when SoloWrk can write back to it — markdown and text, not PDF or Word. */
  editable: boolean
  /** Characters of readable text pulled out of it. */
  length: number
  /** When the text was last extracted. */
  readAt: string | null
  /** The full extracted text, so the preview can show what is actually read. */
  preview: string
  /** How many characters reach the assistant — all of them, short of the ceiling. */
  sentLength: number
  /** True only when the document is so large it had to be cut. */
  truncated: boolean
  /** Set when the last extraction failed — shown instead of the preview. */
  error?: string
}

export interface Settings extends BusinessSettings {
  createdAt: string
  updatedAt: string
}

/** Everything the wizard collects before a workspace can be created. */
export interface WorkspaceSetup {
  path: string
  business: Pick<
    BusinessSettings,
    | 'businessName'
    | 'contactName'
    | 'email'
    | 'phone'
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'postcode'
    | 'vatRegistered'
    | 'vatNumber'
    | 'defaultHourlyRate'
    | 'paymentTermsDays'
  >
}

/**
 * An overdue invoice that has crossed a milestone in the chase schedule and
 * has a note waiting. Lives here rather than beside the service so the
 * renderer can name it without importing anything from the main process.
 */
export interface DueChase {
  invoice: InvoiceWithContext
  /** How many days past its due date, today. */
  daysLate: number
  /** Which attempt this would be, counting from 1. */
  attempt: number
  /** The total in the schedule, so the UI can say "2 of 3". */
  attempts: number
}

export type WorkspaceStatus =
  | { state: 'unconfigured'; suggestedPath: string }
  /** Configured, but the folder or database has gone (moved drive, deleted). */
  | { state: 'missing'; path: string; suggestedPath: string }
  | { state: 'ready'; path: string }

/** Result of inspecting a folder the user picked in the wizard. */
export interface FolderInspection {
  path: string
  exists: boolean
  isEmpty: boolean
  /** True when this folder already holds a SoloWrk workspace we can adopt. */
  hasExistingWorkspace: boolean
  writable: boolean
}

/* ------------------------------------------------------------------ *
 * Clients, projects and tasks
 * ------------------------------------------------------------------ */

/**
 * Where a client stands with you.
 *
 * `past` exists because the boolean this replaced used `false` for "dormant" —
 * work that finished — and folding that into `not_interested` would relabel
 * every completed client as a lost lead.
 */
export type ClientStatus = 'active' | 'interested' | 'not_interested' | 'past'

export const CLIENT_STATUSES: {
  value: ClientStatus
  label: string
  hint: string
  colour: string
}[] = [
  { value: 'interested', label: 'Interested', colour: '#F5A623', hint: 'Enquired, not decided' },
  { value: 'active', label: 'Active', colour: '#30A46C', hint: 'Working with them now' },
  { value: 'past', label: 'Past', colour: '#8a8a93', hint: 'Worked with them before' },
  { value: 'not_interested', label: 'Not interested', colour: '#E5484D', hint: 'Said no' }
]

export interface Client {
  id: number
  name: string
  contactName: string
  email: string
  phone: string
  address: string
  vatNumber: string
  /** null means "fall back to the rate in Settings". */
  defaultRate: Pence | null
  paymentTermsDays: number | null
  notes: string
  colour: string
  /** Relative to the workspace root. */
  folder: string
  /** Where they stand. Distinct from `archived`, which hides the record. */
  status: ClientStatus
  /** When they were first marked interested, for the leads goal. Never cleared. */
  interestedAt: string | null
  /** When they first became an active client, for the new-clients goal. */
  becameActiveAt: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled'

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; colour: string }[] = [
  { value: 'planned', label: 'Planned', colour: '#8a8a93' },
  { value: 'active', label: 'Active', colour: '#3B82F6' },
  { value: 'on_hold', label: 'On hold', colour: '#F5A623' },
  { value: 'completed', label: 'Completed', colour: '#30A46C' },
  { value: 'cancelled', label: 'Cancelled', colour: '#E5484D' }
]

export interface Project {
  id: number
  clientId: number | null
  name: string
  description: string
  status: ProjectStatus
  rate: Pence | null
  budget: Pence | null
  startsOn: string | null
  dueOn: string | null
  colour: string
  folder: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

/** A project with the joined bits the list and detail views need. */
export interface ProjectSummary extends Project {
  clientName: string | null
  taskCount: number
  openTaskCount: number
}

export interface Category {
  id: number
  name: string
  colour: string
  sortOrder: number
}

export type TaskStatus = 'todo' | 'doing' | 'done'

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'done', label: 'Done' }
]

/** 0 none, 1 normal, 2 high, 3 urgent. */
export const PRIORITIES: { value: number; label: string; colour: string }[] = [
  { value: 0, label: 'None', colour: '#5a5a63' },
  { value: 1, label: 'Normal', colour: '#8a8a93' },
  { value: 2, label: 'High', colour: '#F5A623' },
  { value: 3, label: 'Urgent', colour: '#E5484D' }
]

export interface Task {
  id: number
  projectId: number | null
  categoryId: number | null
  parentId: number | null
  title: string
  notes: string
  status: TaskStatus
  priority: number
  dueAt: string | null
  /**
   * How long this is expected to take. Null means nobody has said.
   *
   * Separate from `scheduledAt` because they are separate claims: one is
   * about the work, the other about the diary, and a task can have either
   * without the other.
   */
  estimateMinutes: number | null
  /**
   * When it is happening, copied from the block that schedules it.
   *
   * The block is still the record. This is here so a task list can say
   * "Thursday 10:00" without joining the calendar, and so "unscheduled" is
   * one indexed lookup.
   */
  scheduledAt: string | null
  /** Overrides the category's colour. Empty means "inherit". */
  colour: string
  sortOrder: number
  completedAt: string | null
  /** Off the board, but kept whole. Nothing about the task is lost. */
  archived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskWithContext extends Task {
  projectName: string | null
  projectColour: string | null
  categoryName: string | null
  categoryColour: string | null
  subtaskCount: number
  subtaskDoneCount: number
}

export interface Note {
  id: number
  /** Null for a standalone note in the Notes section. */
  projectId: number | null
  title: string
  file: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface NoteWithContext extends Note {
  projectName: string | null
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Account and licence
 * ------------------------------------------------------------------ */

/** The signed-in account, as the app is allowed to know it. */
export interface AuthAccount {
  email: string
  name: string
  /** What they bought, for display. Empty until a licence server says. */
  plan: string
  /**
   * What the plan unlocks, as opaque names the server chooses — `assistant`,
   * `marketing`, and whatever comes later.
   *
   * Separate from `plan` on purpose. `plan` is text to show a person, so it can
   * be reworded freely; this is the part the app acts on. Keeping them apart
   * means pricing can be restructured on the server without shipping a release,
   * and without every install that never updates disagreeing about what Pro is.
   */
  features: string[]
  /** yyyy-mm-dd, or empty for a licence that does not expire. */
  expiresOn: string
}

export interface AuthState {
  /** True once a token is held. Not proof the licence is still valid. */
  signedIn: boolean
  account: AuthAccount | null
  /**
   * Whether an account server is configured at all. False means the app runs
   * unlicensed and ungated — which is the state before a backend exists.
   */
  configured: boolean
  /** When the licence was last confirmed with the server. */
  verifiedAt: string | null
  /**
   * Set when the last check could not reach the server. The app keeps working:
   * a licence that fails closed on a train is a licence that loses a customer.
   */
  offline: boolean
  /**
   * The licence has lapsed, but the app still opens — read what is there,
   * export it, print it, change nothing.
   *
   * A local-first app that goes dark when a card expires locks someone out of
   * their own files, sitting on their own disk, which is the exact promise it
   * was sold on. Read-only keeps that promise, and a working app they cannot
   * type into is a better reminder to renew than one they cannot open.
   */
  readOnly: boolean
  /** Why, in the server's own words. Shown verbatim while read-only. */
  lapsedReason: string
  error: string
}

/**
 * Where the app is up to with updating itself.
 *
 * `unsupported` means a development build or one run from a checkout: there is
 * no installer to replace, so a check would be meaningless rather than failed.
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  /** The version on offer, once one is known. */
  version: string
  notes: string
  /** Download progress, 0–100. */
  percent: number
  error: string
}

export type NotificationKind = 'info' | 'due' | 'late' | 'money' | 'assistant'

export interface AppNotification {
  id: number
  kind: NotificationKind
  title: string
  body: string
  /** Route to open when clicked, or empty. */
  link: string
  readAt: string | null
  archived: boolean
  createdAt: string
}

export interface NotificationInput {
  kind?: NotificationKind
  title: string
  body?: string
  link?: string
  /**
   * Stable identity for a recurring alert. The same key never produces a
   * second notification, so a late invoice is mentioned once, not daily.
   */
  dedupeKey?: string
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

/**
 * Everything but `custom` is measured from data the app already holds, so a
 * goal cannot drift from reality by being updated by hand.
 */
export type GoalKind =
  | 'revenue'
  | 'profit'
  | 'clients'
  | 'leads'
  | 'projects'
  | 'hours'
  | 'posts'
  | 'custom'

export type GoalPeriod = 'month' | 'quarter' | 'year' | 'once'

export type GoalStatus = 'active' | 'achieved' | 'missed' | 'archived'

export const GOAL_KINDS: {
  value: GoalKind
  label: string
  hint: string
  money: boolean
}[] = [
  { value: 'revenue', label: 'Revenue', hint: 'Invoices paid in the period', money: true },
  { value: 'profit', label: 'Profit', hint: 'Paid income less expenses', money: true },
  {
    value: 'clients',
    label: 'New clients',
    // Won, not added. A lead who has not decided is not a client yet, and
    // counting them as one makes the number flattering and useless.
    hint: 'Clients who became active in the period',
    money: false
  },
  {
    value: 'leads',
    label: 'New interested clients',
    hint: 'Enquiries marked interested in the period',
    money: false
  },
  { value: 'projects', label: 'Projects finished', hint: 'Marked completed', money: false },
  { value: 'hours', label: 'Hours tracked', hint: 'From your timer', money: false },
  { value: 'posts', label: 'Posts published', hint: 'From Marketing', money: false },
  { value: 'custom', label: 'Something else', hint: 'You update the number', money: false }
]

export const GOAL_PERIODS: { value: GoalPeriod; label: string }[] = [
  { value: 'month', label: 'Every month' },
  { value: 'quarter', label: 'Every quarter' },
  { value: 'year', label: 'This tax year' },
  { value: 'once', label: 'One-off, by a date' }
]

export interface Goal {
  id: number
  name: string
  description: string
  kind: GoalKind
  /** Integer pence for revenue and profit; a plain count otherwise. */
  target: number
  /** Only meaningful for `custom` goals. */
  manual: number
  period: GoalPeriod
  startsOn: string | null
  endsOn: string | null
  colour: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
}

export interface GoalProgress extends Goal {
  /** Measured from real data, except for `custom` where it is `manual`. */
  current: number
  /** Basis points of the target, capped at 10000 for the bar. */
  share: BasisPoints
  range: { from: string; to: string }
  /** Days left in the period, or null for a goal with no end. */
  daysLeft: number | null
  /**
   * Where you would land at the current rate. Null before there is enough of
   * the period elapsed to extrapolate honestly.
   */
  projected: number | null
}

export type GoalInput = Partial<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }

/** What a template recreates when a project is made from it. */
export interface TemplatePayload {
  folders: string[]
  tasks: { title: string; categoryId: number | null; priority: number; status: TaskStatus }[]
}

export interface Template {
  id: number
  name: string
  description: string
  payload: TemplatePayload
  createdAt: string
  updatedAt: string
}

/* Inputs — what the renderer sends when creating or editing. */

export type ClientInput = Partial<
  Omit<Client, 'id' | 'folder' | 'createdAt' | 'updatedAt'>
> & { name: string }

export type ProjectInput = Partial<
  Omit<Project, 'id' | 'folder' | 'createdAt' | 'updatedAt'>
> & { name: string; templateId?: number | null }

export type TaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & { title: string }

export interface TaskFilter {
  projectId?: number | null
  categoryId?: number | null
  status?: TaskStatus
  /** Only top-level tasks when true — subtasks come back nested with their parent. */
  topLevelOnly?: boolean
  search?: string
  dueBefore?: string
  /** With `dueBefore`, bounds a window — the calendar asks for one month. */
  dueAfter?: string
  /**
   * Archived tasks are hidden everywhere unless asked for. `only` is the
   * archive screen; `true` includes both, for search.
   */
  archived?: boolean | 'only'
}

/* ------------------------------------------------------------------ *
 * Files and documents
 * ------------------------------------------------------------------ */

export interface FileEntry {
  name: string
  /** Relative to the workspace root — the only kind of path the renderer sees. */
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: string
  extension: string
}

export interface DocumentRecord {
  id: number
  title: string
  category: string
  file: string
  tags: string[]
  notes: string
  /** Renewal date for insurance, certificates and licences. */
  expiryAt: string | null
  clientId: number | null
  createdAt: string
  updatedAt: string
}

export type DocumentInput = Partial<
  Omit<DocumentRecord, 'id' | 'file' | 'createdAt' | 'updatedAt'>
>

/** Suggested categories, matching the folders the wizard creates. */
export const DOCUMENT_CATEGORIES = ['Business', 'Contracts', 'Insurance', 'Tax']

/* ------------------------------------------------------------------ *
 * Time, quotes, invoices, expenses
 * ------------------------------------------------------------------ */

export interface TimeEntry {
  id: number
  projectId: number | null
  taskId: number | null
  startedAt: string
  /** null while the timer is running. */
  endedAt: string | null
  /** Seconds. */
  duration: number
  rate: Pence
  billable: boolean
  notes: string
  invoiceLineId: number | null
  createdAt: string
  updatedAt: string
}

export interface TimeEntryWithContext extends TimeEntry {
  projectName: string | null
  projectColour: string | null
  clientName: string | null
  taskTitle: string | null
}

export interface RunningTimer {
  entry: TimeEntryWithContext
  /** Seconds elapsed at the moment the main process answered. */
  elapsed: number
}

export type LineKind = 'fixed' | 'time' | 'expense'

/**
 * The things that can be exported as plain CSV.
 *
 * Never gated, in either tier. `/terms` promises exports keep working even on
 * a lapsed licence, and the whole argument for a local-first app is that the
 * work belongs to the person who did it.
 */
export const DATASETS = ['clients', 'invoices', 'quotes', 'expenses', 'time'] as const

export type Dataset = (typeof DATASETS)[number]

/** What the year-end pack put on disk, so the app can say so afterwards. */
export interface YearEndPack {
  /** Workspace-relative folder holding everything below. */
  folder: string
  taxYearLabel: string
  /** Relative paths of every file written, in the order they were made. */
  files: string[]
  /** Invoice PDFs that were rendered into the pack. */
  invoicePdfs: number
}

/**
 * What the PDF renderer is given.
 *
 * A union rather than one widening interface, because a statement's table is
 * rows of invoices and an invoice's table is rows of work — sharing a `lines`
 * field between them would mean every renderer branch checking which kind of
 * thing it had been handed anyway, with nothing stopping it getting that
 * wrong.
 *
 * These live here rather than beside the renderer so the services that build
 * them do not have to import a module that imports Electron.
 */
export interface DocumentBase {
  /** Also the file name, so it must be unique and safe as a path segment. */
  number: string
  issueDate: string
  notes: string
}

/**
 * Documents addressed to a client. The year-end summary is not one — it is
 * about the business, and giving it a `clientName` it could only fill with
 * null would put an empty "Billed to" block on every accountant's copy.
 */
export interface AddressedDocument extends DocumentBase {
  clientName: string | null
  clientAddress: string
}

/** An invoice, quote or receipt: a table of work, priced. */
export interface LineItemDocument extends AddressedDocument {
  kind: 'invoice' | 'quote' | 'receipt'
  /** Due date for an invoice, valid-until for a quote, paid date for a receipt. */
  secondaryDate: string | null
  lines: DocumentLine[]
  net: Pence
  vat: Pence
  vatRate: BasisPoints
  gross: Pence
}

/** One invoice as it appears on a statement of account. */
export interface StatementEntry {
  number: string
  issueDate: string
  dueDate: string
  gross: Pence
  paidAt: string | null
  /** Days past due as at the statement date; zero once paid. */
  daysLate: number
}

/** Outstanding money split by how long it has been outstanding. */
export interface AgeingBucket {
  label: string
  /** Inclusive lower bound in days past due; negative means not yet due. */
  from: number
  amount: Pence
}

/** A statement of account: a table of invoices, and what is left owing. */
export interface StatementForPdf extends AddressedDocument {
  kind: 'statement'
  /** Earliest issue date of the settled history shown, if it was narrowed. */
  periodFrom: string | null
  entries: StatementEntry[]
  invoiced: Pence
  paid: Pence
  outstanding: Pence
  ageing: AgeingBucket[]
}

/** A named total on the summary, for the two breakdown tables. */
export interface SummaryLine {
  label: string
  amount: Pence
}

/**
 * The year-end summary: the whole business over one tax year, on one page.
 *
 * Income is what was **received** in the year, not what was invoiced — the
 * cash basis, which is the default for a UK sole trader. The document says so
 * in as many words, because an accountant handed a figure with no basis stated
 * has to ask, and a figure they assume wrongly is worse than one they query.
 */
export interface YearSummaryForPdf extends DocumentBase {
  kind: 'summary'
  taxYearLabel: string
  periodFrom: string
  periodTo: string
  income: Pence
  expenses: Pence
  profit: Pence
  vatCollected: Pence
  vatRegistered: boolean
  setAside: Pence
  setAsidePercent: number
  invoicesPaid: number
  invoicesRaised: number
  hoursTracked: number
  byCategory: SummaryLine[]
  byClient: SummaryLine[]
}

export type DocumentForPdf = LineItemDocument | StatementForPdf | YearSummaryForPdf

export interface DocumentLine {
  id: number
  description: string
  quantity: number
  unitPrice: Pence
  amount: Pence
  kind: LineKind
  sortOrder: number
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled'
/** What the UI shows: the stored status, or `overdue` when derived. */
export type InvoiceDisplayStatus = InvoiceStatus | 'overdue'

export type Recurrence = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export const RECURRENCES: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' }
]

export interface Invoice {
  id: number
  number: string
  clientId: number | null
  projectId: number | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  paidAt: string | null
  net: Pence
  vatRate: BasisPoints
  vat: Pence
  gross: Pence
  notes: string
  pdfPath: string | null
  recurrence: Recurrence
  nextIssueOn: string | null
  parentInvoiceId: number | null
  /**
   * How far along the chase schedule this invoice has been taken, as an index
   * into the user's `chaseDays`. Zero means never chased.
   */
  chaseStep: number
  lastChasedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface InvoiceWithContext extends Invoice {
  clientName: string | null
  projectName: string | null
  lines: DocumentLine[]
  /** Stored status, or 'overdue' when sent and past its due date. */
  displayStatus: InvoiceDisplayStatus
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'

export interface Quote {
  id: number
  number: string
  clientId: number | null
  projectId: number | null
  status: QuoteStatus
  issueDate: string
  validUntil: string | null
  net: Pence
  vatRate: BasisPoints
  vat: Pence
  gross: Pence
  notes: string
  acceptedAt: string | null
  convertedProjectId: number | null
  convertedInvoiceId: number | null
  pdfPath: string | null
  createdAt: string
  updatedAt: string
}

export interface QuoteWithContext extends Quote {
  clientName: string | null
  lines: DocumentLine[]
}

export interface Expense {
  id: number
  date: string
  vendor: string
  description: string
  category: string
  net: Pence
  vat: Pence
  total: Pence
  receiptFile: string | null
  projectId: number | null
  rebillable: boolean
  invoiceLineId: number | null
  createdAt: string
  updatedAt: string
}

export interface ExpenseWithContext extends Expense {
  projectName: string | null
}

export const EXPENSE_CATEGORIES = [
  'Software',
  'Hardware',
  'Travel',
  'Subsistence',
  'Office',
  'Marketing',
  'Professional fees',
  'Subcontractors',
  'General'
]

/** Line item as edited in the builder, before it has an id. */
export interface LineDraft {
  id?: number
  description: string
  quantity: number
  unitPrice: Pence
  kind?: LineKind
  /** Time entries this line bills, so they can be marked as invoiced. */
  timeEntryIds?: number[]
  expenseIds?: number[]
}

export interface InvoiceInput {
  clientId: number | null
  projectId?: number | null
  issueDate?: string
  dueDate?: string
  notes?: string
  status?: InvoiceStatus
  recurrence?: Recurrence
  lines: LineDraft[]
}

export interface QuoteInput {
  clientId: number | null
  projectId?: number | null
  issueDate?: string
  validUntil?: string | null
  notes?: string
  status?: QuoteStatus
  lines: LineDraft[]
}

export type ExpenseInput = Partial<Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>> & {
  /** Absolute path of a receipt to copy into the workspace. */
  receiptSourcePath?: string | null
}

/* Finance reporting */

export interface FinanceSummary {
  range: { from: string; to: string; label: string }
  /** Invoices actually paid in the range. */
  income: Pence
  /** Sent, not yet paid, regardless of range. */
  outstanding: Pence
  overdue: Pence
  expenses: Pence
  profit: Pence
  /** Suggested amount to hold back from profit for tax. */
  setAside: Pence
  vatCollected: Pence
  hoursTracked: number
  unbilledValue: Pence
}

/**
 * The client update pack: where the work is, for one client.
 *
 * A self-contained document the user emails themselves. No hosting, no
 * accounts for their clients, nothing for anybody to log into — which is the
 * point rather than a compromise, because a portal would mean holding a
 * freelancer's clients' data on a server.
 */
export interface UpdatePackProject {
  name: string
  status: ProjectStatus
  colour: string
  dueOn: string | null
  /** Task titles finished inside the window. */
  completed: string[]
  /** What is next — not the whole backlog. */
  next: string[]
  hoursTotal: number
  hoursRecent: number
}

export interface UpdatePackInvoice {
  number: string
  issueDate: string
  dueDate: string
  gross: Pence
  overdue: boolean
}

export interface ClientUpdatePack {
  clientName: string
  contactName: string
  /** `yyyy-mm-dd`. */
  asOf: string
  /** Start of the window "recently" means, so the document can say it. */
  since: string
  projects: UpdatePackProject[]
  outstanding: UpdatePackInvoice[]
  outstandingTotal: Pence
  hoursRecent: number
}

/**
 * Where the user stands with HMRC this tax year.
 *
 * An estimate for deciding what to move into a savings account, not a return.
 * Income tax and Class 4 NI on trading profit only — the document says so, and
 * so does the card that shows it.
 */
export interface TaxPosition {
  /** The tax year being estimated, as HMRC writes it. */
  taxYearLabel: string
  /** Which year's rates were used, so a stale table is visible. */
  rulesLabel: string
  profit: Pence
  allowance: Pence
  incomeTax: Pence
  nationalInsurance: Pence
  total: Pence
  /** What the app thinks should be held back, rounded up. */
  recommendedPercent: number
  /** What the next pound of profit would cost, both taxes together. */
  marginalPercent: number
  /** What the user has actually set the rate to. */
  currentPercent: number
  held: Pence
  shortfall: Pence
  enough: boolean
}

/**
 * What a client actually pays per hour, once the hours are counted.
 *
 * The number freelancers almost never have, and the one that changes who they
 * work for.
 */
export interface ClientProfitability {
  clientId: number
  clientName: string
  colour: string
  invoiced: Pence
  hours: number
  /** Null when nothing has been tracked — not zero, which would be a claim. */
  effectiveRate: Pence | null
}

/** One bucket on a dashboard sparkline. */
export interface TrendPoint {
  /** Short axis label — a month name, or a date of the month for weeks. */
  label: string
  /** Pence for money, seconds for time. Formatted at the edge, as everywhere. */
  value: number
}

/**
 * Six periods of history behind each dashboard figure, oldest first.
 *
 * `paid` is monthly totals; `outstanding` and `overdue` are point-in-time at
 * the close of each month, because what you are owed is a position rather than
 * a flow; `tracked` is weekly seconds, matching the card above it.
 */
export interface DashboardTrends {
  paid: TrendPoint[]
  outstanding: TrendPoint[]
  overdue: TrendPoint[]
  tracked: TrendPoint[]
}

export interface FinancePoint {
  /** 'yyyy-mm-dd' for daily, 'yyyy-mm' for monthly. */
  bucket: string
  income: Pence
  expenses: Pence
}

export interface ClientTotal {
  clientId: number
  clientName: string
  colour: string
  invoiced: Pence
  paid: Pence
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

/**
 * What kind of hour a block is.
 *
 * This is the distinction the whole module turns on, and it is not the same
 * question as where the block came from — that is `BlockSource`. An hour can
 * be client work, a meeting, admin or a holiday regardless of whether it was
 * typed in or pulled from a feed.
 */
export type BlockType =
  | 'focus'
  | 'task'
  | 'meeting'
  | 'admin'
  | 'personal'
  | 'travel'
  | 'deadline'
  | 'holiday'
  | 'external'

/** Where a block came from. Only `local` is editable. */
export type BlockSource = 'local' | 'ics_subscription' | 'ics_import'

/**
 * How each type behaves, in one place.
 *
 * Colour, capacity and draggability all follow from the type, and having the
 * three answers in one table is what stops the week view, the month view and
 * the capacity figures disagreeing about whether a holiday is committed work.
 */
export interface BlockTypeMeta {
  value: BlockType
  label: string
  /** Used when the block has no colour of its own and no project to inherit. */
  colour: string
  /** Whether a new block of this type is billable unless told otherwise. */
  billable: boolean
  /**
   * Whether these hours count as committed.
   *
   * A holiday is not work, but it is not free either: it blocks availability
   * without adding to the day's load. Counting it would make a fortnight off
   * look like the most overcommitted two weeks of the year.
   */
  counts: boolean
  /** Deadlines are derived from other modules; external blocks are read-only. */
  draggable: boolean
}

export const BLOCK_TYPES: BlockTypeMeta[] = [
  { value: 'focus', label: 'Focus', colour: '#FF7A2F', billable: true, counts: true, draggable: true },
  { value: 'task', label: 'Task', colour: '#FF7A2F', billable: true, counts: true, draggable: true },
  { value: 'meeting', label: 'Meeting', colour: '#3B82F6', billable: false, counts: true, draggable: true },
  { value: 'admin', label: 'Admin', colour: '#8a8a93', billable: false, counts: true, draggable: true },
  { value: 'personal', label: 'Personal', colour: '#8B7BE5', billable: false, counts: false, draggable: true },
  { value: 'travel', label: 'Travel', colour: '#F5A623', billable: false, counts: true, draggable: true },
  { value: 'deadline', label: 'Deadline', colour: '#E5484D', billable: false, counts: false, draggable: false },
  { value: 'holiday', label: 'Holiday', colour: '#30A46C', billable: false, counts: false, draggable: true },
  { value: 'external', label: 'External', colour: '#8a8a93', billable: false, counts: true, draggable: false }
]

/**
 * Which occurrences of a series an edit applies to.
 *
 * Asked every time, never assumed. "Move the Tuesday stand-up to Wednesday"
 * and "move this week's stand-up to Wednesday" are different sentences, and an
 * app that guesses between them is one that rewrites a year of somebody's
 * calendar on a drag.
 */
export type EditScope = 'one' | 'future' | 'all'

/**
 * A date the calendar shows but does not own.
 *
 * A project deadline, a milestone, a task's due date, an invoice falling due.
 * None of these is a block: each already lives somewhere, and copying it into
 * the calendar would mean two places to change it and one of them silently
 * wrong. They are computed on the way out, drawn as marks rather than blocks,
 * and cannot be dragged — moving a deadline is a decision, and a decision
 * made by accident with a mouse is not one.
 */
export type MarkerKind = 'project' | 'milestone' | 'task' | 'invoice'

export interface DerivedMarker {
  kind: MarkerKind
  /** The id of the thing it derives from, for opening it. */
  id: number
  day: string
  label: string
  /** The second line: "Project deadline", "£1,200 due". */
  detail: string
  /** Empty falls back to the kind's own colour in the renderer. */
  colour: string
}

export interface ProjectMilestone {
  id: number
  projectId: number
  title: string
  dueOn: string
  notes: string
  reachedAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export function blockTypeMeta(type: BlockType): BlockTypeMeta {
  return BLOCK_TYPES.find((entry) => entry.value === type) ?? BLOCK_TYPES[2]!
}

export interface CalendarBlock {
  id: number
  title: string
  description: string
  location: string
  blockType: BlockType
  /** Local wall-clock stamp, `yyyy-mm-ddThh:mm` — see shared/calendar.ts. */
  startsAt: string
  endsAt: string
  allDay: boolean
  /** The IANA zone the wall time was written in. */
  timezone: string
  projectId: number | null
  clientId: number | null
  /** Set when this block schedules a task. */
  taskId: number | null
  /** Empty string means "use the project's colour, then the type's". */
  colour: string
  billable: boolean
  /** RFC 5545 RRULE, or null for a single occurrence. */
  recurrenceRule: string | null
  recurrenceParentId: number | null
  /** ISO dates this series skips. */
  recurrenceExdates: string[]
  source: BlockSource
  sourceUid: string | null
  sourceCalendarId: number | null
  /** True for anything pulled from a feed: no editing, moving or resizing. */
  locked: boolean
  meetingUrl: string
  /** Minutes before the start, or null for no reminder. */
  reminderMinutes: number | null
  remindedAt: string | null
  archived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CalendarBlockWithContext extends CalendarBlock {
  projectName: string | null
  projectColour: string | null
  clientName: string | null
  taskTitle: string | null
  /**
   * Time already recorded against this block's task, in whole minutes.
   *
   * Zero for a block scheduling nothing. Compared against the block's own
   * length, this says whether the plan is holding — the reconciliation the
   * whole module exists for, and the one number a calendar normally cannot
   * answer.
   */
  trackedMinutes: number
  /**
   * The series this was generated from, when it is not a row at all.
   *
   * A repeating block is stored once and expanded for whatever range is on
   * screen, so most occurrences of a weekly stand-up have no row of their own.
   * Null means this *is* a row: the first occurrence, a one-off, or an
   * instance somebody changed and so materialised. Anything that writes has to
   * look at this first, because there is nothing here to update.
   */
  occurrenceOf: number | null
  /** `colour`, then the project's, then the block type's. Resolved once. */
  displayColour: string
}

export type BlockInput = Partial<
  Omit<
    CalendarBlock,
    'id' | 'createdAt' | 'updatedAt' | 'remindedAt' | 'archived' | 'archivedAt'
  >
> & { title: string; startsAt: string; endsAt: string }

/** How the app stores a person's working shape. Minutes past midnight. */
export interface CalendarSettings {
  workingHoursStart: number
  workingHoursEnd: number
  /** Bitmask, Monday = bit 0. 31 is Monday to Friday. */
  workingDays: number
  dailyCapacityMinutes: number
  weeklyBillableTarget: number
  defaultBlockMinutes: number
  snapMinutes: number
  /** 0 = Monday. */
  weekStartsOn: number
  defaultView: string
  showWeekends: boolean
  hourHeight: number
}

export const REMINDER_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: 'At the time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' }
]

/* ------------------------------------------------------------------ *
 * Marketing
 * ------------------------------------------------------------------ */

export type AccountStatus = 'connected' | 'expired' | 'disconnected'

export interface SocialAccount {
  id: number
  platform: Platform
  handle: string
  displayName: string
  /** Workspace-relative path to the cached avatar, if we have one. */
  avatarFile: string | null
  externalId: string | null
  status: AccountStatus
  scopes: string[]
  /** Page id, Instagram user id, Pinterest boards — whatever the platform needs. */
  meta: Record<string, unknown>
  connectedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CampaignStatus = 'planned' | 'active' | 'finished' | 'archived'

export const CAMPAIGN_STATUSES: { value: CampaignStatus; label: string; colour: string }[] = [
  { value: 'planned', label: 'Planned', colour: '#8a8a93' },
  { value: 'active', label: 'Active', colour: '#3B82F6' },
  { value: 'finished', label: 'Finished', colour: '#30A46C' },
  { value: 'archived', label: 'Archived', colour: '#5a5a63' }
]

export interface Campaign {
  id: number
  name: string
  description: string
  goal: string
  colour: string
  startsOn: string | null
  endsOn: string | null
  status: CampaignStatus
  createdAt: string
  updatedAt: string
}

export interface CampaignWithCounts extends Campaign {
  postCount: number
  publishedCount: number
}

export interface ContentPillar {
  id: number
  name: string
  description: string
  colour: string
  /** Basis points — 4000 is 40% of output. */
  targetShare: BasisPoints
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * `idea` has no date yet. `needs_attention` means it came due while SoloWrk was
 * closed and is now too late to send without you looking at it first.
 */
export type PostStatus =
  | 'idea'
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'needs_attention'

export const POST_STATUSES: { value: PostStatus; label: string; colour: string }[] = [
  { value: 'idea', label: 'Idea', colour: '#8a8a93' },
  { value: 'draft', label: 'Draft', colour: '#5a5a63' },
  { value: 'scheduled', label: 'Scheduled', colour: '#3B82F6' },
  { value: 'published', label: 'Published', colour: '#30A46C' },
  { value: 'failed', label: 'Failed', colour: '#E5484D' },
  { value: 'needs_attention', label: 'Needs attention', colour: '#F5A623' }
]

export type TargetStatus = 'pending' | 'handed_over' | 'published' | 'failed' | 'skipped'

export interface PostTarget {
  id: number
  postId: number
  accountId: number | null
  platform: Platform
  /** Empty means "use the post body unchanged". */
  body: string
  title: string
  boardId: string | null
  status: TargetStatus
  externalId: string | null
  externalUrl: string | null
  error: string
  publishedAt: string | null
}

export interface PostMedia {
  id: number
  postId: number
  /** Relative to the workspace root. */
  file: string
  altText: string
  sortOrder: number
}

export interface Post {
  id: number
  campaignId: number | null
  pillarId: number | null
  projectId: number | null
  title: string
  body: string
  linkUrl: string
  notes: string
  status: PostStatus
  /** Local wall-clock stamp, `yyyy-mm-ddThh:mm`. Null while it is an idea. */
  scheduledAt: string | null
  publishedAt: string | null
  /** Days between automatic re-posts, or null for a one-off. */
  evergreenDays: number | null
  nextRepeatOn: string | null
  parentPostId: number | null
  createdAt: string
  updatedAt: string
}

export interface PostWithContext extends Post {
  campaignName: string | null
  campaignColour: string | null
  pillarName: string | null
  pillarColour: string | null
  targets: PostTarget[]
  media: PostMedia[]
}

export type PostInput = Partial<Omit<Post, 'id' | 'createdAt' | 'updatedAt'>> & {
  /** Which platforms this goes to. Replaces the target list wholesale. */
  targets?: { platform: Platform; accountId?: number | null; body?: string; title?: string; boardId?: string | null }[]
  /** Absolute paths to copy into the workspace, or existing relative ones. */
  media?: { file: string; altText?: string }[]
}

export interface PostFilter {
  from?: string
  to?: string
  status?: PostStatus
  campaignId?: number
  pillarId?: number
  /** Ideas only — the backlog, which has no date. */
  backlog?: boolean
  search?: string
}

/** How output is actually split across pillars, against what you intended. */
export interface PillarShare {
  pillarId: number | null
  name: string
  colour: string
  posts: number
  /** Basis points of total output. */
  actualShare: BasisPoints
  targetShare: BasisPoints
}

export interface MarketingSummary {
  range: { from: string; to: string }
  scheduled: number
  published: number
  needsAttention: number
  /** Days in the range with nothing planned — where the gaps are. */
  emptyDays: string[]
  mix: PillarShare[]
  byPlatform: { platform: Platform; scheduled: number; published: number }[]
}

/* ------------------------------------------------------------------ *
 * Assistant
 * ------------------------------------------------------------------ */

export interface Conversation {
  id: number
  title: string
  sessionId: string | null
  projectId: number | null
  createdAt: string
  updatedAt: string
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'error'

export interface ChatMessage {
  id: number
  conversationId: number
  role: ChatRole
  content: string
  toolName: string | null
  toolInput: string | null
  toolResult: string | null
  createdAt: string
}

/**
 * A lens for the assistant. Modes do not restrict what it can reach — they set
 * what it leads with, so "what should I do today" gets a different answer in
 * Finance than in Marketing.
 */
export type AssistantMode = 'general' | 'marketing' | 'projects' | 'finance'

export const ASSISTANT_MODES: {
  value: AssistantMode
  label: string
  hint: string
}[] = [
  { value: 'general', label: 'General', hint: 'Anything across the whole business' },
  { value: 'marketing', label: 'Marketing', hint: 'Content plans, campaigns, posts' },
  { value: 'projects', label: 'Project planning', hint: 'Scoping, tasks, deadlines' },
  { value: 'finance', label: 'Finance', hint: 'Cashflow, invoices, tax set-aside' }
]

/** Whether the assistant can run at all, and why not when it cannot. */
export interface AssistantStatus {
  ready: boolean
  /** Set when `ready` is false — shown verbatim in the setup panel. */
  reason?: string
  detail?: string
}

/**
 * A tool call waiting on the user. Mutating tools never run until the answer
 * comes back — the assistant proposes, the user decides.
 */
export interface PermissionRequest {
  id: string
  toolName: string
  /** A sentence describing what will happen, written by the tool itself. */
  title: string
  input: Record<string, unknown>
}

/** What the renderer sends back for a `PermissionRequest`. */
export interface PermissionAnswer {
  id: string
  allow: boolean
  /** Trust this tool for the rest of the conversation. */
  always?: boolean
}

/** Streaming updates pushed to the Assistant page as a turn runs. */
export type AssistantEvent =
  | { kind: 'delta'; conversationId: number; text: string }
  | { kind: 'message'; conversationId: number; message: ChatMessage }
  | { kind: 'permission'; conversationId: number; request: PermissionRequest }
  | { kind: 'done'; conversationId: number }
  | { kind: 'error'; conversationId: number; message: string }

/**
 * The colour a new client, project, goal or category starts life with.
 *
 * The accent, so a fresh workspace is one hue rather than one hue plus a
 * leftover violet. These are user data rather than design tokens — somebody
 * who picks purple for a client keeps it — which is why this is a literal and
 * not a var(): it is stored in the database and read back by charts, canvas
 * and PDF rendering, none of which can resolve a CSS variable.
 */
export const DEFAULT_ENTITY_COLOUR = '#FF7A2F'

/** Colour an event falls back to when it has no project and no colour set. */
export const DEFAULT_EVENT_COLOUR = DEFAULT_ENTITY_COLOUR

/**
 * Palette offered in colour pickers.
 *
 * Retuned alongside the theme: the semantic five now match the tokens they are
 * named after, so a project coloured "green" and a paid invoice are the same
 * green. Violet stays on the list — it is a perfectly good colour to label a
 * client with, and removing it would silently recolour anything already using
 * it.
 */
export const COLOUR_CHOICES = [
  DEFAULT_ENTITY_COLOUR,
  '#4B8FE5',
  '#3FB950',
  '#D9A03C',
  '#E5534B',
  '#EC4899',
  '#06B6D4',
  '#6E56CF',
  '#A8A8B3'
]

export const DEFAULT_BUSINESS: WorkspaceSetup['business'] = {
  businessName: '',
  contactName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  postcode: '',
  vatRegistered: false,
  vatNumber: '',
  defaultHourlyRate: 5000,
  paymentTermsDays: 14
}
/**
 * The things that can be linked to each other, and that keep an activity
 * timeline.
 *
 * One union for both, deliberately. A type that can be linked but has no
 * history, or has history but cannot be linked, is an asymmetry every caller
 * would have to remember.
 *
 * `block` is a calendar block. It joined when the calendar got a detail
 * drawer, and joining is what gives every drag its undo: a moved block is an
 * `entity:update` like any other, and a deleted one goes to the trash rather
 * than nowhere.
 */
export const ENTITY_TYPES = [
  'client',
  'project',
  'task',
  'invoice',
  'quote',
  'note',
  'document',
  'expense',
  'block'
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

/**
 * The types that can be filed away rather than deleted.
 *
 * Invoices and quotes are deliberately absent: an invoice's status already
 * says where it is in its life, and a second axis for "put this away" would
 * mean two answers to the question of where an invoice went. A paid invoice is
 * filed by being paid.
 *
 * Shared because the main process enforces it and the drawer decides whether
 * to draw the button from it, and two copies would drift the first time the
 * list changed — leaving a button that throws, or a type that can be archived
 * with no way to do it.
 */
export const ARCHIVABLE_TYPES = [
  'client',
  'project',
  'task',
  'note',
  'document'
] as const satisfies readonly EntityType[]

export function canArchive(type: EntityType): boolean {
  return (ARCHIVABLE_TYPES as readonly EntityType[]).includes(type)
}

/** A row, addressed the way the links and activity tables address it. */
export interface EntityRef {
  type: EntityType
  id: number
}

/** A ref with enough on it to render a row without a second query. */
export interface LinkedEntity extends EntityRef {
  label: string
  /**
   * How this row is connected. 'related' for a hand-made link; otherwise the
   * foreign key it came from, so the UI can say "invoiced under" rather than
   * listing everything as generically related.
   */
  relationship: string
  /** True when the connection is a foreign key rather than a link row. */
  structural: boolean
}

export interface BacklinkGroup {
  type: EntityType
  /** Every connection of this type, capped for display. */
  items: LinkedEntity[]
  /** The real total, which can exceed `items.length`. */
  count: number
}

export type ActivityAction = 'created' | 'edited' | 'status'

export interface ActivityEntry {
  id: number
  entityType: EntityType
  entityId: number
  action: ActivityAction
  /** The name at creation, or 'sent to paid' for a status change. */
  detail: string
  at: string
}

/**
 * A named set of filters for one list.
 *
 * `query` is the page's own URL query string without its leading '?'. Every
 * list keeps its filter state in the address bar, so a saved view is that
 * string and applying one is setting it — see migration 19 for why this is
 * stored opaquely rather than as a column per filter.
 */
export interface SavedView {
  id: number
  page: string
  name: string
  query: string
  sortOrder: number
}

/**
 * Something deleted, kept for a while.
 *
 * The row itself is gone from its own table — see the note on the `trash`
 * table in migration 20 for why that rather than a `deleted_at` column
 * everywhere. `label` and `summary` are held as written because there is
 * nothing left to look them up from.
 */
export interface TrashEntry {
  id: number
  entityType: EntityType
  entityId: number
  label: string
  /** What else went with it: '3 tasks, 2 notes'. Empty when nothing did. */
  summary: string
  deletedAt: string
}

/**
 * A tag, from the one vocabulary shared by every kind of record.
 *
 * Free text per table could not be renamed, coloured or counted across types —
 * see migration 22 for what this replaced.
 */
export interface Tag {
  id: number
  name: string
  colour: string
}

export interface TagWithCount extends Tag {
  /** How many records carry it, across every type. */
  uses: number
}

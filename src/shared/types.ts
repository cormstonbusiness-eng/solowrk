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
  sortOrder: number
  completedAt: string | null
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
  projectId: number
  title: string
  file: string
  createdAt: string
  updatedAt: string
}

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

/** Where an event came from. Everything is `local` until phase 8 adds sync. */
export type EventKind = 'local' | 'google' | 'teams'

export interface CalendarEvent {
  id: number
  title: string
  description: string
  location: string
  /** Local wall-clock stamp, `yyyy-mm-ddThh:mm` — see shared/calendar.ts. */
  startsAt: string
  endsAt: string
  allDay: boolean
  kind: EventKind
  externalId: string | null
  meetingUrl: string
  projectId: number | null
  clientId: number | null
  /** Empty string means "use the project's colour". */
  colour: string
  /** Minutes before the start, or null for no reminder. */
  reminderMinutes: number | null
  remindedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CalendarEventWithContext extends CalendarEvent {
  projectName: string | null
  projectColour: string | null
  clientName: string | null
  /** `colour` if set, otherwise the project's, otherwise the neutral default. */
  displayColour: string
}

export type EventInput = Partial<
  Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'remindedAt'>
> & { title: string; startsAt: string; endsAt: string }

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

/** Colour an event falls back to when it has no project and no colour set. */
export const DEFAULT_EVENT_COLOUR = '#6E56CF'

/** Palette offered in colour pickers, matching the app's semantic colours. */
export const COLOUR_CHOICES = [
  '#6E56CF',
  '#3B82F6',
  '#30A46C',
  '#F5A623',
  '#E5484D',
  '#EC4899',
  '#06B6D4',
  '#8a8a93'
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
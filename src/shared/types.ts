/**
 * Types shared across the process boundary.
 *
 * Money is always stored and passed as **integer pence** — never a float. A
 * `Rate` of 5500 is £55.00. Formatting to pounds happens only at the edge, in
 * the renderer. Percentages are stored as **basis points** (2000 = 20.00%) so
 * VAT arithmetic stays in integers too.
 */

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
  /** True when this folder already holds a Solo workspace we can adopt. */
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
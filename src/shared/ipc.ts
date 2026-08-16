/**
 * The single source of truth for every main <-> renderer channel.
 *
 * Adding a feature means adding an entry to `IpcContract` here, a handler in
 * `src/main/ipc/`, and nothing else — the preload bridge and the renderer's
 * `window.solo` typings are both derived from this type. If it isn't declared
 * here, it isn't reachable from the renderer.
 */

import type {
  AssistantEvent,
  AssistantStatus,
  AssistantMode,
  BusinessSettings,
  CalendarEventWithContext,
  Campaign,
  CampaignWithCounts,
  Category,
  ChatMessage,
  ContentPillar,
  Conversation,
  GoalInput,
  GoalProgress,
  MarketingSummary,
  Note,
  NoteWithContext,
  PermissionAnswer,
  Platform,
  PostFilter,
  PostInput,
  PostWithContext,
  SocialAccount,
  Client,
  ClientInput,
  ClientTotal,
  EventInput,
  DocumentInput,
  DocumentRecord,
  ExpenseInput,
  ExpenseWithContext,
  FileEntry,
  FinancePoint,
  FinanceSummary,
  FolderInspection,
  InvoiceInput,
  InvoiceStatus,
  InvoiceWithContext,
  QuoteInput,
  QuoteStatus,
  QuoteWithContext,
  RunningTimer,
  TimeEntry,
  TimeEntryWithContext,
  Project,
  ProjectInput,
  ProjectSummary,
  Settings,
  TaskFilter,
  TaskInput,
  TaskStatus,
  TaskWithContext,
  Template,
  WorkspaceSetup,
  WorkspaceStatus
} from './types'
import type { Period } from './taxYear'

export interface WindowState {
  isMaximized: boolean
  isFocused: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
}

/** Request/response shape of every invokable channel. */
export interface IpcContract {
  'app:info': { req: void; res: AppInfo }
  'window:minimize': { req: void; res: void }
  'window:toggleMaximize': { req: void; res: boolean }
  'window:close': { req: void; res: void }
  'window:state': { req: void; res: WindowState }

  'workspace:status': { req: void; res: WorkspaceStatus }
  /** Opens a native folder picker. Resolves to null if the user cancels. */
  'workspace:browse': { req: { startIn?: string }; res: string | null }
  'workspace:inspect': { req: { path: string }; res: FolderInspection }
  'workspace:create': { req: WorkspaceSetup; res: WorkspaceStatus }
  'workspace:adopt': { req: { path: string }; res: WorkspaceStatus }
  /** Reveal the workspace folder in Explorer. */
  'workspace:reveal': { req: void; res: void }

  'settings:get': { req: void; res: Settings }
  'settings:update': { req: Partial<BusinessSettings>; res: Settings }
  /** Copies an image into the workspace and records it as the business logo. */
  'settings:setLogo': { req: { sourcePath: string }; res: Settings }
  'settings:clearLogo': { req: void; res: Settings }
  /** The logo as a data URL — the renderer cannot read the workspace itself. */
  'settings:logo': { req: void; res: string | null }
  /** App version, for the footer in Settings. */
  'app:version': { req: void; res: string }

  'goals:list': { req: { includeArchived?: boolean } | void; res: GoalProgress[] }
  'goals:create': { req: GoalInput; res: GoalProgress }
  'goals:update': { req: { id: number; patch: Partial<GoalInput> }; res: GoalProgress }
  'goals:delete': { req: { id: number }; res: void }

  /** The standalone notebook — notes not attached to a project. */
  'notes:standalone': { req: { search?: string } | void; res: NoteWithContext[] }
  'notes:createStandalone': { req: { title: string }; res: Note }
  'notes:rename': { req: { id: number; title: string }; res: void }
  'notes:pin': { req: { id: number; pinned: boolean }; res: void }

  /** The markdown business plan folded into every assistant conversation. */
  'ai:businessPlan': { req: void; res: { content: string; exists: boolean } }
  'ai:saveBusinessPlan': { req: { content: string }; res: void }

  /** Small workspace-scoped UI flags — see app_state in the database. */
  'state:get': { req: { key: string }; res: string | null }
  'state:set': { req: { key: string; value: string }; res: void }

  'clients:list': { req: { includeArchived?: boolean } | void; res: Client[] }
  'clients:get': { req: { id: number }; res: Client }
  'clients:create': { req: ClientInput; res: Client }
  'clients:update': { req: { id: number; patch: Partial<ClientInput> }; res: Client }
  'clients:delete': { req: { id: number }; res: void }

  'projects:list': {
    req: { clientId?: number; includeArchived?: boolean } | void
    res: ProjectSummary[]
  }
  'projects:get': { req: { id: number }; res: Project }
  'projects:create': { req: ProjectInput; res: Project }
  'projects:update': { req: { id: number; patch: Partial<ProjectInput> }; res: Project }
  'projects:delete': { req: { id: number }; res: void }
  /** Open the project's folder in Explorer. */
  'projects:reveal': { req: { id: number }; res: void }

  'tasks:list': { req: TaskFilter | void; res: TaskWithContext[] }
  'tasks:create': { req: TaskInput; res: TaskWithContext }
  'tasks:update': { req: { id: number; patch: Partial<TaskInput> }; res: TaskWithContext }
  'tasks:move': {
    req: { id: number; status: TaskStatus; projectId: number | null; beforeId: number | null }
    res: TaskWithContext
  }
  'tasks:delete': { req: { id: number }; res: void }

  'categories:list': { req: void; res: Category[] }
  'categories:create': { req: { name: string; colour: string }; res: Category }
  'categories:update': {
    req: { id: number; patch: { name?: string; colour?: string } }
    res: Category
  }
  'categories:delete': { req: { id: number }; res: void }

  'notes:list': { req: { projectId: number }; res: Note[] }
  'notes:create': { req: { projectId: number; title: string }; res: Note }
  'notes:read': { req: { id: number }; res: string }
  'notes:write': { req: { id: number; content: string }; res: void }
  'notes:delete': { req: { id: number }; res: void }

  'templates:list': { req: void; res: Template[] }
  'templates:fromProject': {
    req: { projectId: number; name: string; description?: string }
    res: Template
  }
  'templates:delete': { req: { id: number }; res: void }

  /** All paths are relative to the workspace root and validated in main. */
  'files:list': { req: { path: string }; res: FileEntry[] }
  'files:createFolder': { req: { parent: string; name: string }; res: string }
  'files:rename': { req: { path: string; name: string }; res: string }
  /** Sends to the Recycle Bin, not an unlink. */
  'files:trash': { req: { path: string }; res: void }
  'files:open': { req: { path: string }; res: void }
  'files:reveal': { req: { path: string }; res: void }
  /** `sources` are absolute paths from a picker or an Explorer drag. */
  'files:import': { req: { destination: string; sources: string[] }; res: string[] }
  /** Native picker; returns absolute paths, or an empty array if cancelled. */
  'files:pick': { req: { multiple?: boolean } | void; res: string[] }
  /** Most recently modified files across the workspace — for the dashboard. */
  'files:recent': { req: { limit?: number } | void; res: FileEntry[] }

  'documents:list': { req: { search?: string; category?: string } | void; res: DocumentRecord[] }
  'documents:add': {
    req: DocumentInput & { sourcePath: string }
    res: DocumentRecord
  }
  'documents:update': { req: { id: number; patch: Partial<DocumentInput> }; res: DocumentRecord }
  'documents:delete': { req: { id: number }; res: void }
  'documents:expiring': { req: { days?: number } | void; res: DocumentRecord[] }

  /** Hands a pre-filled draft to the OS mail client. Never sends anything. */
  'shell:mailto': { req: { to: string; subject: string; body: string }; res: void }

  'time:running': { req: void; res: RunningTimer | null }
  'time:start': {
    req: { projectId: number | null; taskId?: number | null; notes?: string }
    res: RunningTimer
  }
  'time:stop': { req: { id: number }; res: TimeEntryWithContext }
  'time:list': {
    req: { from?: string; to?: string; projectId?: number; unbilledOnly?: boolean } | void
    res: TimeEntryWithContext[]
  }
  'time:create': {
    req: {
      projectId: number | null
      taskId?: number | null
      startedAt: string
      duration: number
      notes?: string
      billable?: boolean
    }
    res: TimeEntryWithContext
  }
  'time:update': { req: { id: number; patch: Partial<TimeEntry> }; res: TimeEntryWithContext }
  'time:delete': { req: { id: number }; res: void }
  /** Billable, un-invoiced time for a project, with what it is worth. */
  'time:unbilled': {
    req: { projectId: number }
    res: { entries: TimeEntryWithContext[]; seconds: number; value: number }
  }

  'invoices:list': {
    req: { clientId?: number; status?: InvoiceStatus; from?: string; to?: string } | void
    res: InvoiceWithContext[]
  }
  'invoices:get': { req: { id: number }; res: InvoiceWithContext }
  'invoices:create': { req: InvoiceInput; res: InvoiceWithContext }
  'invoices:update': {
    req: { id: number; patch: Partial<InvoiceInput> & { status?: InvoiceStatus } }
    res: InvoiceWithContext
  }
  'invoices:delete': { req: { id: number }; res: void }
  /** Renders the PDF into the workspace and returns its relative path. */
  'invoices:pdf': { req: { id: number }; res: string }
  'invoices:overdue': { req: void; res: InvoiceWithContext[] }
  /** Pre-drafted chase email for an overdue invoice. */
  'invoices:chaser': { req: { id: number }; res: { subject: string; body: string; to: string } }

  'quotes:list': { req: { status?: QuoteStatus } | void; res: QuoteWithContext[] }
  'quotes:get': { req: { id: number }; res: QuoteWithContext }
  'quotes:create': { req: QuoteInput; res: QuoteWithContext }
  'quotes:update': { req: { id: number; patch: Partial<QuoteInput> }; res: QuoteWithContext }
  'quotes:delete': { req: { id: number }; res: void }
  'quotes:pdf': { req: { id: number }; res: string }
  'quotes:convert': {
    req: {
      id: number
      createProject: boolean
      projectName?: string
      depositPercent?: number
    }
    res: { projectId: number | null; invoiceId: number | null }
  }

  'expenses:list': {
    req: { from?: string; to?: string; projectId?: number; unbilledOnly?: boolean } | void
    res: ExpenseWithContext[]
  }
  'expenses:create': { req: ExpenseInput; res: ExpenseWithContext }
  'expenses:update': { req: { id: number; patch: ExpenseInput }; res: ExpenseWithContext }
  'expenses:delete': { req: { id: number }; res: void }

  'finance:summary': { req: { period: Period; reference?: string }; res: FinanceSummary }
  'finance:series': {
    req: { period: Period; reference?: string }
    res: FinancePoint[]
  }
  'finance:topClients': { req: { period: Period; reference?: string }; res: ClientTotal[] }
  'finance:profitability': {
    req: void
    res: {
      projectId: number
      projectName: string
      colour: string
      budget: number | null
      invoiced: number
      trackedValue: number
      hours: number
    }[]
  }

  /** `from` and `to` are `yyyy-mm-dd`; anything overlapping them comes back. */
  'events:list': {
    req: { from: string; to: string; projectId?: number }
    res: CalendarEventWithContext[]
  }
  'events:create': { req: EventInput; res: CalendarEventWithContext }
  'events:update': { req: { id: number; patch: Partial<EventInput> }; res: CalendarEventWithContext }
  'events:delete': { req: { id: number }; res: void }
  'events:upcoming': { req: { limit?: number } | void; res: CalendarEventWithContext[] }

  'marketing:campaigns': { req: { includeArchived?: boolean } | void; res: CampaignWithCounts[] }
  'marketing:createCampaign': { req: Partial<Campaign> & { name: string }; res: Campaign }
  'marketing:updateCampaign': { req: { id: number; patch: Partial<Campaign> }; res: Campaign }
  'marketing:deleteCampaign': { req: { id: number }; res: void }

  'marketing:pillars': { req: void; res: ContentPillar[] }
  'marketing:createPillar': {
    req: { name: string; colour?: string; description?: string; targetShare?: number }
    res: ContentPillar
  }
  'marketing:updatePillar': {
    req: { id: number; patch: Partial<ContentPillar> }
    res: ContentPillar
  }
  'marketing:deletePillar': { req: { id: number }; res: void }

  'marketing:posts': { req: PostFilter | void; res: PostWithContext[] }
  'marketing:post': { req: { id: number }; res: PostWithContext }
  'marketing:createPost': { req: PostInput; res: PostWithContext }
  'marketing:updatePost': { req: { id: number; patch: PostInput }; res: PostWithContext }
  'marketing:deletePost': { req: { id: number }; res: void }
  /** Copies the caption for a platform to the clipboard and reveals its media. */
  'marketing:handoff': { req: { postId: number; platform: Platform }; res: void }
  'marketing:summary': { req: { from: string; to: string }; res: MarketingSummary }

  'social:accounts': { req: void; res: SocialAccount[] }

  'ai:status': { req: void; res: AssistantStatus }
  'ai:conversations': { req: void; res: Conversation[] }
  'ai:messages': { req: { conversationId: number }; res: ChatMessage[] }
  'ai:newConversation': { req: { projectId?: number | null } | void; res: Conversation }
  'ai:deleteConversation': { req: { id: number }; res: void }
  /** Resolves when the turn finishes; progress arrives on the `ai:event` channel. */
  'ai:send': { req: { conversationId: number; text: string; mode?: AssistantMode }; res: void }
  'ai:interrupt': { req: void; res: void }
  /** The user's answer to a confirmation card. */
  'ai:permission': { req: PermissionAnswer; res: void }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['req']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res']

/**
 * Channels the main process pushes to the renderer without being asked.
 */
export interface IpcEvents {
  'window:stateChanged': WindowState
  /** Sent when a reminder notification is clicked, to open that event. */
  'calendar:focusEvent': { id: number }
  /** Streaming progress from the assistant — text, tool calls, confirmations. */
  'ai:event': AssistantEvent
  /** Sent when a due-post notification is clicked, to open that post. */
  'marketing:focusPost': { id: number }
}

export type IpcEvent = keyof IpcEvents

/** Runtime allowlist — the preload bridge refuses anything not in this array. */
export const IPC_CHANNELS = [
  'app:info',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:state',
  'workspace:status',
  'workspace:browse',
  'workspace:inspect',
  'workspace:create',
  'workspace:adopt',
  'workspace:reveal',
  'settings:get',
  'settings:update',
  'settings:setLogo',
  'settings:clearLogo',
  'settings:logo',
  'app:version',
  'goals:list',
  'goals:create',
  'goals:update',
  'goals:delete',
  'notes:standalone',
  'notes:createStandalone',
  'notes:rename',
  'notes:pin',
  'ai:businessPlan',
  'ai:saveBusinessPlan',
  'state:get',
  'state:set',
  'clients:list',
  'clients:get',
  'clients:create',
  'clients:update',
  'clients:delete',
  'projects:list',
  'projects:get',
  'projects:create',
  'projects:update',
  'projects:delete',
  'projects:reveal',
  'tasks:list',
  'tasks:create',
  'tasks:update',
  'tasks:move',
  'tasks:delete',
  'categories:list',
  'categories:create',
  'categories:update',
  'categories:delete',
  'notes:list',
  'notes:create',
  'notes:read',
  'notes:write',
  'notes:delete',
  'templates:list',
  'templates:fromProject',
  'templates:delete',
  'files:list',
  'files:createFolder',
  'files:rename',
  'files:trash',
  'files:open',
  'files:reveal',
  'files:import',
  'files:pick',
  'files:recent',
  'documents:list',
  'documents:add',
  'documents:update',
  'documents:delete',
  'documents:expiring',
  'shell:mailto',
  'time:running',
  'time:start',
  'time:stop',
  'time:list',
  'time:create',
  'time:update',
  'time:delete',
  'time:unbilled',
  'invoices:list',
  'invoices:get',
  'invoices:create',
  'invoices:update',
  'invoices:delete',
  'invoices:pdf',
  'invoices:overdue',
  'invoices:chaser',
  'quotes:list',
  'quotes:get',
  'quotes:create',
  'quotes:update',
  'quotes:delete',
  'quotes:pdf',
  'quotes:convert',
  'expenses:list',
  'expenses:create',
  'expenses:update',
  'expenses:delete',
  'finance:summary',
  'finance:series',
  'finance:topClients',
  'finance:profitability',
  'events:list',
  'events:create',
  'events:update',
  'events:delete',
  'events:upcoming',
  'marketing:campaigns',
  'marketing:createCampaign',
  'marketing:updateCampaign',
  'marketing:deleteCampaign',
  'marketing:pillars',
  'marketing:createPillar',
  'marketing:updatePillar',
  'marketing:deletePillar',
  'marketing:posts',
  'marketing:post',
  'marketing:createPost',
  'marketing:updatePost',
  'marketing:deletePost',
  'marketing:handoff',
  'marketing:summary',
  'social:accounts',
  'ai:status',
  'ai:conversations',
  'ai:messages',
  'ai:newConversation',
  'ai:deleteConversation',
  'ai:send',
  'ai:interrupt',
  'ai:permission'
] as const satisfies readonly IpcChannel[]

export const IPC_EVENTS = [
  'window:stateChanged',
  'calendar:focusEvent',
  'ai:event',
  'marketing:focusPost'
] as const satisfies readonly IpcEvent[]
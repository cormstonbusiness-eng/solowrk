/**
 * The single source of truth for every main <-> renderer channel.
 *
 * Adding a feature means adding an entry to `IpcContract` here, a handler in
 * `src/main/ipc/`, and nothing else — the preload bridge and the renderer's
 * `window.solo` typings are both derived from this type. If it isn't declared
 * here, it isn't reachable from the renderer.
 */

import type { PrefillKey } from './planInterview'
import type {
  AutomationRule,
  AutomationRuleInput,
  AutomationSubject,
  AutomationTrigger
} from './automations'
import type {
  ActivityEntry,
  BacklinkGroup,
  EntityRef,
  EntityType,
  LinkedEntity,
  SavedView,
  Tag,
  TagWithCount,
  TrashEntry,
  AppNotification,
  AssistantEvent,
  AssistantStatus,
  AuthState,
  AssistantMode,
  BusinessPlanStatus,
  BusinessSettings,
  CalendarBlockWithContext,
  CalendarSettings,
  CalendarSubscription,
  AgedDebtors,
  CapacityDefaults,
  CampaignInput,
  CampaignWithCounts,
  CampaignWork,
  ContentItemInput,
  ContentItemWithContext,
  MarketingChannel,
  MarketingChannelInput,
  MarketingPlan,
  MarketingPlanInput,
  ProjectStructure,
  ProjectUsage,
  RenamePreview,
  Review,
  BankImportResult,
  DocumentTemplate,
  DocumentTemplateInput,
  DocumentVersion,
  GeneratedDocument,
  BankTransaction,
  BankTransactionWithMatches,
  MileageInput,
  MileageRateRow,
  MileageYear,
  ProjectMilestone,
  ReceiptReading,
  DerivedMarker,
  EditScope,
  PostCampaign,
  PostCampaignWithCounts,
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
  QueuedMail,
  SocialAccount,
  Client,
  ClientInput,
  ClientProfitability,
  ClientTotal,
  BlockInput,
  DocumentInput,
  DashboardTrends,
  DocumentRecord,
  Dataset,
  DueChase,
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
  UpdateState,
  TaskFilter,
  TaskInput,
  TaskStatus,
  TaskWithContext,
  TaxPosition,
  Template,
  WorkspaceSetup,
  WorkspaceStatus,
  YearEndPack
} from './types'
import type { Period } from './taxYear'
import type { Limit } from './entitlements'

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

  /** The signed-in account. Nothing about the workspace is ever sent. */
  'auth:state': { req: void; res: AuthState }
  'auth:signIn': { req: { email: string; password: string }; res: AuthState }
  'auth:signUp': { req: { name: string; email: string; password: string }; res: AuthState }
  'auth:signOut': { req: void; res: AuthState }
  /** Re-confirms the licence. Being offline is not a failure. */
  'auth:verify': { req: void; res: AuthState }
  /** Points the app at an account server. Empty turns licensing off. */
  'auth:setServer': { req: { url: string }; res: AuthState }

  /**
   * What has been used against each limit, for the meters on Settings →
   * Account (§4.4) and the downgrade notice (§4.3).
   *
   * `cap` is null where there is none. `Infinity` does not survive JSON —
   * `JSON.stringify` turns it into null anyway — so being explicit about it
   * beats discovering the coercion in the renderer.
   */
  'entitlements:meters': {
    req: void
    res: { limit: Limit; used: number; cap: number | null }[]
  }
  /** Limits already over their cap, which are shown but never enforced. */
  'entitlements:exceeded': {
    req: void
    res: { limit: Limit; used: number; cap: number }[]
  }

  /** Current update state. Live changes arrive on the `updates:state` event. */
  'updates:get': { req: void; res: UpdateState }
  /** Check now, rather than waiting for the next scheduled check. */
  'updates:check': { req: void; res: UpdateState }
  /** Restart into a downloaded update. Does nothing unless one is ready. */
  'updates:install': { req: void; res: void }

  'notifications:list': { req: { archived?: boolean } | void; res: AppNotification[] }
  'notifications:unread': { req: void; res: number }
  'notifications:read': { req: { id: number }; res: void }
  'notifications:readAll': { req: void; res: void }
  'notifications:archive': { req: { id: number }; res: void }
  'notifications:archiveRead': { req: void; res: void }
  'notifications:restore': { req: { id: number }; res: void }
  'notifications:delete': { req: { id: number }; res: void }

  'goals:list': { req: { includeArchived?: boolean } | void; res: GoalProgress[] }
  'goals:create': { req: GoalInput; res: GoalProgress }
  'goals:update': { req: { id: number; patch: Partial<GoalInput> }; res: GoalProgress }
  'goals:delete': { req: { id: number }; res: void }

  /** The standalone notebook — notes not attached to a project. */
  'notes:standalone': { req: { search?: string } | void; res: NoteWithContext[] }
  'notes:createStandalone': { req: { title: string }; res: Note }
  'notes:rename': { req: { id: number; title: string }; res: void }
  'notes:pin': { req: { id: number; pinned: boolean }; res: void }

  /** The attached business plan folded into every assistant conversation. */
  'ai:businessPlan': { req: void; res: BusinessPlanStatus }
  /** Copies a document into the workspace and extracts its text. */
  'ai:attachBusinessPlan': { req: { sourcePath: string }; res: BusinessPlanStatus }
  'ai:detachBusinessPlan': { req: void; res: BusinessPlanStatus }
  /** Opens the attached document in whatever the OS uses for it. */
  'ai:openBusinessPlan': { req: void; res: void }
  /** Saves edited text back. Only markdown and text plans can be written to. */
  'ai:writeBusinessPlan': { req: { text: string }; res: BusinessPlanStatus }
  /**
   * Starts an editable markdown plan and attaches it — from the blank template,
   * or carrying across the text of a PDF or Word plan already attached.
   */
  /**
   * The guided plan.
   *
   * `ai:planPrefill` is the handful of answers the app can take from the
   * workspace; `ai:buildBusinessPlan` turns a full set of answers into the
   * same kind of markdown document attaching a file produces, so there is no
   * second class of plan.
   */
  'ai:planPrefill': { req: void; res: Partial<Record<PrefillKey, string>> }
  'ai:buildBusinessPlan': { req: { answers: Record<string, string> }; res: BusinessPlanStatus }

  'ai:startBusinessPlan': { req: void; res: BusinessPlanStatus }

  /** Small workspace-scoped UI flags — see app_state in the database. */
  'state:get': { req: { key: string }; res: string | null }
  'state:set': { req: { key: string; value: string }; res: void }

  'clients:list': { req: { includeArchived?: boolean } | void; res: Client[] }
  'clients:get': { req: { id: number }; res: Client }
  'clients:create': { req: ClientInput; res: Client }
  'clients:update': { req: { id: number; patch: Partial<ClientInput> }; res: Client }
  'clients:delete': { req: { id: number }; res: void }
  /**
   * The client update pack: where the work is, as a file the user emails.
   *
   * HTML by default because that is what opens in an email; PDF for anybody
   * who would rather attach one. Both come from the same markup. Returns the
   * workspace-relative path.
   */
  'clients:updatePack': {
    req: { clientId: number; format?: 'html' | 'pdf'; since?: string }
    res: string
  }

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

  /**
   * Templates with merge fields, and the documents they produce.
   *
   * Under `docTemplates:` rather than `templates:`, which is already taken by
   * the folder-structure templates in Files. Two different things wanting the
   * same word is worth one clumsy prefix.
   */
  'docTemplates:list': { req: void; res: DocumentTemplate[] }
  'docTemplates:get': { req: { id: number }; res: DocumentTemplate }
  'docTemplates:create': { req: DocumentTemplateInput; res: DocumentTemplate }
  'docTemplates:update': {
    req: { id: number; patch: DocumentTemplateInput }
    res: DocumentTemplate
  }
  'docTemplates:delete': { req: { id: number }; res: void }
  /** Put a shipped template back the way it came. */
  'docTemplates:restore': { req: { id: number }; res: DocumentTemplate }
  /**
   * What a template would fill in for this project, without generating
   * anything — so the picker can say what it knows before somebody commits.
   */
  'docTemplates:preview': {
    req: { id: number; clientId?: number | null; projectId?: number | null }
    res: { text: string; unresolved: string[]; filled: string[] }
  }

  /** Make a real document from a template, reporting what it could not fill. */
  'documents:generate': {
    req: { templateId: number; title?: string; clientId?: number | null; projectId?: number | null }
    res: GeneratedDocument
  }
  'documents:get': { req: { id: number }; res: DocumentRecord }
  'documents:save': { req: { id: number; body: string; note?: string }; res: DocumentRecord }
  'documents:versions': { req: { id: number }; res: DocumentVersion[] }
  'documents:restoreVersion': {
    req: { id: number; versionId: number }
    res: DocumentRecord
  }
  /** Draft / Sent / Signed / Declined, tracked by hand. No e-signature. */
  'documents:setStatus': {
    req: { id: number; status: DocumentRecord['status']; note?: string }
    res: DocumentRecord
  }

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
  /**
   * A receipt for an invoice that has been paid. Basic — it is the other half
   * of an invoice, not a feature, and a client who asks for one is not asking
   * their supplier to upgrade.
   */
  'invoices:receipt': { req: { id: number }; res: string }
  'invoices:overdue': { req: void; res: InvoiceWithContext[] }
  /**
   * Pre-drafted chase email for an overdue invoice.
   *
   * `attempt` picks the register: a nudge, a firmer note, or a last word. The
   * sweep passes the milestone the invoice has actually reached; a user
   * pressing the button by hand gets the next one due.
   */
  'invoices:chaser': {
    req: { id: number; attempt?: number }
    res: { subject: string; body: string; to: string }
  }
  /**
   * The automatic schedule, which is Pro. Under its own prefix rather than
   * `invoices:` so the feature gate is one rule that catches whatever is added
   * to it later — `invoices:chaser`, the button pressed by hand, stays Basic
   * and stays where it is.
   *
   * The names carry their read-only classification: `due` reads, `record` and
   * `stop` match write verbs and are refused on a lapsed licence.
   */
  /** Overdue invoices that have crossed a milestone and have a note waiting. */
  'chasing:due': { req: void; res: DueChase[] }
  /**
   * Records that a chaser was acted on, so the next milestone is the next one
   * raised. Deliberately not called when the draft is written — a note nobody
   * read has not chased anybody.
   */
  'chasing:record': { req: { id: number; attempt: number }; res: void }
  /** Stop chasing this invoice without marking it paid. */
  'chasing:stop': { req: { id: number }; res: void }

  /**
   * The outbox.
   *
   * Under the `chasing:` prefix because it is the same entitlement and, today,
   * the same job \u2014 every message in it is a chaser. Named for that rather
   * than for mail generally, so widening it later is a decision somebody takes
   * on purpose rather than a channel that quietly grew.
   */
  'chasing:outbox': { req: void; res: QueuedMail[] }
  /**
   * Send a held message now.
   *
   * A write in the strongest sense the app has: it is the press that turns a
   * draft into something in somebody else's inbox.
   */
  'chasing:send': { req: { id: number }; res: QueuedMail }
  /** Bin a held message. It will not be written again for that milestone. */
  'chasing:discard': { req: { id: number }; res: QueuedMail }
  /**
   * Try the queue again now rather than waiting for the next sweep.
   *
   * Named `sendQueued` rather than `drain` on purpose. The classifier above
   * reads the verb, treats anything it does not recognise as a read, and
   * allows it while the licence is lapsed — so a channel called `drain` would
   * have gone on sending mail for an account that had stopped paying.
   *
   * Exists because the honest answer to \u201cwhy has this not gone?\u201d is usually
   * \u201cthe wifi was down at nine\u201d, and a button beats an explanation.
   */
  'chasing:sendQueued': { req: void; res: { sent: number; failed: number; retrying: number } }

  /**
   * Mail account setup.
   *
   * Separate from `settings:update` because the password never goes into the
   * workspace database and so cannot travel with the rest of the settings
   * patch. It goes to the OS keychain and comes back only as a yes or no \u2014
   * there is no channel that reads it back out.
   */
  /**
   * Automation rules.
   *
   * Ungated for now, like the client update pack, because the tier this lands
   * in is still an open question in the spec. When that is settled it needs one
   * line in `gating.ts` and nothing else — the prefix is already its own.
   */
  'automations:list': { req: void; res: AutomationRule[] }
  'automations:create': { req: AutomationRuleInput; res: AutomationRule }
  'automations:update': { req: { id: number; patch: Partial<AutomationRuleInput> }; res: AutomationRule }
  'automations:delete': { req: { id: number }; res: void }
  /**
   * What this rule has done, newest first.
   *
   * Worth having its own channel rather than riding along with the rule: a
   * feature that acts on your behalf has to be able to show its working, and
   * that history is the only answer to “why is there a task about this?”
   */
  'automations:history': {
    req: { id: number }
    res: { subject: string; ranAt: string; outcome: string }[]
  }
  /**
   * What a rule would match if it were saved right now.
   *
   * The form calls it to say “this matches 12 things today, which will be left
   * alone” — the sentence that makes the backfill visible instead of
   * surprising.
   */
  'automations:preview': {
    req: { trigger: AutomationTrigger; triggerDays: number }
    res: AutomationSubject[]
  }

  /**
   * What one thing is connected to, grouped by what the other end is.
   *
   * One channel for both sources. The foreign keys carry ownership and the
   * `links` table carries everything the keys do not express; a panel drawing
   * a record should not have to know which of its rows came from where.
   *
   * Ungated, and it stays that way: this is how the app answers "what is this
   * thing", not a feature on top of it.
   */
  /**
   * What one row is called, or null when it has gone.
   *
   * The drawer opens on a ref out of the URL and has to draw a heading before
   * it knows anything else — including when the URL names something deleted
   * since the link to it was made.
   */
  /**
   * Named sets of filters, one list at a time.
   *
   * The filters travel as the page's own query string, so nothing on this side
   * of the wire knows what an invoice filter is. `views:save` replaces a view
   * of the same name rather than refusing — the UI asks first, because "I have
   * adjusted this, save it again" is what people actually do.
   */
  /**
   * What has been deleted lately, and putting it back.
   *
   * Every `*:delete` above now goes through the trash, so each of them returns
   * the entry id an undo needs. Nothing is hidden from the rest of the app on
   * the way — the row is really gone from its own table, and what it took with
   * it was captured first. See migration 20.
   */
  /**
   * One vocabulary of tags, shared by every kind of record.
   *
   * `tags:add` takes a name rather than an id, and makes the tag if it is new.
   * Typing a tag and picking one are the same gesture, and splitting them into
   * two channels would put the difference in the caller's hands.
   */
  'tags:list': { req: void; res: TagWithCount[] }
  'tags:for': { req: EntityRef; res: Tag[] }
  'tags:add': { req: EntityRef & { name: string }; res: Tag }
  'tags:remove': { req: EntityRef & { tagId: number }; res: void }
  'tags:rename': { req: { id: number; name: string }; res: Tag }
  'tags:recolour': { req: { id: number; colour: string }; res: void }
  /** Removes it from the vocabulary and from everything carrying it. */
  'tags:delete': { req: { id: number }; res: void }
  /** The ids of one type carrying *every* one of these tags. */
  'tags:matching': { req: { type: EntityType; tagIds: number[] }; res: number[] }

  'trash:list': { req: void; res: TrashEntry[] }
  /** Put one back. `orphaned` names the parents that have gone in the meantime. */
  'trash:restore': { req: { id: number }; res: { restored: string; orphaned: string[] } }
  'trash:purge': { req: { id: number }; res: void }
  'trash:empty': { req: void; res: { count: number } }

  /**
   * File something away, or bring it back. One channel for the five types that
   * can be — invoices and quotes are deliberately not among them, because an
   * invoice's status already says where it went.
   */
  'entity:archive': { req: EntityRef & { archived: boolean }; res: void }
  /** Delete anything, by type. What the drawer uses; the per-type channels stay. */
  'entity:delete': { req: EntityRef; res: TrashEntry }

  'views:list': { req: { page: string }; res: SavedView[] }
  'views:save': { req: { page: string; name: string; query: string }; res: SavedView }
  'views:delete': { req: { id: number }; res: void }
  /** Whether saving under this name would replace something. */
  'views:taken': { req: { page: string; name: string }; res: boolean }

  'entity:label': { req: EntityRef; res: string | null }
  /**
   * Rows to offer in the link picker. Not global search: one type at a time,
   * matching the label the app already shows, with no ranking.
   */
  'entity:find': { req: { type?: EntityType; query: string }; res: LinkedEntity[] }

  'links:related': { req: EntityRef; res: BacklinkGroup[] }
  /** Connect two things. Idempotent, and the same fact from either end. */
  'links:create': { req: { a: EntityRef; b: EntityRef }; res: void }
  /** Disconnect two things. Silent when they were not connected. */
  'links:remove': { req: { a: EntityRef; b: EntityRef }; res: void }

  /**
   * One thing's history, newest first.
   *
   * Written by triggers rather than by the services, so it covers the writes
   * nobody would have remembered to instrument. Edits arrive coalesced into one
   * entry per ten minutes: a line means a sitting, not a keystroke.
   */
  'activity:for': { req: EntityRef & { limit?: number }; res: ActivityEntry[] }
  /** Everything that has happened lately, across the workspace. */
  'activity:recent': { req: { limit?: number } | void; res: ActivityEntry[] }

  'mail:status': { req: void; res: { configured: boolean; hasPassword: boolean } }
  'mail:password': { req: { password: string }; res: void }
  /** Send a test message to the user's own address, with the server's own words on failure. */
  'mail:test': { req: void; res: void }
  /**
   * A statement of account for one client: everything they owe, aged, on one
   * page. Under this prefix because it is the same entitlement and the same
   * job — it is what you send when four separate reminders have not worked.
   *
   * Gated where a plain invoice PDF never is, and the distinction is
   * deliberate: an invoice PDF gets the customer's own record out of the app,
   * which must always work, while this is a document derived from those
   * records for convenience. Returns the workspace-relative path.
   */
  'chasing:statement': {
    req: { clientId: number; from?: string }
    res: string
  }

  /**
   * Raw CSV of one dataset, written into the workspace. Returns its path.
   *
   * Never gated, in either tier, and classified as a read so it survives a
   * lapsed licence — `/terms` promises exactly that, and the argument for a
   * local-first app collapses if getting the work out costs money.
   */
  'export:csv': {
    req: { dataset: Dataset; from?: string; to?: string }
    res: string
  }
  /**
   * The year-end pack: summary, CSVs and every invoice PDF for a tax year, in
   * one folder. Pro, on convenience rather than access — every file in it is
   * obtainable free, one at a time.
   */
  'yearEnd:pack': { req: { startYear?: number }; res: YearEndPack }
  /**
   * The same pack as one dated ZIP, receipt images and all.
   *
   * The form it is actually sent in — an accountant gets an attachment, and
   * asking somebody to zip eleven folders by hand in January is how the
   * eleventh gets left out.
   */
  'yearEnd:accountant': { req: { startYear?: number }; res: YearEndPack }

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

  /**
   * A whole tax year of driving, valued.
   *
   * The year rather than a range, because HMRC's 10,000-mile threshold is an
   * annual one: a journey's rate depends on the miles before it, so there is
   * no honest way to answer for March alone.
   */
  /**
   * Who owes what, aged 30/60/90 against their due dates.
   *
   * Takes no range: what you are owed is a fact about now, the same reason
   * `finance:summary` ignores the period for `outstanding`.
   */
  'debtors:aged': { req: { asOf?: string } | void; res: AgedDebtors }

  /**
   * The Monday review.
   *
   * Computed from the database rather than written by the assistant — this is
   * the page somebody reads and believes without checking, so a hallucinated
   * figure in it would be worse than no review. It needs no Claude account and
   * cannot invent a number.
   */
  /**
   * Where the capacity calculator starts from — seeded from tracked history
   * rather than from optimism, and saying which of the two it used.
   */
  'capacity:defaults': { req: void; res: CapacityDefaults }

  /**
   * Folder structure, checked against the template a project was built to.
   *
   * In 3D and design work a folder structure is file paths, not tidiness — a
   * missing `02-Assets` breaks every texture reference in a scene.
   */
  /**
   * Marketing: channels, the plan, and content.
   *
   * `content:month` returns the gaps alongside the items. They are computed on
   * read from each channel's commitment and never stored — a gap is the
   * absence of something, and storing absences would mean reconciling them
   * every time a real item moved.
   */
  /**
   * Campaigns: the push, and the work that goes into it.
   *
   * `campaigns:work` gathers the three things that hang off one — content,
   * tasks and the files in its folder — in a single call, because a record
   * that fetched them separately would draw itself in three stages.
   */
  'campaigns:list': {
    req: { includeArchived?: boolean; templates?: boolean } | void
    res: CampaignWithCounts[]
  }
  'campaigns:get': { req: { id: number }; res: CampaignWithCounts }
  'campaigns:create': { req: CampaignInput; res: CampaignWithCounts }
  'campaigns:update': { req: { id: number; patch: CampaignInput }; res: CampaignWithCounts }
  /** Never deletes: content, tasks and the folder all keep pointing at it. */
  'campaigns:archive': { req: { id: number; archived?: boolean }; res: CampaignWithCounts }
  'campaigns:work': { req: { id: number }; res: CampaignWork }

  'channels:list': { req: { includeInactive?: boolean } | void; res: MarketingChannel[] }
  'channels:create': { req: MarketingChannelInput; res: MarketingChannel }
  'channels:update': {
    req: { id: number; patch: MarketingChannelInput }
    res: MarketingChannel
  }
  /** Retires a channel. Never deletes: the consistency strip keeps its history. */
  'channels:deactivate': { req: { id: number }; res: MarketingChannel }
  'channels:seed': { req: void; res: number }

  /**
   * What the business plan says that the marketing plan should know.
   *
   * Under `plan:` rather than `ai:` deliberately — these write to Marketing,
   * and `plan:` is the prefix the feature gate already covers. Suggesting is
   * separate from applying because Marketing may hold an audience the user
   * wrote by hand, and replacing it without asking is how somebody stops
   * trusting a document.
   */
  'plan:suggestFromBusiness': {
    req: void
    res: { audience: string; newChannels: string[]; empty: boolean; currentAudience: string }
  }
  'plan:applyFromBusiness': {
    req: { audience?: string; channels?: string[] }
    res: { audience: boolean; channelsCreated: number }
  }

  'plan:get': { req: void; res: MarketingPlan }
  'plan:update': { req: MarketingPlanInput; res: MarketingPlan }

  'content:month': {
    req: { from: string; to: string }
    res: { items: ContentItemWithContext[]; ghosts: { day: string; channelId: number }[] }
  }
  'content:list': {
    req: { from?: string; to?: string; undated?: boolean; campaignId?: number } | void
    res: ContentItemWithContext[]
  }
  'content:get': { req: { id: number }; res: ContentItemWithContext }
  'content:create': { req: ContentItemInput; res: ContentItemWithContext }
  'content:update': {
    req: { id: number; patch: ContentItemInput }
    res: ContentItemWithContext
  }
  'content:delete': { req: { id: number }; res: void }

  'structure:check': {
    req: { projectId: number; templateId?: number }
    res: ProjectStructure
  }
  'structure:checkAll': { req: void; res: ProjectStructure[] }
  /** Creates what is missing. Never deletes, moves or renames anything. */
  'structure:repair': {
    req: { projectId: number; templateId?: number }
    res: { created: string[]; failed: string[]; report: ProjectStructure }
  }
  'structure:usage': { req: void; res: ProjectUsage[] }
  /** What a bulk rename would do, without doing any of it. */
  'structure:planRename': {
    req: { folder: string; pattern: string; projectId?: number }
    res: RenamePreview[]
  }
  'structure:applyRename': {
    req: { folder: string; pattern: string; projectId?: number }
    res: { renamed: number; skipped: RenamePreview[] }
  }

  'review:week': { req: { asOf?: string } | void; res: Review }
  /** Write it into the notebook, once per week. Returns the note it wrote. */
  'review:file': {
    req: { asOf?: string } | void
    res: { review: Review; noteId: number; created: boolean }
  }

  /**
   * The bank import.
   *
   * A CSV the user downloaded themselves — there is no connection to any bank
   * and no credentials anywhere in this app. Importing never reconciles
   * anything: a wrong match marks an invoice paid that was not, which stops
   * the chasing and misstates the income at once, so the app suggests and a
   * person decides.
   */
  'bank:import': { req: { path: string }; res: BankImportResult }
  'bank:list': {
    req: { status?: 'new' | 'matched' | 'ignored' } | void
    res: BankTransactionWithMatches[]
  }
  'bank:summary': { req: void; res: { unreconciled: number; total: number } }
  /** Marks the invoice paid, on the date the money actually arrived. */
  'bank:matchInvoice': { req: { id: number; invoiceId: number }; res: BankTransaction }
  'bank:matchExpense': { req: { id: number; expenseId: number }; res: BankTransaction }
  'bank:createExpense': { req: { id: number; patch?: ExpenseInput }; res: BankTransaction }
  'bank:ignore': { req: { id: number }; res: BankTransaction }
  /** Clears a match. Deliberately does not un-pay the invoice. */
  'bank:unmatch': { req: { id: number }; res: BankTransaction }
  'bank:forget': { req: { source: string }; res: number }

  'mileage:year': { req: { date?: string } | void; res: MileageYear }
  'mileage:create': { req: MileageInput; res: MileageYear }
  'mileage:update': { req: { id: number; patch: MileageInput }; res: MileageYear }
  'mileage:delete': { req: { id: number }; res: MileageYear }
  'mileage:rates': { req: void; res: MileageRateRow[] }
  'mileage:setRate': { req: MileageRateRow; res: MileageRateRow[] }

  'finance:summary': { req: { period: Period; reference?: string }; res: FinanceSummary }
  'finance:series': {
    req: { period: Period; reference?: string }
    res: FinancePoint[]
  }
  'finance:topClients': { req: { period: Period; reference?: string }; res: ClientTotal[] }
  /**
   * Six periods behind each dashboard figure, for the sparklines. One call
   * rather than four, because it is one screen and they arrive together.
   */
  'dashboard:trends': { req: void; res: DashboardTrends }
  /**
   * Estimated income tax and Class 4 NI for the current tax year, and whether
   * the set-aside rate will cover it.
   */
  'finance:tax': { req: void; res: TaxPosition }
  /** Effective hourly rate per client — invoiced against hours tracked. */
  'finance:clientRates': { req: void; res: ClientProfitability[] }
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
  'calendar:blocks': {
    req: { from: string; to: string; projectId?: number }
    res: CalendarBlockWithContext[]
  }
  'calendar:block': { req: { id: number }; res: CalendarBlockWithContext }
  'calendar:createBlock': { req: BlockInput; res: CalendarBlockWithContext }
  'calendar:updateBlock': {
    req: { id: number; patch: Partial<BlockInput> }
    res: CalendarBlockWithContext
  }
  // No `deleteBlock`: a block is an entity, so it is deleted through
  // `entity:delete` and lands in the trash like everything else.
  'calendar:upcoming': { req: { limit?: number } | void; res: CalendarBlockWithContext[] }
  'calendar:settings': { req: void; res: CalendarSettings }
  'calendar:updateSettings': { req: Partial<CalendarSettings>; res: CalendarSettings }

  /** Dates the calendar shows but does not own — never rows, never draggable. */
  'calendar:markers': { req: { from: string; to: string }; res: DerivedMarker[] }
  'calendar:unscheduled': {
    req: { search?: string; projectId?: number } | void
    res: TaskWithContext[]
  }
  'calendar:scheduleTask': {
    req: { taskId: number; startsAt: string; endsAt?: string }
    res: CalendarBlockWithContext
  }
  /**
   * Take a block's length as the task's estimate. Explicit, and never a side
   * effect of resizing — see `scheduling.ts`.
   */
  'calendar:adoptEstimate': { req: { blockId: number }; res: TaskWithContext }

  /**
   * Change one, some or all of a repeating block.
   *
   * `day` names the occurrence being edited, because most of them are not
   * rows. `scope` has no default anywhere in the stack: the caller has to have
   * asked, since the difference between the three is a year of somebody's
   * diary.
   */
  'calendar:editOccurrence': {
    req: { id: number; day: string; scope: EditScope; patch: Partial<BlockInput> }
    res: CalendarBlockWithContext
  }
  'calendar:deleteOccurrence': {
    req: { id: number; day: string; scope: EditScope }
    res: void
  }

  /**
   * Subscribed calendars. The only outward-facing thing in the module, and
   * the whole of what it does is an HTTP GET of the feed URL.
   */
  /**
   * Read a receipt image with Windows' own OCR — offline, and nothing leaves
   * the machine. Returns guesses for a form somebody then checks.
   */
  'expenses:readReceipt': {
    req: { path: string }
    res: { text: string; reading: ReceiptReading; error: string | null }
  }

  /** The dates inside a project that are not its deadline. */
  'milestones:list': { req: { projectId: number }; res: ProjectMilestone[] }
  'milestones:create': {
    req: { projectId: number; title: string; dueOn: string; notes?: string }
    res: ProjectMilestone
  }
  'milestones:update': {
    req: { id: number; patch: Partial<ProjectMilestone> }
    res: ProjectMilestone
  }
  'milestones:reached': { req: { id: number; reached: boolean }; res: ProjectMilestone }
  'milestones:delete': { req: { id: number }; res: void }

  'calendar:subscriptions': { req: void; res: CalendarSubscription[] }
  'calendar:subscribe': {
    req: { name: string; url: string; colour?: string; refreshMinutes?: number }
    res: CalendarSubscription
  }
  'calendar:updateSubscription': {
    req: { id: number; patch: Partial<CalendarSubscription> }
    res: CalendarSubscription
  }
  'calendar:unsubscribe': { req: { id: number }; res: void }
  /** Refresh now. Failure comes back in the result, never as a thrown error. */
  'calendar:syncSubscription': {
    req: { id: number }
    res: { added: number; updated: number; removed: number; error: string | null }
  }
  /** Take a locked block into the user's own calendar, editable. */
  'calendar:copyToMine': { req: { id: number }; res: void }
  /** Read an .ics file the user picked. Returns how many blocks it made. */
  'calendar:importIcs': { req: void; res: number }
  /** Write the user's own blocks out. Returns the path written. */
  'calendar:exportIcs': {
    req: { from: string; to: string; blockTypes?: string[] }
    res: string | null
  }

  'marketing:campaigns': {
    req: { includeArchived?: boolean } | void
    res: PostCampaignWithCounts[]
  }
  'marketing:createCampaign': {
    req: Partial<PostCampaign> & { name: string }
    res: PostCampaign
  }
  'marketing:updateCampaign': {
    req: { id: number; patch: Partial<PostCampaign> }
    res: PostCampaign
  }
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
  /** A new notification, to slide into the corner of the window. */
  'notifications:new': AppNotification
  /** Update progress, so the UI follows a download rather than polling it. */
  'updates:state': UpdateState
  /**
   * A licence check in the background changed the answer — the licence lapsed,
   * was paid, or the plan moved. Only sent when something actually differs, so
   * it is safe to treat every one of these as worth reacting to.
   */
  'auth:changed': AuthState
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
  'auth:state',
  'auth:signIn',
  'auth:signUp',
  'auth:signOut',
  'auth:verify',
  'auth:setServer',
  'entitlements:meters',
  'entitlements:exceeded',
  'updates:get',
  'updates:check',
  'updates:install',
  'notifications:list',
  'notifications:unread',
  'notifications:read',
  'notifications:readAll',
  'notifications:archive',
  'notifications:archiveRead',
  'notifications:restore',
  'notifications:delete',
  'goals:list',
  'goals:create',
  'goals:update',
  'goals:delete',
  'notes:standalone',
  'notes:createStandalone',
  'notes:rename',
  'notes:pin',
  'ai:businessPlan',
  'ai:attachBusinessPlan',
  'ai:detachBusinessPlan',
  'ai:openBusinessPlan',
  'ai:writeBusinessPlan',
  'ai:planPrefill',
  'ai:buildBusinessPlan',
  'ai:startBusinessPlan',
  'state:get',
  'state:set',
  'clients:list',
  'clients:get',
  'clients:create',
  'clients:update',
  'clients:delete',
  'clients:updatePack',
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
  'docTemplates:list',
  'docTemplates:get',
  'docTemplates:create',
  'docTemplates:update',
  'docTemplates:delete',
  'docTemplates:restore',
  'docTemplates:preview',
  'documents:generate',
  'documents:get',
  'documents:save',
  'documents:versions',
  'documents:restoreVersion',
  'documents:setStatus',
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
  'invoices:receipt',
  'invoices:chaser',
  'chasing:due',
  'chasing:record',
  'chasing:stop',
  'chasing:statement',
  'chasing:outbox',
  'chasing:send',
  'chasing:discard',
  'chasing:sendQueued',
  'tags:list',
  'tags:for',
  'tags:add',
  'tags:remove',
  'tags:rename',
  'tags:recolour',
  'tags:delete',
  'tags:matching',
  'trash:list',
  'trash:restore',
  'trash:purge',
  'trash:empty',
  'entity:archive',
  'entity:delete',
  'views:list',
  'views:save',
  'views:delete',
  'views:taken',
  'entity:label',
  'entity:find',
  'links:related',
  'links:create',
  'links:remove',
  'activity:for',
  'activity:recent',
  'automations:list',
  'automations:create',
  'automations:update',
  'automations:delete',
  'automations:history',
  'automations:preview',
  'mail:status',
  'mail:password',
  'mail:test',
  'export:csv',
  'yearEnd:pack',
  'yearEnd:accountant',
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
  'debtors:aged',
  'capacity:defaults',
  'campaigns:list',
  'campaigns:get',
  'campaigns:create',
  'campaigns:update',
  'campaigns:archive',
  'campaigns:work',
  'channels:list',
  'channels:create',
  'channels:update',
  'channels:deactivate',
  'channels:seed',
  'plan:suggestFromBusiness',
  'plan:applyFromBusiness',
  'plan:get',
  'plan:update',
  'content:month',
  'content:list',
  'content:get',
  'content:create',
  'content:update',
  'content:delete',
  'structure:check',
  'structure:checkAll',
  'structure:repair',
  'structure:usage',
  'structure:planRename',
  'structure:applyRename',
  'review:week',
  'review:file',
  'bank:import',
  'bank:list',
  'bank:summary',
  'bank:matchInvoice',
  'bank:matchExpense',
  'bank:createExpense',
  'bank:ignore',
  'bank:unmatch',
  'bank:forget',
  'mileage:year',
  'mileage:create',
  'mileage:update',
  'mileage:delete',
  'mileage:rates',
  'mileage:setRate',
  'finance:summary',
  'finance:series',
  'finance:topClients',
  'finance:tax',
  'finance:clientRates',
  'dashboard:trends',
  'finance:profitability',
  'calendar:blocks',
  'calendar:block',
  'calendar:createBlock',
  'calendar:updateBlock',
  'calendar:upcoming',
  'calendar:settings',
  'calendar:updateSettings',
  'calendar:markers',
  'calendar:unscheduled',
  'calendar:scheduleTask',
  'calendar:adoptEstimate',
  'calendar:editOccurrence',
  'calendar:deleteOccurrence',
  'expenses:readReceipt',
  'milestones:list',
  'milestones:create',
  'milestones:update',
  'milestones:reached',
  'milestones:delete',
  'calendar:subscriptions',
  'calendar:subscribe',
  'calendar:updateSubscription',
  'calendar:unsubscribe',
  'calendar:syncSubscription',
  'calendar:copyToMine',
  'calendar:importIcs',
  'calendar:exportIcs',
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
  'marketing:focusPost',
  'notifications:new',
  'updates:state',
  'auth:changed'
] as const satisfies readonly IpcEvent[]
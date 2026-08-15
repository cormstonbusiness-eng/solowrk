/**
 * The single source of truth for every main <-> renderer channel.
 *
 * Adding a feature means adding an entry to `IpcContract` here, a handler in
 * `src/main/ipc/`, and nothing else — the preload bridge and the renderer's
 * `window.solo` typings are both derived from this type. If it isn't declared
 * here, it isn't reachable from the renderer.
 */

import type {
  BusinessSettings,
  Category,
  Client,
  ClientInput,
  DocumentInput,
  DocumentRecord,
  FileEntry,
  FolderInspection,
  Note,
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

  'documents:list': { req: { search?: string; category?: string } | void; res: DocumentRecord[] }
  'documents:add': {
    req: DocumentInput & { sourcePath: string }
    res: DocumentRecord
  }
  'documents:update': { req: { id: number; patch: Partial<DocumentInput> }; res: DocumentRecord }
  'documents:delete': { req: { id: number }; res: void }
  'documents:expiring': { req: { days?: number } | void; res: DocumentRecord[] }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['req']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res']

/**
 * Channels the main process pushes to the renderer without being asked.
 */
export interface IpcEvents {
  'window:stateChanged': WindowState
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
  'documents:list',
  'documents:add',
  'documents:update',
  'documents:delete',
  'documents:expiring'
] as const satisfies readonly IpcChannel[]

export const IPC_EVENTS = ['window:stateChanged'] as const satisfies readonly IpcEvent[]
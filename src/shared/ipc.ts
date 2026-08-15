/**
 * The single source of truth for every main <-> renderer channel.
 *
 * Adding a feature means adding an entry to `IpcContract` here, a handler in
 * `src/main/ipc/`, and nothing else — the preload bridge and the renderer's
 * `window.solo` typings are both derived from this type. If it isn't declared
 * here, it isn't reachable from the renderer.
 */

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
  'window:state'
] as const satisfies readonly IpcChannel[]

export const IPC_EVENTS = ['window:stateChanged'] as const satisfies readonly IpcEvent[]
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcChannel,
  type IpcEvent,
  type IpcEvents,
  type IpcRequest,
  type IpcResponse
} from '@shared/ipc'

const channelAllowlist = new Set<string>(IPC_CHANNELS)
const eventAllowlist = new Set<string>(IPC_EVENTS)

/**
 * The only surface the renderer gets. No `fs`, no `ipcRenderer`, no Node —
 * everything goes through a channel that must appear in the shared allowlist.
 */
const api = {
  invoke<C extends IpcChannel>(channel: C, payload?: IpcRequest<C>): Promise<IpcResponse<C>> {
    if (!channelAllowlist.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>
  },

  /**
   * Absolute path of a File dropped from Explorer.
   *
   * Electron removed the non-standard `File.path` property, so this is the only
   * way to learn where a dropped file came from. It reads a path the user has
   * just handed us by dragging; it grants no ability to read that file — the
   * import still goes through a validated IPC channel in main.
   */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },

  /** Subscribe to a pushed event. Returns an unsubscribe function. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
    if (!eventAllowlist.has(event)) {
      throw new Error(`Blocked IPC event: ${event}`)
    }
    const wrapped = (_e: unknown, payload: IpcEvents[E]): void => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  }
}

export type SoloApi = typeof api

contextBridge.exposeInMainWorld('solo', api)
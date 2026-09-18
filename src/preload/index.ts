import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { unwrapIpcError } from '@shared/ipcError'
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
    /*
      Rejections come back wearing Electron's plumbing:

        Error invoking remote method 'auth:signIn': Error: That email and
        password do not match.

      The message the main process wrote is perfectly clear on its own; the
      prefix names an internal channel and makes a mistyped password look like
      broken software. Taken off here so every channel benefits rather than
      each screen remembering to do it — and so nothing downstream has to know
      the envelope exists.

      The error is re-thrown rather than replaced, keeping the original as
      `cause`, so a stack trace in the console still points at the real thing.
    */
    return (ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>).catch(
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        const clean = unwrapIpcError(message)

        if (clean === message) throw cause

        throw new Error(clean, { cause })
      }
    )
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
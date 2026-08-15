import { app, ipcMain, type BrowserWindow } from 'electron'
import type { IpcChannel, IpcContract } from '@shared/ipc'
import { readWindowState } from './window'

type WindowGetter = () => BrowserWindow | null

/**
 * A handler map keyed by the shared contract, so a channel declared in
 * `@shared/ipc` without an implementation here is a compile error, and vice
 * versa. This is what keeps the bridge honest as the app grows.
 */
type Handlers = {
  [C in IpcChannel]: (
    getWindow: WindowGetter,
    payload: IpcContract[C]['req']
  ) => IpcContract[C]['res'] | Promise<IpcContract[C]['res']>
}

const handlers: Handlers = {
  'app:info': () => ({
    name: 'Solo',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }),

  'window:minimize': (getWindow) => {
    getWindow()?.minimize()
  },

  'window:toggleMaximize': (getWindow) => {
    const window = getWindow()
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  },

  'window:close': (getWindow) => {
    getWindow()?.close()
  },

  'window:state': (getWindow) => readWindowState(getWindow())
}

export function registerIpcHandlers(getWindow: WindowGetter): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel]
    ipcMain.handle(channel, (_event, payload: unknown) =>
      (handler as (g: WindowGetter, p: unknown) => unknown)(getWindow, payload)
    )
  }
}
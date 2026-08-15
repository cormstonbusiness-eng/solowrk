import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type OpenDialogOptions
} from 'electron'
import type { IpcChannel, IpcContract } from '@shared/ipc'
import { readWindowState } from './window'
import { session } from '../services/session'
import { suggestedWorkspacePath } from '../services/config'
import { inspectFolder } from '../services/workspace'
import { updateSettings } from '../services/settings'

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

  'window:state': (getWindow) => readWindowState(getWindow()),

  'workspace:status': () => session.restore(),

  'workspace:browse': async (getWindow, { startIn }) => {
    const window = getWindow()
    const options: OpenDialogOptions = {
      title: 'Choose a folder for your Solo workspace',
      defaultPath: startIn ?? suggestedWorkspacePath(),
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  },

  'workspace:inspect': (_getWindow, { path }) => inspectFolder(path),

  'workspace:create': (_getWindow, setup) => session.create(setup),

  'workspace:adopt': (_getWindow, { path }) => session.adopt(path),

  'workspace:reveal': () => {
    void shell.openPath(session.requirePath())
  },

  'settings:get': () => session.settings(),

  'settings:update': (_getWindow, patch) => updateSettings(session.requireDb(), patch)
}

export function registerIpcHandlers(getWindow: WindowGetter): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel]
    ipcMain.handle(channel, (_event, payload: unknown) =>
      (handler as (g: WindowGetter, p: unknown) => unknown)(getWindow, payload)
    )
  }
}
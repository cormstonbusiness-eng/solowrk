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
import { inspectFolder, resolveInWorkspace } from '../services/workspace'
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  updateClient
} from '../services/clients'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject
} from '../services/projects'
import { createTask, deleteTask, listTasks, moveTask, updateTask } from '../services/tasks'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory
} from '../services/categories'
import { createNote, deleteNote, listNotes, readNote, writeNote } from '../services/notes'
import { deleteTemplate, listTemplates, templateFromProject } from '../services/templates'
import { updateSettings } from '../services/settings'
import { getState, setState } from '../services/appState'

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

  'settings:update': (_getWindow, patch) => updateSettings(session.requireDb(), patch),

  'state:get': (_getWindow, { key }) => getState(session.requireDb(), key),

  'state:set': (_getWindow, { key, value }) => setState(session.requireDb(), key, value),

  'clients:list': (_g, args) => listClients(session.requireDb(), args?.includeArchived ?? false),
  'clients:get': (_g, { id }) => getClient(session.requireDb(), id),
  'clients:create': (_g, input) =>
    createClient(session.requireDb(), session.requirePath(), input),
  'clients:update': (_g, { id, patch }) =>
    updateClient(session.requireDb(), session.requirePath(), id, patch),
  'clients:delete': (_g, { id }) => deleteClient(session.requireDb(), id),

  'projects:list': (_g, args) => listProjects(session.requireDb(), args ?? {}),
  'projects:get': (_g, { id }) => getProject(session.requireDb(), id),
  'projects:create': (_g, input) =>
    createProject(session.requireDb(), session.requirePath(), input),
  'projects:update': (_g, { id, patch }) =>
    updateProject(session.requireDb(), session.requirePath(), id, patch),
  'projects:delete': (_g, { id }) => deleteProject(session.requireDb(), id),
  'projects:reveal': (_g, { id }) => {
    const project = getProject(session.requireDb(), id)
    void shell.openPath(resolveInWorkspace(session.requirePath(), project.folder))
  },

  'tasks:list': (_g, filter) => listTasks(session.requireDb(), filter ?? {}),
  'tasks:create': (_g, input) => createTask(session.requireDb(), input),
  'tasks:update': (_g, { id, patch }) => updateTask(session.requireDb(), id, patch),
  'tasks:move': (_g, { id, status, projectId, beforeId }) =>
    moveTask(session.requireDb(), id, { status, projectId, beforeId }),
  'tasks:delete': (_g, { id }) => deleteTask(session.requireDb(), id),

  'categories:list': () => listCategories(session.requireDb()),
  'categories:create': (_g, { name, colour }) =>
    createCategory(session.requireDb(), name, colour),
  'categories:update': (_g, { id, patch }) => updateCategory(session.requireDb(), id, patch),
  'categories:delete': (_g, { id }) => deleteCategory(session.requireDb(), id),

  'notes:list': (_g, { projectId }) => listNotes(session.requireDb(), projectId),
  'notes:create': (_g, { projectId, title }) =>
    createNote(session.requireDb(), session.requirePath(), projectId, title),
  'notes:read': (_g, { id }) => readNote(session.requireDb(), session.requirePath(), id),
  'notes:write': (_g, { id, content }) =>
    writeNote(session.requireDb(), session.requirePath(), id, content),
  'notes:delete': (_g, { id }) => deleteNote(session.requireDb(), session.requirePath(), id),

  'templates:list': () => listTemplates(session.requireDb()),
  'templates:fromProject': (_g, { projectId, name, description }) =>
    templateFromProject(session.requireDb(), projectId, name, description),
  'templates:delete': (_g, { id }) => deleteTemplate(session.requireDb(), id)
}

export function registerIpcHandlers(getWindow: WindowGetter): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel]
    ipcMain.handle(channel, (_event, payload: unknown) =>
      (handler as (g: WindowGetter, p: unknown) => unknown)(getWindow, payload)
    )
  }
}
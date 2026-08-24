import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type OpenDialogOptions
} from 'electron'
import { allowedWhenReadOnly, type IpcChannel, type IpcContract } from '@shared/ipc'
import { gateFor } from './gating'
import {
  chaseSchedule,
  draftChaser,
  dueChasers,
  markChased,
  stopChasing
} from '../services/chasers'
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
import {
  createFolder,
  importFiles,
  listDirectory,
  openEntry,
  recentFiles,
  renameEntry,
  revealEntry,
  trashEntry
} from '../services/files'
import {
  addDocument,
  deleteDocument,
  expiringDocuments,
  listDocuments,
  updateDocument
} from '../services/documents'
import { getSettings } from '../services/settings'
import {
  createEntry,
  deleteEntry,
  getRunning,
  listEntries,
  startTimer,
  stopTimer,
  unbilledFor,
  updateEntry
} from '../services/time'
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  overdueInvoices,
  updateInvoice
} from '../services/invoices'
import {
  convertQuote,
  createQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  updateQuote
} from '../services/quotes'
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense
} from '../services/expenses'
import { projectProfitability, series, summary, topClients } from '../services/finance'
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  upcomingEvents
} from '../services/events'
import { nowStamp } from '@shared/calendar'
import {
  createCampaign,
  createPillar,
  createPost,
  deleteCampaign,
  deletePillar,
  deletePost,
  getPost,
  listCampaigns,
  listPillars,
  listPosts,
  marketingSummary,
  updateCampaign,
  updatePillar,
  updatePost
} from '../services/marketing'
import { listAccounts } from '../social/accounts'
import { clearLogo, logoDataUrl, setLogo } from '../services/branding'
import { createGoal, deleteGoal, listGoals, updateGoal } from '../services/goals'
import {
  archiveNotification,
  archiveRead,
  deleteNotification,
  listNotifications,
  markAllRead,
  markRead,
  restoreNotification,
  unreadCount
} from '../services/notifications'
import { listStandaloneNotes, renameNote, setNotePinned } from '../services/notes'
import {
  attachPlan,
  detachPlan,
  planStatus,
  startPlan,
  writePlan
} from '../ai/businessPlan'
import { today } from '@shared/taxYear'
import { assistant } from '../ai/assistant'
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages
} from '../services/conversations'
import { writePdf } from '../services/pdf'
import { rangeFor } from '@shared/taxYear'
import { updateSettings } from '../services/settings'
import { getState, setState } from '../services/appState'
import { check, installNow, updateState } from '../services/updates'
import {
  authState,
  hasFeature,
  isReadOnly,
  setApiBaseUrl,
  signIn,
  signOut,
  signUp,
  verify
} from '../services/auth'

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
    name: 'SoloWrk',
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
      title: 'Choose a folder for your SoloWrk workspace',
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
  'templates:delete': (_g, { id }) => deleteTemplate(session.requireDb(), id),

  'files:list': (_g, { path }) => listDirectory(session.requirePath(), path),
  'files:createFolder': (_g, { parent, name }) =>
    createFolder(session.requirePath(), parent, name),
  'files:rename': (_g, { path, name }) => renameEntry(session.requirePath(), path, name),
  'files:trash': (_g, { path }) => trashEntry(session.requirePath(), path),
  'files:open': (_g, { path }) => openEntry(session.requirePath(), path),
  'files:reveal': (_g, { path }) => revealEntry(session.requirePath(), path),
  'files:import': (_g, { destination, sources }) =>
    importFiles(session.requirePath(), destination, sources),

  'files:pick': async (getWindow, args) => {
    const window = getWindow()
    const options: OpenDialogOptions = {
      title: 'Choose files',
      buttonLabel: 'Add',
      properties: args?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? [] : result.filePaths
  },

  'files:recent': (_g, args) => recentFiles(session.requirePath(), args?.limit ?? 6),

  'documents:list': (_g, args) => listDocuments(session.requireDb(), args ?? {}),
  'documents:add': (_g, input) =>
    addDocument(session.requireDb(), session.requirePath(), input),
  'documents:update': (_g, { id, patch }) => updateDocument(session.requireDb(), id, patch),
  'documents:delete': (_g, { id }) => deleteDocument(session.requireDb(), id),
  'documents:expiring': (_g, args) => expiringDocuments(session.requireDb(), args?.days ?? 45),

  'shell:mailto': (_g, { to, subject, body }) => {
    // Opens the user's mail client with a draft. Sending stays their decision.
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`
    void shell.openExternal(url)
  },

  'time:running': () => getRunning(session.requireDb()),
  'time:start': (_g, input) => startTimer(session.requireDb(), input),
  'time:stop': (_g, { id }) => stopTimer(session.requireDb(), id),
  'time:list': (_g, filter) => listEntries(session.requireDb(), filter ?? {}),
  'time:create': (_g, input) => createEntry(session.requireDb(), input),
  'time:update': (_g, { id, patch }) => updateEntry(session.requireDb(), id, patch),
  'time:delete': (_g, { id }) => deleteEntry(session.requireDb(), id),
  'time:unbilled': (_g, { projectId }) => unbilledFor(session.requireDb(), projectId),

  'invoices:list': (_g, filter) => listInvoices(session.requireDb(), filter ?? {}),
  'invoices:get': (_g, { id }) => getInvoice(session.requireDb(), id),
  'invoices:create': (_g, input) => createInvoice(session.requireDb(), input),
  'invoices:update': (_g, { id, patch }) => updateInvoice(session.requireDb(), id, patch),
  'invoices:delete': (_g, { id }) => deleteInvoice(session.requireDb(), id),
  'invoices:overdue': () => overdueInvoices(session.requireDb()),

  'invoices:pdf': async (_g, { id }) => {
    const db = session.requireDb()
    const invoice = getInvoice(db, id)
    const client = invoice.clientId ? getClient(db, invoice.clientId) : null

    const path = await writePdf(
      session.requirePath(),
      {
        kind: 'invoice',
        number: invoice.number,
        issueDate: invoice.issueDate,
        secondaryDate: invoice.dueDate,
        clientName: invoice.clientName,
        clientAddress: client?.address ?? '',
        lines: invoice.lines,
        net: invoice.net,
        vat: invoice.vat,
        vatRate: invoice.vatRate,
        gross: invoice.gross,
        notes: invoice.notes
      },
      getSettings(db)
    )

    db.run('UPDATE invoices SET pdf_path = ? WHERE id = ?', [path, id])
    return path
  },

  'invoices:chaser': (_g, { id, attempt }) => {
    const db = session.requireDb()
    // Without an explicit attempt, this is the button being pressed by hand:
    // draft the next note actually due rather than always the gentlest one.
    const next = attempt ?? nextAttemptFor(db, id)
    return draftChaser(db, id, next)
  },

  'invoices:chasesDue': () => dueChasers(session.requireDb()),

  'invoices:markChased': (_g, { id, attempt }) => {
    markChased(session.requireDb(), id, attempt)
  },

  'invoices:stopChasing': (_g, { id }) => {
    stopChasing(session.requireDb(), id)
  },

  'quotes:list': (_g, filter) => listQuotes(session.requireDb(), filter ?? {}),
  'quotes:get': (_g, { id }) => getQuote(session.requireDb(), id),
  'quotes:create': (_g, input) => createQuote(session.requireDb(), input),
  'quotes:update': (_g, { id, patch }) => updateQuote(session.requireDb(), id, patch),
  'quotes:delete': (_g, { id }) => deleteQuote(session.requireDb(), id),

  'quotes:pdf': async (_g, { id }) => {
    const db = session.requireDb()
    const quote = getQuote(db, id)
    const client = quote.clientId ? getClient(db, quote.clientId) : null

    const path = await writePdf(
      session.requirePath(),
      {
        kind: 'quote',
        number: quote.number,
        issueDate: quote.issueDate,
        secondaryDate: quote.validUntil,
        clientName: quote.clientName,
        clientAddress: client?.address ?? '',
        lines: quote.lines,
        net: quote.net,
        vat: quote.vat,
        vatRate: quote.vatRate,
        gross: quote.gross,
        notes: quote.notes
      },
      getSettings(db)
    )

    db.run('UPDATE quotes SET pdf_path = ? WHERE id = ?', [path, id])
    return path
  },

  'quotes:convert': async (_g, { id, createProject: withProject, projectName, depositPercent }) => {
    const result = await convertQuote(session.requireDb(), session.requirePath(), id, {
      createProject: withProject,
      projectName,
      depositPercent
    })
    return { projectId: result.projectId, invoiceId: result.invoiceId }
  },

  'expenses:list': (_g, filter) => listExpenses(session.requireDb(), filter ?? {}),
  'expenses:create': (_g, input) =>
    createExpense(session.requireDb(), session.requirePath(), input),
  'expenses:update': (_g, { id, patch }) =>
    updateExpense(session.requireDb(), session.requirePath(), id, patch),
  'expenses:delete': (_g, { id }) => deleteExpense(session.requireDb(), id),

  'finance:summary': (_g, { period, reference }) =>
    summary(session.requireDb(), rangeFor(period, reference)),

  'finance:series': (_g, { period, reference }) =>
    series(
      session.requireDb(),
      rangeFor(period, reference),
      // Day buckets for anything up to a quarter; a tax year of daily points
      // is unreadable and mostly zeros.
      period === 'year' ? 'month' : 'day'
    ),

  'finance:topClients': (_g, { period, reference }) =>
    topClients(session.requireDb(), rangeFor(period, reference)),

  'finance:profitability': () => projectProfitability(session.requireDb()),

  'events:list': (_g, range) => listEvents(session.requireDb(), range),

  'events:create': (_g, input) => createEvent(session.requireDb(), input),

  'events:update': (_g, { id, patch }) => updateEvent(session.requireDb(), id, patch),

  'events:delete': (_g, { id }) => {
    deleteEvent(session.requireDb(), id)
  },

  'events:upcoming': (_g, payload) =>
    upcomingEvents(session.requireDb(), nowStamp(), payload?.limit ?? 5),

  'app:version': () => app.getVersion(),

  'auth:state': () => authState(),
  'auth:signIn': (_g, { email, password }) => signIn(email, password),
  'auth:signUp': (_g, { name, email, password }) => signUp(name, email, password),
  'auth:signOut': () => signOut(),
  /**
   * Broadcast as well as return.
   *
   * Settings owns this button, and it keeps the answer in its own react-query
   * cache. App.tsx — which decides whether the read-only bar is on screen —
   * reads the auth state once into `useState` when it mounts and never again.
   * So pressing "Check licence" on a lapsed licence used to block every edit
   * in the main process while the banner explaining why stayed hidden until
   * the next launch: the app would simply refuse to save, and say nothing.
   */
  'auth:verify': async (getWindow) => {
    const state = await verify()
    getWindow()?.webContents.send('auth:changed', state)
    return state
  },
  'auth:setServer': (_g, { url }) => setApiBaseUrl(url),

  'updates:get': () => updateState(),
  'updates:check': () => check(),
  'updates:install': () => installNow(),

  'settings:setLogo': async (_g, { sourcePath }) => {
    await setLogo(session.requireDb(), session.requirePath(), sourcePath)
    return getSettings(session.requireDb())
  },
  'settings:clearLogo': () => {
    clearLogo(session.requireDb())
    return getSettings(session.requireDb())
  },
  'settings:logo': () => logoDataUrl(session.requireDb(), session.requirePath()),

  'notifications:list': (_g, args) =>
    listNotifications(session.requireDb(), { archived: args?.archived ?? false }),
  'notifications:unread': () => unreadCount(session.requireDb()),
  'notifications:read': (_g, { id }) => {
    markRead(session.requireDb(), id)
  },
  'notifications:readAll': () => {
    markAllRead(session.requireDb())
  },
  'notifications:archive': (_g, { id }) => {
    archiveNotification(session.requireDb(), id)
  },
  'notifications:archiveRead': () => {
    archiveRead(session.requireDb())
  },
  'notifications:restore': (_g, { id }) => {
    restoreNotification(session.requireDb(), id)
  },
  'notifications:delete': (_g, { id }) => {
    deleteNotification(session.requireDb(), id)
  },

  'goals:list': (_g, args) => listGoals(session.requireDb(), args?.includeArchived ?? false),
  'goals:create': (_g, input) => createGoal(session.requireDb(), input),
  'goals:update': (_g, { id, patch }) => updateGoal(session.requireDb(), id, patch),
  'goals:delete': (_g, { id }) => {
    deleteGoal(session.requireDb(), id)
  },

  'notes:standalone': (_g, args) => listStandaloneNotes(session.requireDb(), args?.search),
  'notes:createStandalone': (_g, { title }) =>
    createNote(session.requireDb(), session.requirePath(), null, title),
  'notes:rename': (_g, { id, title }) => {
    renameNote(session.requireDb(), id, title)
  },
  'notes:pin': (_g, { id, pinned }) => {
    setNotePinned(session.requireDb(), id, pinned)
  },

  'ai:businessPlan': () => planStatus(session.requireDb()),
  'ai:attachBusinessPlan': (_g, { sourcePath }) =>
    attachPlan(session.requireDb(), session.requirePath(), sourcePath),
  'ai:detachBusinessPlan': () => detachPlan(session.requireDb()),
  'ai:openBusinessPlan': () => {
    const { businessPlanFile } = getSettings(session.requireDb())
    if (businessPlanFile === '') return
    void shell.openPath(resolveInWorkspace(session.requirePath(), businessPlanFile))
  },
  'ai:writeBusinessPlan': (_g, { text }) =>
    writePlan(session.requireDb(), session.requirePath(), text),
  'ai:startBusinessPlan': () => startPlan(session.requireDb(), session.requirePath()),

  'marketing:campaigns': (_g, args) =>
    listCampaigns(session.requireDb(), args?.includeArchived ?? false),
  'marketing:createCampaign': (_g, input) => createCampaign(session.requireDb(), input),
  'marketing:updateCampaign': (_g, { id, patch }) =>
    updateCampaign(session.requireDb(), id, patch),
  'marketing:deleteCampaign': (_g, { id }) => {
    deleteCampaign(session.requireDb(), id)
  },

  'marketing:pillars': () => listPillars(session.requireDb()),
  'marketing:createPillar': (_g, input) => createPillar(session.requireDb(), input),
  'marketing:updatePillar': (_g, { id, patch }) => updatePillar(session.requireDb(), id, patch),
  'marketing:deletePillar': (_g, { id }) => {
    deletePillar(session.requireDb(), id)
  },

  'marketing:posts': (_g, filter) => listPosts(session.requireDb(), filter ?? {}),
  'marketing:post': (_g, { id }) => getPost(session.requireDb(), id),
  'marketing:createPost': (_g, input) =>
    createPost(session.requireDb(), session.requirePath(), input, today()),
  'marketing:updatePost': (_g, { id, patch }) =>
    updatePost(session.requireDb(), session.requirePath(), id, patch, today()),
  'marketing:deletePost': (_g, { id }) => {
    deletePost(session.requireDb(), id)
  },

  /**
   * The manual route, for a platform with no connection — and the fallback for
   * one whose auto-post failed. Copies the caption and opens the folder holding
   * the images, which between them is the whole job of posting by hand.
   */
  'marketing:handoff': (_g, { postId, platform }) => {
    const post = getPost(session.requireDb(), postId)
    const target = post.targets.find((entry) => entry.platform === platform)

    clipboard.writeText(target?.body?.trim() || post.body)

    const first = post.media[0]
    if (first) {
      shell.showItemInFolder(resolveInWorkspace(session.requirePath(), first.file))
    }
  },

  'marketing:summary': (_g, range) => marketingSummary(session.requireDb(), range),

  'social:accounts': () => listAccounts(session.requireDb()),

  'ai:status': () => assistant.status(),
  'ai:conversations': () => listConversations(session.requireDb()),
  'ai:messages': (_g, { conversationId }) => listMessages(session.requireDb(), conversationId),
  'ai:newConversation': (_g, payload) =>
    createConversation(session.requireDb(), payload?.projectId ?? null),
  'ai:deleteConversation': (_g, { id }) => {
    deleteConversation(session.requireDb(), id)
  },
  'ai:send': (getWindow, { conversationId, text, mode }) =>
    assistant.send(getWindow, conversationId, text, mode),
  'ai:interrupt': () => assistant.interrupt(),
  'ai:permission': (_g, answer) => {
    assistant.answerPermission(answer)
  }
}

/**
 * Which note the manual button should write.
 *
 * One past whatever has already been sent, capped at the end of the schedule,
 * so pressing it twice in a morning does not produce the same words twice — and
 * the firmest register keeps applying however long it drags on.
 */
function nextAttemptFor(db: ReturnType<typeof session.requireDb>, id: number): number {
  const invoice = getInvoice(db, id)
  const steps = chaseSchedule(getSettings(db)).length
  return Math.min(invoice.chaseStep + 1, Math.max(steps, 1))
}

/**
 * The single gate every call passes through.
 *
 * Enforced here rather than in the renderer for the obvious reason — a
 * disabled button is a suggestion, not a rule — and in one place rather than
 * per handler so that adding a channel cannot accidentally opt out of it.
 */
async function guard(channel: IpcChannel): Promise<void> {
  const gate = gateFor(channel)
  if (gate && !(await hasFeature(gate.feature))) {
    throw new Error(gate.message)
  }

  if (!allowedWhenReadOnly(channel) && (await isReadOnly())) {
    const { lapsedReason } = await authState()
    throw new Error(
      `${lapsedReason} SoloWrk is read-only until it is renewed — everything is still here, and can still be exported.`
    )
  }
}

export function registerIpcHandlers(getWindow: WindowGetter): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel]
    ipcMain.handle(channel, async (_event, payload: unknown) => {
      await guard(channel)
      return (handler as (g: WindowGetter, p: unknown) => unknown)(getWindow, payload)
    })
  }
}
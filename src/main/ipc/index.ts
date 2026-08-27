import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
import { activityFor, recentActivity } from '../services/activity'
import { findAcrossTypes, findEntities, labelFor } from '../services/entities'
import { deleteView, listViews, saveView, viewExists } from '../services/views'
import { setArchived } from '../services/archive'
import {
  deleteTag,
  ensureTag,
  listTags,
  recolourTag,
  renameTag,
  tag as tagEntity,
  taggedIds,
  tagsFor,
  untag
} from '../services/tags'
import {
  emptyTrash,
  listTrash,
  purgeTrash,
  restoreTrash,
  trashEntity
} from '../services/trash'
import { link, relatedTo, unlink } from '../services/links'
import { approveMail, cancelMail, getMail, listMail } from '../services/mailQueue'
import { drainOutbox } from '../services/chaseRun'
import {
  createRule,
  deleteRule,
  findSubjects,
  listRules,
  ruleHistory,
  updateRule
} from '../services/automations'
import { hasSmtpPassword, sendTestEmail, smtpConfigured, storeSmtpPassword } from '../services/mail'
import { suggestedWorkspacePath } from '../services/config'
import { inspectFolder, resolveInWorkspace } from '../services/workspace'
import {
  createClient,
  getClient,
  listClients,
  updateClient
} from '../services/clients'
import {
  createProject,
  getProject,
  listProjects,
  updateProject
} from '../services/projects'
import { createTask, listTasks, moveTask, updateTask } from '../services/tasks'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory
} from '../services/categories'
import { createNote, listNotes, readNote, writeNote } from '../services/notes'
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
  getInvoice,
  listInvoices,
  overdueInvoices,
  updateInvoice
} from '../services/invoices'
import {
  convertQuote,
  createQuote,
  getQuote,
  listQuotes,
  updateQuote
} from '../services/quotes'
import {
  createExpense,
  listExpenses,
  updateExpense
} from '../services/expenses'
import {
  clientProfitability,
  projectProfitability,
  series,
  summary,
  taxPosition,
  topClients
} from '../services/finance'
import { createBlock, getBlock, listBlocks, updateBlock, upcomingBlocks } from '../services/blocks'
import { getCalendarSettings, updateCalendarSettings } from '../services/calendarSettings'
import {
  adoptEstimate,
  derivedMarkers,
  scheduleTask,
  unscheduledTasks
} from '../services/scheduling'
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
import { logoFor, writeHtmlPdf, writePdf } from '../services/pdf'
import { buildStatement } from '../services/statements'
import { writeDatasetCsv } from '../services/exports'
import { buildYearEndPack } from '../services/yearEnd'
import { trends } from '../services/trends'
import { buildUpdatePack } from '../services/updatePack'
import { renderUpdatePack } from '../services/updatePackHtml'
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

/**
 * Remove workspace files a purge has finished with.
 *
 * Best effort and deliberately not awaited. The database row has already gone,
 * so a file that will not delete — open in an editor, on a Dropbox folder
 * mid-sync — is litter rather than a failure, and refusing to empty somebody's
 * trash over it would be the worse outcome.
 */
function removeFiles(files: string[]): void {
  if (files.length === 0) return
  const workspacePath = session.requirePath()
  for (const file of files) {
    void rm(resolveInWorkspace(workspacePath, file), { force: true }).catch((error) => {
      console.error('Could not remove', file, error)
    })
  }
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
  'clients:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'client', id })
  },

  'clients:updatePack': async (_g, { clientId, format, since }) => {
    const db = session.requireDb()
    const workspacePath = session.requirePath()
    const settings = getSettings(db)

    const pack = buildUpdatePack(db, clientId, { since })
    const html = renderUpdatePack(pack, settings, await logoFor(workspacePath, settings.logoFile))

    // Filed under the client's own folder rather than a central Exports pile:
    // this is a document about them, and it belongs with the rest of their
    // paperwork where somebody would go looking for it.
    const client = getClient(db, clientId)
    const folder = join(client.folder, 'Updates')
    const name = `Update ${pack.asOf}`

    if (format === 'pdf') return writeHtmlPdf(workspacePath, html, folder, name)

    await mkdir(resolveInWorkspace(workspacePath, folder), { recursive: true })
    const relative = join(folder, `${name}.html`)
    await writeFile(resolveInWorkspace(workspacePath, relative), html, 'utf8')
    return relative
  },

  'projects:list': (_g, args) => listProjects(session.requireDb(), args ?? {}),
  'projects:get': (_g, { id }) => getProject(session.requireDb(), id),
  'projects:create': (_g, input) =>
    createProject(session.requireDb(), session.requirePath(), input),
  'projects:update': (_g, { id, patch }) =>
    updateProject(session.requireDb(), session.requirePath(), id, patch),
  'projects:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'project', id })
  },
  'projects:reveal': (_g, { id }) => {
    const project = getProject(session.requireDb(), id)
    void shell.openPath(resolveInWorkspace(session.requirePath(), project.folder))
  },

  'tasks:list': (_g, filter) => listTasks(session.requireDb(), filter ?? {}),
  'tasks:create': (_g, input) => createTask(session.requireDb(), input),
  'tasks:update': (_g, { id, patch }) => updateTask(session.requireDb(), id, patch),
  'tasks:move': (_g, { id, status, projectId, beforeId }) =>
    moveTask(session.requireDb(), id, { status, projectId, beforeId }),
  'tasks:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'task', id })
  },

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
  // The .md stays on disk until the trash entry is purged, or a restore
  // would hand back a note whose body had already been deleted.
  'notes:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'note', id })
  },

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
  'documents:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'document', id })
  },
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
  'invoices:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'invoice', id })
  },
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

  /**
   * A receipt is the invoice, restated as settled. It deliberately does not
   * overwrite `pdf_path`: the invoice PDF is the record of what was asked for,
   * and replacing it with the receipt would lose that.
   */
  'invoices:receipt': async (_g, { id }) => {
    const db = session.requireDb()
    const invoice = getInvoice(db, id)
    if (invoice.paidAt === null) {
      throw new Error(
        `${invoice.number} is not marked as paid yet. Mark it paid and the receipt will have a date to put on it.`
      )
    }

    const client = invoice.clientId ? getClient(db, invoice.clientId) : null

    return writePdf(
      session.requirePath(),
      {
        kind: 'receipt',
        number: `${invoice.number} receipt`,
        // The invoice's own date, so the receipt references the document it
        // settles and files itself in the same year folder beside it.
        issueDate: invoice.issueDate,
        secondaryDate: invoice.paidAt,
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
  },

  'invoices:chaser': (_g, { id, attempt }) => {
    const db = session.requireDb()
    // Without an explicit attempt, this is the button being pressed by hand:
    // draft the next note actually due rather than always the gentlest one.
    const next = attempt ?? nextAttemptFor(db, id)
    return draftChaser(db, id, next)
  },

  'chasing:due': () => dueChasers(session.requireDb()),

  'chasing:record': (_g, { id, attempt }) => {
    markChased(session.requireDb(), id, attempt)
  },

  'chasing:stop': (_g, { id }) => {
    stopChasing(session.requireDb(), id)
  },

  'chasing:outbox': () => listMail(session.requireDb()),

  /**
   * The press that sends.
   *
   * Approve then drain, in that order and in one call, so the message is
   * durably marked as decided before anything is attempted. If the send fails
   * the row stays queued and retries on its own; if the app dies between the
   * two, the next launch picks it up. The reverse order could send a message
   * the database never recorded as approved.
   */
  'chasing:send': async (_g, { id }) => {
    const db = session.requireDb()
    const mail = approveMail(db, id)
    await drainOutbox(db)
    return getMail(db, mail.id)
  },

  'chasing:discard': (_g, { id }) => cancelMail(session.requireDb(), id),

  'chasing:sendQueued': () => drainOutbox(session.requireDb()),

  'tags:list': () => listTags(session.requireDb()),

  'tags:for': (_g, ref) => tagsFor(session.requireDb(), ref),

  'tags:add': (_g, { type, id, name }) => {
    const db = session.requireDb()
    return db.transaction(() => {
      const made = ensureTag(db, name)
      tagEntity(db, { type, id }, made.id)
      return made
    })
  },

  'tags:remove': (_g, { type, id, tagId }) => {
    untag(session.requireDb(), { type, id }, tagId)
  },

  'tags:rename': (_g, { id, name }) => renameTag(session.requireDb(), id, name),

  'tags:recolour': (_g, { id, colour }) => {
    recolourTag(session.requireDb(), id, colour)
  },

  'tags:delete': (_g, { id }) => {
    deleteTag(session.requireDb(), id)
  },

  'tags:matching': (_g, { type, tagIds }) => taggedIds(session.requireDb(), type, tagIds),

  'trash:list': () => listTrash(session.requireDb()),

  'trash:restore': (_g, { id }) => restoreTrash(session.requireDb(), id),

  'trash:purge': (_g, { id }) => {
    removeFiles(purgeTrash(session.requireDb(), id))
  },

  'trash:empty': () => {
    const { count, files } = emptyTrash(session.requireDb())
    removeFiles(files)
    return { count }
  },

  'entity:archive': (_g, { type, id, archived }) => {
    setArchived(session.requireDb(), { type, id }, archived)
  },

  'entity:delete': (_g, ref) => trashEntity(session.requireDb(), ref),

  'views:list': (_g, { page }) => listViews(session.requireDb(), page),

  'views:save': (_g, { page, name, query }) => saveView(session.requireDb(), page, name, query),

  'views:delete': (_g, { id }) => {
    deleteView(session.requireDb(), id)
  },

  'views:taken': (_g, { page, name }) => viewExists(session.requireDb(), page, name),

  'entity:label': (_g, ref) => labelFor(session.requireDb(), ref),

  'entity:find': (_g, { type, query }) =>
    type
      ? findEntities(session.requireDb(), type, query)
      : findAcrossTypes(session.requireDb(), query),

  'links:related': (_g, ref) => relatedTo(session.requireDb(), ref),

  'links:create': (_g, { a, b }) => {
    link(session.requireDb(), a, b)
  },

  'links:remove': (_g, { a, b }) => {
    unlink(session.requireDb(), a, b)
  },

  'activity:for': (_g, { type, id, limit }) =>
    activityFor(session.requireDb(), { type, id }, limit),

  'activity:recent': (_g, input) => recentActivity(session.requireDb(), input?.limit),

  'automations:list': () => listRules(session.requireDb()),

  'automations:create': (_g, input) => createRule(session.requireDb(), input),

  'automations:update': (_g, { id, patch }) => updateRule(session.requireDb(), id, patch),

  'automations:delete': (_g, { id }) => {
    deleteRule(session.requireDb(), id)
  },

  'automations:history': (_g, { id }) => ruleHistory(session.requireDb(), id),

  'automations:preview': (_g, rule) => findSubjects(session.requireDb(), rule),

  'mail:status': async () => {
    const db = session.requireDb()
    const hasPassword = await hasSmtpPassword()
    return { configured: smtpConfigured(getSettings(db), hasPassword), hasPassword }
  },

  'mail:password': (_g, { password }) => storeSmtpPassword(password),

  'mail:test': () => sendTestEmail(getSettings(session.requireDb())),

  'chasing:statement': async (_g, { clientId, from }) => {
    const db = session.requireDb()
    return writePdf(
      session.requirePath(),
      buildStatement(db, clientId, { from }),
      getSettings(db)
    )
  },

  'finance:tax': () => taxPosition(session.requireDb()),

  'finance:clientRates': () => clientProfitability(session.requireDb()),

  'dashboard:trends': () => trends(session.requireDb()),

  'export:csv': (_g, { dataset, from, to }) =>
    writeDatasetCsv(session.requireDb(), session.requirePath(), dataset, { from, to }),

  'yearEnd:pack': (_g, { startYear }) =>
    buildYearEndPack(session.requireDb(), session.requirePath(), startYear),

  'quotes:list': (_g, filter) => listQuotes(session.requireDb(), filter ?? {}),
  'quotes:get': (_g, { id }) => getQuote(session.requireDb(), id),
  'quotes:create': (_g, input) => createQuote(session.requireDb(), input),
  'quotes:update': (_g, { id, patch }) => updateQuote(session.requireDb(), id, patch),
  'quotes:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'quote', id })
  },

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
  'expenses:delete': (_g, { id }) => {
    trashEntity(session.requireDb(), { type: 'expense', id })
  },

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

  'calendar:blocks': (_g, range) => listBlocks(session.requireDb(), range),

  'calendar:block': (_g, { id }) => getBlock(session.requireDb(), id),

  'calendar:createBlock': (_g, input) => createBlock(session.requireDb(), input),

  'calendar:updateBlock': (_g, { id, patch }) => updateBlock(session.requireDb(), id, patch),

  'calendar:upcoming': (_g, payload) =>
    upcomingBlocks(session.requireDb(), nowStamp(), payload?.limit ?? 5),

  'calendar:settings': () => getCalendarSettings(session.requireDb()),

  'calendar:updateSettings': (_g, patch) => updateCalendarSettings(session.requireDb(), patch),

  'calendar:markers': (_g, range) => derivedMarkers(session.requireDb(), range),

  'calendar:unscheduled': (_g, filter) => unscheduledTasks(session.requireDb(), filter ?? {}),

  'calendar:scheduleTask': (_g, input) => scheduleTask(session.requireDb(), input),

  'calendar:adoptEstimate': (_g, { blockId }) => adoptEstimate(session.requireDb(), blockId),

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
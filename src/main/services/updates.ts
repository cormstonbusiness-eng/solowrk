import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'

/**
 * Keeping the installed app up to date.
 *
 * Updates come from the project's GitHub releases. The repository is public, so
 * the app carries no credentials — it reads the release feed anonymously, the
 * same way any download works.
 *
 * The shape of this is deliberate. It **downloads** in the background but never
 * **installs** on its own: an app that restarts itself while you are mid-sentence
 * in an invoice is worse than one that is a version behind. The install happens
 * when you say so, or on the next quit.
 */

// electron-updater is CommonJS, and its named exports do not survive the ESM
// interop that the bundler applies. Reaching through the default export is the
// documented way to use it from an ESM main process.
const { autoUpdater } = electronUpdater

/** How often to look, once the first check has happened. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Long enough after launch that startup is not competing with a download. */
const FIRST_CHECK_DELAY_MS = 20_000

let state: UpdateState = { status: 'idle', version: '', notes: '', percent: 0, error: '' }
let timer: NodeJS.Timeout | null = null
let getWindow: (() => BrowserWindow | null) | null = null

function publish(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  getWindow?.()?.webContents.send('updates:state', state)
}

export function updateState(): UpdateState {
  return state
}

/**
 * Wire up the updater and start checking.
 *
 * Silently does nothing when the app is not packaged. In development the
 * version is whatever package.json says and there is no installer to replace,
 * so a check would either fail or — worse — succeed and try to update a
 * checkout.
 */
export function startUpdates(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  if (!app.isPackaged) {
    publish({ status: 'unsupported' })
    return
  }

  // Downloaded ahead of time so "Restart and update" is instant rather than a
  // progress bar you have to sit and watch.
  autoUpdater.autoDownload = true
  // Never on quit without asking. `quitAndInstall` is called explicitly, so
  // closing the app is never silently also a software update.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking', error: '' }))

  autoUpdater.on('update-available', (info) =>
    publish({
      status: 'downloading',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      percent: 0
    })
  )

  autoUpdater.on('update-not-available', () => publish({ status: 'current', percent: 0 }))

  autoUpdater.on('download-progress', (progress) =>
    publish({ status: 'downloading', percent: Math.round(progress.percent) })
  )

  autoUpdater.on('update-downloaded', (info) =>
    publish({ status: 'ready', version: info.version, percent: 100 })
  )

  autoUpdater.on('error', (error: Error) => {
    // Being offline is the common case and is not worth alarming anyone about,
    // so it is recorded but the status goes back to idle rather than to error.
    const offline = /net::|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(error.message)
    publish({
      status: offline ? 'idle' : 'error',
      error: offline ? '' : error.message,
      percent: 0
    })
  })

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
}

/** Ask now. Safe to call repeatedly; a check already running is left alone. */
export async function check(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  if (state.status === 'downloading' || state.status === 'checking') return state

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publish({
      status: 'error',
      error: error instanceof Error ? error.message : 'Could not check for updates.'
    })
  }

  return state
}

/**
 * Restart into the new version.
 *
 * Only reachable once a download has finished, so this is a restart rather
 * than a download-and-restart with an indeterminate wait in the middle.
 */
export function installNow(): void {
  if (state.status !== 'ready') return
  // isSilent false so the installer's own progress is visible; forceRunAfter
  // so the app comes back rather than leaving the user at a closed window.
  autoUpdater.quitAndInstall(false, true)
}

export function stopUpdates(): void {
  if (timer) clearInterval(timer)
  timer = null
}

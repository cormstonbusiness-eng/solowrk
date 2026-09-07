import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { session } from './session'
import { readConfig } from './config'
import { UPDATE_FEED } from '@shared/site'
import { push } from './notifications'

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

/**
 * Long enough after launch that startup is not competing with a download.
 *
 * Was twenty seconds, which was more caution than the situation needs. The
 * check itself is one small request for a manifest — it is the *download* that
 * costs anything, and that only begins once an update actually exists, by
 * which time the window has long since drawn.
 *
 * Five keeps the workspace opening and the first paint clear of it, and means
 * somebody who opens the app to a waiting update is told about it while they
 * are still looking at the window rather than a quarter of a minute later.
 */
const FIRST_CHECK_DELAY_MS = 5_000

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
 * A log file for the updater.
 *
 * electron-updater says nothing at all unless it is given a logger, which makes
 * a failed update on someone else's machine impossible to diagnose — you get
 * "it didn't update" and nothing more. `console.log` is no use here either: a
 * packaged Windows app has no console attached, so those lines go nowhere.
 *
 * So: a file in userData, next to the config, truncated at each launch so it
 * stays the story of the current session rather than growing forever.
 */
function fileLogger(): { info: (m: unknown) => void; warn: (m: unknown) => void; error: (m: unknown) => void; debug: () => void } {
  const path = join(app.getPath('userData'), 'updates.log')

  try {
    writeFileSync(path, `SoloWork ${app.getVersion()} — ${new Date().toISOString()}\n`)
  } catch {
    // A read-only userData is possible and is not worth failing over.
  }

  const write = (level: string, message: unknown): void => {
    try {
      appendFileSync(path, `${new Date().toISOString()} ${level} ${String(message)}\n`)
    } catch {
      // Logging must never be the thing that breaks updating.
    }
  }

  return {
    info: (message) => write('INFO ', message),
    warn: (message) => write('WARN ', message),
    error: (message) => write('ERROR', message),
    debug: () => {
      // Too chatty to keep — it logs every HTTP header of a 190 MB download.
    }
  }
}

/**
 * Tell the user, once, that a version is waiting.
 *
 * Goes through the app's own notification system rather than a bespoke banner:
 * it slides into the corner, survives being missed because it stays in the
 * list, and sits with everything else that wanted attention. The version is the
 * dedupe key, so the same update is mentioned once however many times the app
 * is reopened before it is installed.
 *
 * Skipped entirely when no workspace is open — notifications live in the
 * workspace database, and there is nowhere to put one during first-run setup.
 * The titlebar still shows the button, so nothing is lost.
 */
function announce(title: string, body: string, dedupeKey: string): void {
  if (!session.isOpen) return

  try {
    push(session.requireDb(), getWindow ?? (() => null), {
      kind: 'info',
      title,
      body,
      link: '/settings',
      dedupeKey
    })
  } catch {
    // A notification is a courtesy. Failing to file one must never stop the
    // update itself from being installable.
  }
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

  autoUpdater.logger = fileLogger()

  // Downloaded ahead of time so "Restart and update" is instant rather than a
  // progress bar you have to sit and watch.
  autoUpdater.autoDownload = true
  // Never on quit without asking. `quitAndInstall` is called explicitly, so
  // closing the app is never silently also a software update.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking', error: '' }))

  autoUpdater.on('update-available', (info) => {
    publish({
      status: 'downloading',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      percent: 0
    })

    /*
      Said when the update is found, not only when it has finished arriving.

      The titlebar has always shown a pill at this moment, but a pill is only
      seen by somebody already looking at the top of the window. The installer
      is 190 MB: on a slow connection the gap between finding an update and
      being able to install it is minutes, and staying silent for those minutes
      means the only announcement lands long after the app was opened — which
      is exactly when nobody is watching.

      Its own dedupe key, so this and the "ready" notification below are one
      each rather than one replacing the other. Two per version is the right
      number here: this one is news, and that one is a thing to do.
    */
    announce(
      `SoloWork ${info.version} is available`,
      'It is downloading now. Nothing installs on its own — you will be told when it is ready.',
      `update-found-${info.version}`
    )
  })

  autoUpdater.on('update-not-available', () => publish({ status: 'current', percent: 0 }))

  autoUpdater.on('download-progress', (progress) =>
    publish({ status: 'downloading', percent: Math.round(progress.percent) })
  )

  autoUpdater.on('update-downloaded', (info) => {
    publish({ status: 'ready', version: info.version, percent: 100 })
    announce(
      `SoloWork ${info.version} is ready`,
      'Restart when it suits you and the update applies. Nothing installs on its own.',
      `update-${info.version}`
    )
  })

  autoUpdater.on('error', (error: Error) => {
    // Being offline is the common case and is not worth alarming anyone about,
    // so it is recorded but the status goes back to idle rather than to error.
    const offline = /net::|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(error.message)

    /**
     * A licence that no longer receives updates (§3.5).
     *
     * The feed answers 204 with an empty body, which electron-updater reaches
     * as a parse failure rather than as an answer. It is reported as "current"
     * — which is true, as far as this installation is concerned — because the
     * perpetual fallback takes away updates and nothing else, and an error
     * banner would tell somebody their app was broken when it is working
     * exactly as they were promised.
     */
    const noUpdatesForYou = /HTTP 204|Cannot parse|ENOENT.*latest\.yml|status 204/i.test(
      error.message
    )

    publish({
      status: noUpdatesForYou ? 'current' : offline ? 'idle' : 'error',
      error: noUpdatesForYou || offline ? '' : error.message,
      percent: 0
    })
  })

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
}

/**
 * Point the updater at our own manifest, carrying the licence.
 *
 * §3.5's perpetual fallback needs the *server* to decide who still gets
 * updates: a lapsed subscription keeps every feature working forever and
 * stops receiving new versions. That decision cannot live in the client —
 * "do not disable features in the client" is the whole point — and it cannot
 * live in a static GitHub feed either, because static hosting cannot read a
 * licence.
 *
 * So the feed becomes a route we control, and the licence rides along as a
 * bearer token. The route serves the manifest or answers 204, and the
 * installer bytes themselves still come from GitHub via a redirect, which
 * keeps installer bandwidth off Vercel.
 */
async function aimFeed(): Promise<void> {
  const { licenceToken } = await readConfig()

  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED })

  // Cleared rather than left stale when there is no licence: a signed-out
  // machine asking with somebody else's old token would be given their answer.
  autoUpdater.requestHeaders = licenceToken
    ? { Authorization: `Bearer ${licenceToken}` }
    : {}
}

/** Ask now. Safe to call repeatedly; a check already running is left alone. */
export async function check(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  if (state.status === 'downloading' || state.status === 'checking') return state

  try {
    await aimFeed()
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

  /*
    Silent, and back on its own.

    `isSilent` was false, which meant every update walked the person through the
    same NSIS wizard they saw when they first installed — Next, install
    location, Finish — for a version they had already agreed to install by
    pressing the button. Nobody reads that dialog the second time, and a routine
    update should not look like a decision.

    True passes `/S` to the installer, which reuses the location already in the
    registry rather than asking again. `forceRunAfter` brings the app back, so
    the whole thing is: window closes, a few seconds, window returns on the new
    version.

    Two conditions make this safe here, and both are set in
    `electron-builder.yml`. `perMachine: false` means a per-user install with no
    UAC prompt — a silent install that needs elevation would fail against a
    prompt nobody can see. And `oneClick: false` only decides what the *first*
    install looks like; `/S` still applies to an update over the top.

    What is given up is the installer's progress bar, which was the only sign
    anything was happening. The window is simply gone for those seconds. That is
    the right trade for something that takes a moment, and it is what every
    other desktop app does.
  */
  autoUpdater.quitAndInstall(true, true)
}

export function stopUpdates(): void {
  if (timer) clearInterval(timer)
  timer = null
}

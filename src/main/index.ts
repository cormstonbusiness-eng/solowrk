import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { broadcastWindowState } from './ipc/window'
import { session } from './services/session'

/** Matches `--ground` in the renderer theme so there is no white flash on launch. */
const GROUND = '#0A0A0B'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: GROUND,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Paint only once the renderer has something to show.
  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // Keep the custom titlebar's maximise/restore icon honest, including when the
  // user snaps or double-clicks the drag region rather than using our buttons.
  const sync = (): void => broadcastWindowState(window)
  window.on('maximize', sync)
  window.on('unmaximize', sync)
  window.on('focus', sync)
  window.on('blur', sync)

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(() => {
  // Must match `appId` in electron-builder.yml, or Windows treats the pinned
  // taskbar entry and the notifications as belonging to different apps.
  electronApp.setAppUserModelId('com.solowrk.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Handlers are registered once for the app's lifetime and resolve the current
  // window lazily, so re-creating the window never double-registers a channel.
  registerIpcHandlers(getMainWindow)

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Close the database cleanly so WAL is checkpointed rather than left for the
// next launch to recover.
app.on('before-quit', () => session.close())
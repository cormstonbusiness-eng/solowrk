import type { BrowserWindow } from 'electron'
import type { WindowState } from '@shared/ipc'

export function readWindowState(window: BrowserWindow | null): WindowState {
  return {
    isMaximized: window?.isMaximized() ?? false,
    isFocused: window?.isFocused() ?? false
  }
}

/**
 * Push the current chrome state to the renderer. Called on maximise, unmaximise,
 * focus and blur so the titlebar reflects OS-driven changes (snapping, Win+Up)
 * and not just clicks on our own buttons.
 */
export function broadcastWindowState(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  window.webContents.send('window:stateChanged', readWindowState(window))
}
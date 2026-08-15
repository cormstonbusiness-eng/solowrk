#!/usr/bin/env node
/**
 * Wrapper around the electron-vite CLI.
 *
 * Electron-based hosts (VS Code's integrated terminal, Claude Code, other
 * Electron dev tools) export ELECTRON_RUN_AS_NODE=1 into child processes. Any
 * Electron binary launched with it set silently runs as plain Node instead:
 * `require('electron')` then returns the path string rather than the module, so
 * `app` is undefined and the app dies on its first line. Clearing it here means
 * `npm run dev` works from any terminal.
 */
import { spawn } from 'node:child_process'
import process from 'node:process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('electron-vite', process.argv.slice(2), {
  stdio: 'inherit',
  shell: true,
  env
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
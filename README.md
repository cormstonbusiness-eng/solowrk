# Solo

Freelance project and business management for Windows, running entirely on your own PC. Projects,
tasks, clients, time, quotes, invoices, finance, documents and a calendar — with your files in a
real folder tree you own, not a cloud service.

## Running it

```powershell
npm install
npm run dev          # launch with hot reload
npm run typecheck    # main + renderer
npm run build        # production bundles into out/
npm run build:win    # NSIS installer into release/
```

> `npm run dev` goes through `scripts/electron-vite.mjs` rather than calling `electron-vite`
> directly. Electron-based terminals (VS Code, Claude Code) export `ELECTRON_RUN_AS_NODE=1`, which
> makes Electron start as plain Node and crash on `app` being undefined. The wrapper clears it.

## Layout

```
src/
  main/       Electron main process — window, IPC handlers, later: DB, files, AI, OAuth
  preload/    contextBridge exposing window.solo — the only renderer surface
  renderer/   React app
    src/components/   shell (TitleBar, Sidebar, Page) and ui/ primitives
    src/lib/          motion tokens, nav config, helpers
    src/pages/        one component per route
  shared/     types shared across the process boundary (IPC contract)
```

## Conventions worth keeping

- **IPC is declared once.** Add a channel to `IpcContract` in `src/shared/ipc.ts`; the handler map
  in `src/main/ipc/index.ts` is keyed by that type, so a missing implementation is a compile error
  and the preload allowlist refuses anything undeclared. The renderer never touches `fs` or the DB.
- **Animation comes from `src/renderer/src/lib/motion.ts`.** Durations and easing live there so the
  whole app shares one sense of timing. Reduced motion is handled once, by `<MotionConfig
  reducedMotion="user">` in `App.tsx`.
- **Colour comes from tokens** in `src/renderer/src/styles/theme.css`. The accent is reserved for
  primary actions, active navigation and focus rings — never decoration.
- **CSP** ships strict in `index.html`; the dev server loosens it for HMR only, in
  `electron.vite.config.ts`.

## Status

Phase 0 (shell, design system, animated routing) is complete. Later phases add the SQLite data
layer and first-run wizard, then clients/projects/tasks, files, money, calendar, dashboard, the
Claude assistant, and calendar sync. Sections not yet built say which phase builds them.
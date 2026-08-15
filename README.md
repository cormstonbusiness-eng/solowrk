# Solo

Freelance project and business management for Windows, running entirely on your own PC. Projects,
tasks, clients, time, quotes, invoices, finance, documents and a calendar — with your files in a
real folder tree you own, not a cloud service.

## Running it

```powershell
npm install
npm run dev          # launch with hot reload
npm test             # Vitest — business logic and path safety
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

## Data

SQLite comes from Electron's bundled Node (`node:sqlite`), not a native module, so there is nothing
to compile and `npm install` works on any machine. Queries are hand-written SQL behind a small
`Database` wrapper in `src/main/db/`.

- **Money is integer pence, never a float.** Percentages are basis points (2000 = 20%). Pounds only
  exist at the UI edge — see `MoneyInput`.
- **Migrations are append-only.** Add to the array in `src/main/db/migrations.ts`; never edit one
  that has shipped, because a user's database has already run it. Each phase adds its own.
- **The workspace is the unit of portability.** Everything lives inside the user's chosen folder,
  including the database. The only state outside it is a pointer file in `userData` recording where
  that folder is.
- **`resolveInWorkspace()` in `src/main/services/workspace.ts` is the containment boundary** for
  every file operation, including the AI's tools later. It is tested accordingly.

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

Phases 0 (shell, design system, animated routing), 1 (data layer, first-run wizard, settings),
2 (clients, projects, tasks, notes, templates) and 3 (files, documents) are complete. Later phases
add money, calendar, dashboard, the Claude assistant, and calendar sync. Sections not yet built
say which phase builds them.

### Gotchas worth knowing

- **Do not let `services/` modules import each other in a cycle.** `projects` imports `templates`,
  so anything both need (like `PROJECT_FOLDERS`) lives in `workspace`. A cycle survives typecheck
  *and* Vitest, then crashes the bundled main process on launch — always start the app after
  touching service imports.
- **Folder names go through `toFolderName()`.** Windows rejects `<>:"/\|?*`, reserved device names
  like `CON`, and trailing dots. Never build a path from a user string directly. Filenames use
  `uniqueFileName()` so de-duplication keeps the extension (`report 2.pdf`, not `report.pdf 2`).
- **`File.path` does not exist.** Electron removed it, so a file dragged from Explorer is resolved
  through `window.solo.pathForFile(file)`, backed by `webUtils` in the preload.
- **Deleting a file goes to the Recycle Bin** via `shell.trashItem`, never `unlink`.
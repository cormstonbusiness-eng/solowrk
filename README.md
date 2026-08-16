# SoloWrk

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
2 (clients, projects, tasks, notes, templates), 3 (files, documents), 4 (time, quotes,
invoices, expenses, finance), 5 (calendar), 6 (live dashboard, Ctrl+K palette) and 7 (the Claude
assistant) are complete. What remains is phase 8 (Google and Teams calendar sync, which needs
OAuth app registrations) and phase 9 (the installer).

The assistant runs the Claude Code installation already on the machine, through
`@anthropic-ai/claude-agent-sdk`, so it uses the user's own subscription and no API key is
stored anywhere. If Claude Code is missing or not logged in, the page says so and explains the
three steps rather than showing a chat box that silently fails.

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
- **All money arithmetic goes through `src/shared/money.ts`**, and all tax-year logic through
  `src/shared/taxYear.ts`. Both are shared by main and renderer so a total on screen is computed
  by the code that stores it. Never compute VAT or a line total inline.
- **Dates are `yyyy-mm-dd` strings, not `Date` objects.** Building a `Date` from one and reading
  it back in UTC can shift a payment across the 6 April tax-year boundary.
- **`Database.transaction` is re-entrant** (SAVEPOINT when nested), because services compose and
  SQLite has no nested `BEGIN`.
- **The assistant's permission gate reads `MUTATING` in `src/main/ai/tools.ts`, not the model's
  intent.** Add a tool that changes data and you must add its name there, or it will run
  unconfirmed. `Bash`, `Write`, `Edit`, `WebFetch` and `WebSearch` are disallowed outright — the
  workspace tools are the only way in, and they go through `resolveInWorkspace`.
- **`settingSources: []` keeps the assistant out of the user's own Claude config.** Without it,
  their CLAUDE.md files and permission rules would leak into the app's sessions.
- **The Agent SDK must be `asarUnpack`ed** in `electron-builder.yml`: it spawns a CLI, and a
  binary inside an asar archive cannot be executed.
- **`?new=1` is how one screen asks another to open its create modal.** The palette navigates to
  `/invoices?new=1`; the page picks it up with `useOpenParam`, which clears the parameter so a
  reload or a back-navigation cannot reopen it. Add it to any page that grows a create action.
- **The palette filters in the renderer, not in SQL.** A freelancer's workspace is hundreds of
  records; an index in main would be machinery with no payoff, and filtering here means results
  keep up with keystrokes. Revisit only if a list ever gets genuinely large.
- **Event times are local wall-clock stamps** (`yyyy-mm-ddThh:mm`), not UTC and not `Date`. A
  10:00 meeting stays at 10:00 across the clock change, and a range query is a string
  comparison. Phase 8's Google and Microsoft sync converts at that boundary and nowhere else.
  Range queries compare `substr(starts_at, 1, 10)`, because `'2026-08-19' >= '2026-08-19T23:00'`
  is false and would drop an evening event from its own day.
- **The product is SoloWrk; the internals are still `solo`.** `solo.db`, `solo.config.json` and
  `window.solo` keep the old spelling deliberately — renaming them would orphan every workspace
  and pointer file already on disk. Rename the *display* name freely; leave those three alone.
  `readConfig()` falls back to the pre-rename `%APPDATA%\solo` pointer for the same reason.
- **`setAppUserModelId` in `src/main/index.ts` must match `appId`** in `electron-builder.yml`.
- **Invoice `overdue` is derived, never stored** — see `displayStatus()` in `services/invoices.ts`.
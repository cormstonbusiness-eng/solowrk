/**
 * Comparing a project's folders against the template that made it.
 *
 * §13.2 says nothing else on the market does this, and it is right about why
 * it matters: in 3D and design work a folder structure is not tidiness, it is
 * *file paths*. A renamed `02-Assets` breaks every texture reference in a
 * scene, and the breakage shows up as pink checkerboards a week later on
 * somebody else's machine.
 *
 * **Repair only ever creates.** An unexpected folder is the user's work — a
 * `05-Client-Supplied` somebody added on purpose — and a "repair" that deleted
 * it would be catastrophic and unrecoverable. So unexpected folders are
 * reported and never touched, and the word "repair" means "put back what is
 * missing", which is the only half of the job that is safe to automate.
 */

export type FolderState = 'present' | 'missing' | 'unexpected'

export interface FolderCheck {
  /** Relative to the project folder, with forward slashes. */
  path: string
  state: FolderState
}

export interface StructureReport {
  checks: FolderCheck[]
  missing: string[]
  unexpected: string[]
  /** Nothing missing. Unexpected folders alone do not make a project broken. */
  healthy: boolean
  /** 0–100, for a bar. 100 when the template asks for nothing. */
  score: number
}

/**
 * Folders the app owns, which are never "unexpected" and never reported.
 *
 * `_notes` is created by the notes module whether a template mentions it or
 * not, and flagging the app's own bookkeeping as an anomaly would train people
 * to ignore the report — which is the one thing a warning must not do.
 */
const APP_OWNED = new Set(['_notes', '.solowrk'])

/** Hidden and OS folders nobody wants listed. */
function ignored(name: string): boolean {
  return name.startsWith('.') || name === '$RECYCLE.BIN' || name === 'System Volume Information'
}

/**
 * Windows paths are case-insensitive, so `02-assets` and `02-Assets` are the
 * same folder. Comparing case-sensitively would report a folder as both
 * missing and unexpected at once, which reads as a bug.
 */
function key(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
}

function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * Compare what a template asks for against what is on disk.
 *
 * Both lists are folder paths relative to the project root. Nested paths work:
 * a template asking for `02-Assets/Textures` reports that path missing even
 * when `02-Assets` itself is there.
 */
export function checkStructure(
  expected: readonly string[],
  actual: readonly string[]
): StructureReport {
  const wanted = new Map<string, string>()
  for (const path of expected) {
    const clean = normalise(path)
    if (clean === '' || APP_OWNED.has(clean)) continue
    wanted.set(key(clean), clean)
  }

  const found = new Map<string, string>()
  for (const path of actual) {
    const clean = normalise(path)
    if (clean === '') continue
    const [first] = clean.split('/')
    if (ignored(first!) || APP_OWNED.has(clean)) continue
    found.set(key(clean), clean)
  }

  const checks: FolderCheck[] = []

  for (const [id, path] of wanted) {
    checks.push({ path, state: found.has(id) ? 'present' : 'missing' })
  }

  for (const [id, path] of found) {
    if (wanted.has(id)) continue
    /**
     * A folder inside one the template asked for is the work itself, not a
     * deviation. A template names `02-Assets`; everything under it is
     * whatever the job needed, and listing all of it would bury the one
     * genuine finding.
     */
    const insideAnExpected = [...wanted.keys()].some((one) => id.startsWith(`${one}/`))
    if (insideAnExpected) continue

    checks.push({ path, state: 'unexpected' })
  }

  const missing = checks.filter((one) => one.state === 'missing').map((one) => one.path)
  const unexpected = checks.filter((one) => one.state === 'unexpected').map((one) => one.path)

  return {
    checks: checks.sort((a, b) => a.path.localeCompare(b.path)),
    missing,
    unexpected,
    // Unexpected folders alone do not make a project broken; missing ones do.
    healthy: missing.length === 0,
    score:
      wanted.size === 0 ? 100 : Math.round(((wanted.size - missing.length) / wanted.size) * 100)
  }
}

/* ------------------------------------------------------------------ *
 * Bulk rename
 * ------------------------------------------------------------------ */

/**
 * The naming convention, as §13.2 writes it: `{client}_{project}_{ref}_{date}`.
 *
 * Tokens resolve from the file's own project and client, plus a running index
 * so a set of files gets `_001`, `_002`. Anything unrecognised is left standing
 * rather than blanked — the same rule as merge fields, for the same reason:
 * a filename with a gap where the client should be is one nobody notices.
 */
export interface RenameToken {
  key: string
  label: string
}

export const RENAME_TOKENS: RenameToken[] = [
  { key: 'client', label: 'Client name' },
  { key: 'project', label: 'Project name' },
  { key: 'ref', label: 'Running number' },
  { key: 'date', label: "Today's date" },
  { key: 'name', label: 'Existing file name' },
  { key: 'ext', label: 'File extension' }
]

/**
 * Characters Windows will not accept in a filename.
 *
 * Only the genuinely illegal ones. Spaces and hyphens are legal and ordinary,
 * and a client called "Northgate Studio" should not come out as
 * "NorthgateStudio" — that is the app being opinionated about somebody's
 * naming rather than keeping their files openable.
 */
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g

export function safeName(value: string): string {
  return (
    value
      .replace(ILLEGAL, '')
      // Removing a character often leaves two spaces where there was one.
      .replace(/\s+/g, ' ')
      // A trailing dot or space is legal to write and impossible to delete.
      .replace(/[. ]+$/, '')
      .trim()
  )
}

export interface RenamePreview {
  from: string
  to: string
  /** Set when this rename cannot be done, and why. */
  problem: string | null
}

/**
 * Work out every new name before touching anything.
 *
 * Previewed rather than applied, because a bulk rename is the single most
 * destructive-feeling thing in this app: it changes two hundred filenames at
 * once and no one remembers what they were. Collisions are found here, where
 * they are a warning, rather than on disk where they are a lost file.
 */
export function previewRename(
  files: readonly { name: string }[],
  pattern: string,
  context: { client?: string; project?: string; date?: string }
): RenamePreview[] {
  const taken = new Set<string>()
  const previews: RenamePreview[] = []

  files.forEach((file, index) => {
    const dot = file.name.lastIndexOf('.')
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name
    const extension = dot > 0 ? file.name.slice(dot + 1) : ''

    const values: Record<string, string> = {
      client: context.client ?? '',
      project: context.project ?? '',
      ref: String(index + 1).padStart(3, '0'),
      date: context.date ?? '',
      name: stem,
      ext: extension
    }

    let problem: string | null = null

    const replaced = pattern.replace(/\{(\w+)\}/g, (whole, token: string) => {
      const value = values[token]
      if (value === undefined) {
        problem = `There is no {${token}} token.`
        return whole
      }
      if (value === '') {
        problem = `{${token}} has no value for this file.`
        return whole
      }
      return safeName(value)
    })

    // The extension is kept whether the pattern mentions it or not: a rename
    // that silently drops `.exr` produces a file Windows cannot open.
    const to =
      extension !== '' && !/\{ext\}/.test(pattern) ? `${replaced}.${extension}` : replaced

    if (safeName(to) === '') problem = problem ?? 'That leaves an empty name.'
    if (taken.has(to.toLowerCase())) problem = problem ?? 'Two files would end up with this name.'
    taken.add(to.toLowerCase())

    previews.push({ from: file.name, to, problem })
  })

  return previews
}

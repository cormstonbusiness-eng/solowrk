/**
 * Turning user-entered names into folder names Windows will actually accept.
 *
 * Getting this wrong is not cosmetic: a client called "Smith/Jones Ltd" or
 * "CON" would fail to create a folder, or create one in the wrong place. Every
 * rule below exists because Windows enforces it.
 */

/**
 * Characters Windows forbids in a file or folder name.
 *
 * The hyphen is escaped deliberately: written as `* -` the class would be read
 * as the range from `*` to `-`, silently swallowing commas and plus signs too.
 */
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f\-]/g

/**
 * Device names reserved by Windows, with or without an extension. A folder
 * called NUL cannot be created even today.
 */
const RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
])

/** Windows silently strips trailing dots and spaces, which breaks path matching. */
const TRAILING = /[. ]+$/

const MAX_LENGTH = 80

export function toFolderName(input: string): string {
  let name = input.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()

  name = name.slice(0, MAX_LENGTH).replace(TRAILING, '').trim()

  // Reserved names are only reserved as the whole name, so a suffix frees them.
  if (RESERVED.has(name.toUpperCase())) name = `${name}_`
  if (name.length === 0) name = 'Untitled'

  return name
}

/**
 * Split "report.final.pdf" into ["report.final", ".pdf"]. A leading dot means a
 * dotfile, not an extension, so ".gitignore" keeps its whole name.
 */
export function splitExtension(fileName: string): [string, string] {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return [fileName, '']
  return [fileName.slice(0, dot), fileName.slice(dot)]
}

/**
 * Free filename in a folder, keeping the extension intact — "report.pdf"
 * becomes "report 2.pdf" rather than "report.pdf 2", which would break the
 * file's association with its application.
 */
export function uniqueFileName(desired: string, taken: Iterable<string>): string {
  const existing = new Set(Array.from(taken, (name) => name.toLowerCase()))
  const [rawStem, extension] = splitExtension(desired)
  const stem = toFolderName(rawStem)

  if (!existing.has(`${stem}${extension}`.toLowerCase())) return `${stem}${extension}`

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem} ${suffix}${extension}`
    if (!existing.has(candidate.toLowerCase())) return candidate
  }

  return `${stem} ${Date.now()}${extension}`
}

/**
 * Append a numeric suffix until the name is free, so two clients called "Acme"
 * get "Acme" and "Acme 2" instead of sharing a folder.
 */
export function uniqueFolderName(desired: string, taken: Iterable<string>): string {
  const existing = new Set(Array.from(taken, (name) => name.toLowerCase()))
  const base = toFolderName(desired)

  if (!existing.has(base.toLowerCase())) return base

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = toFolderName(`${base} ${suffix}`)
    if (!existing.has(candidate.toLowerCase())) return candidate
  }

  return toFolderName(`${base} ${Date.now()}`)
}

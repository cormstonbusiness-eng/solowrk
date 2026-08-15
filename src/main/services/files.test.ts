import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// files.ts reaches for Electron's shell for open/reveal/trash. Those are OS
// calls with no logic of ours to test, so they are stubbed; everything else
// here touches a real temp directory.
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn()
  }
}))

const { createFolder, importFiles, listDirectory, renameEntry, trashEntry } = await import('./files')
const { scaffoldWorkspace } = await import('./workspace')

describe('files service', () => {
  let root: string
  let source: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-files-'))
    source = await mkdtemp(join(tmpdir(), 'solo-src-'))
    await scaffoldWorkspace(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  })

  it('lists the workspace with folders before files, alphabetically', async () => {
    await writeFile(join(root, 'zeta.txt'), 'z')
    await writeFile(join(root, 'alpha.txt'), 'a')

    const entries = await listDirectory(root, '')
    const names = entries.map((entry) => entry.name)

    // Clients, Documents, Expenses, Invoices, Quotes, Templates, then files.
    expect(names.indexOf('Clients')).toBeLessThan(names.indexOf('alpha.txt'))
    expect(names.indexOf('alpha.txt')).toBeLessThan(names.indexOf('zeta.txt'))
  })

  it('hides the _app folder from the browser', async () => {
    const entries = await listDirectory(root, '')
    expect(entries.some((entry) => entry.name === '_app')).toBe(false)
  })

  it('shows sizes and types for files', async () => {
    await writeFile(join(root, 'brief.PDF'), 'hello')
    const entry = (await listDirectory(root, '')).find((e) => e.name === 'brief.PDF')

    expect(entry?.isDirectory).toBe(false)
    expect(entry?.size).toBe(5)
    expect(entry?.extension).toBe('pdf')
  })

  it('refuses to list outside the workspace', async () => {
    await expect(listDirectory(root, '..')).rejects.toThrow(/escapes the workspace/)
    await expect(listDirectory(root, 'C:\\Windows')).rejects.toThrow(/Absolute paths/)
  })

  it('copies imported files in, leaving the original alone', async () => {
    const original = join(source, 'contract.pdf')
    await writeFile(original, 'contents')

    const imported = await importFiles(root, 'Documents', [original])

    expect(imported).toEqual([join('Documents', 'contract.pdf')])
    expect(await readFile(join(root, 'Documents', 'contract.pdf'), 'utf8')).toBe('contents')
    // Still where the user had it.
    expect(await readFile(original, 'utf8')).toBe('contents')
  })

  it('de-duplicates names within a single import', async () => {
    // Two different files that happen to share a name — the second must not
    // silently overwrite the first.
    const a = join(source, 'a', 'report.pdf')
    const b = join(source, 'b', 'report.pdf')
    await mkdir(join(source, 'a'), { recursive: true })
    await mkdir(join(source, 'b'), { recursive: true })
    await writeFile(a, 'first')
    await writeFile(b, 'second')

    const imported = await importFiles(root, 'Documents', [a, b])

    expect(imported).toHaveLength(2)
    expect(new Set(imported).size).toBe(2)
    const files = await readdir(join(root, 'Documents'))
    expect(files).toContain('report.pdf')
    expect(files).toContain('report 2.pdf')
  })

  it('de-duplicates against files already in the folder', async () => {
    await writeFile(join(root, 'Documents', 'note.txt'), 'existing')
    const incoming = join(source, 'note.txt')
    await writeFile(incoming, 'incoming')

    await importFiles(root, 'Documents', [incoming])

    expect(await readFile(join(root, 'Documents', 'note.txt'), 'utf8')).toBe('existing')
    expect(await readFile(join(root, 'Documents', 'note 2.txt'), 'utf8')).toBe('incoming')
  })

  it('creates folders with legal names', async () => {
    const created = await createFolder(root, '', 'Q1: Planning')
    expect(created).toBe('Q1 Planning')

    const again = await createFolder(root, '', 'Q1: Planning')
    expect(again).toBe('Q1 Planning 2')
  })

  it('renames a file while keeping its extension', async () => {
    await writeFile(join(root, 'Documents', 'old.pdf'), 'x')
    const next = await renameEntry(root, join('Documents', 'old.pdf'), 'new.pdf')
    expect(next).toBe(join('Documents', 'new.pdf'))
  })

  it('refuses to delete the workspace root', async () => {
    await expect(trashEntry(root, '')).rejects.toThrow(/workspace root/)
  })

  it('refuses to rename or create outside the workspace', async () => {
    await expect(renameEntry(root, '..\\escape.txt', 'x.txt')).rejects.toThrow()
    await expect(createFolder(root, '..', 'evil')).rejects.toThrow(/escapes the workspace/)
  })
})

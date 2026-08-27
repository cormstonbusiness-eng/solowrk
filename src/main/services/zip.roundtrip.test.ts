import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipEntries } from './zip'

const run = promisify(execFile)

/**
 * The archive, opened by something that is not us.
 *
 * `zip.test.ts` proves the writer is self-consistent, which a broken writer
 * and a matching broken reader would also be. This hands the bytes to
 * Windows' own unpacker: if `Expand-Archive` reads it, so will the accountant.
 *
 * Skipped off Windows, where there is nothing to check against.
 */

const onWindows = process.platform === 'win32'

describe.skipIf(!onWindows)('an archive Windows will open', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-zip-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('unpacks with the right files and the right bytes in them', async () => {
    const photograph = Buffer.from(Array.from({ length: 3_000 }, (_, index) => (index * 7) % 256))
    const summary = 'Date,Amount\n2026-04-01,1500.00\n'

    const archive = join(root, 'pack.zip')
    await writeFile(
      archive,
      zipEntries([
        { name: 'Summary.csv', data: Buffer.from(summary, 'utf8') },
        { name: 'Receipts/2026/04/till.jpg', data: photograph },
        { name: 'Notes.txt', data: Buffer.from('the same line\n'.repeat(200), 'utf8') }
      ])
    )

    const out = join(root, 'out')
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive', '-LiteralPath', archive, '-DestinationPath', out],
      { timeout: 60_000, windowsHide: true }
    )

    // The text came back as text.
    expect(await readFile(join(out, 'Summary.csv'), 'utf8')).toBe(summary)

    // The folder is a folder, not a file with a slash in its name.
    const image = await readFile(join(out, 'Receipts', '2026', '04', 'till.jpg'))
    expect(image.equals(photograph)).toBe(true)

    // And the deflated one inflated to exactly what went in.
    expect(await readFile(join(out, 'Notes.txt'), 'utf8')).toBe('the same line\n'.repeat(200))
  }, 90_000)
})

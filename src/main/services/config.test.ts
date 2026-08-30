import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

/**
 * The real filesystem, kept so the retry wrapper can be tested against a
 * `rename` that genuinely fails rather than one that is entirely fictional.
 */
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

const rename = vi.fn(actual.rename)

vi.mock('node:fs/promises', async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...real, rename: (...args: Parameters<typeof real.rename>) => rename(...args) }
})

const { readConfig, writeConfig } = await import('./config')

/**
 * The pointer file, and the one way writing it goes wrong on Windows.
 *
 * `rename` is atomic on NTFS, which is why the write goes through a temporary
 * file at all — but atomic is not the same as always permitted. Anything
 * holding a handle to either path makes it fail with EPERM, and on a normal
 * Windows machine something usually is: Defender scans a file the moment it
 * appears, and OneDrive and Search Indexer both watch these folders.
 *
 * That matters more than it sounds. This file holds the workspace path and
 * the licence, so a lost write signs somebody out and drops them to Free.
 */

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'solo-config-'))
  rename.mockClear()
  rename.mockImplementation(actual.rename)
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

/** An error shaped the way Node reports a Windows file-locking collision. */
function locked(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: operation not permitted, rename`)
  error.code = code
  return error
}

describe('writing the config', () => {
  it('round-trips what it was given', async () => {
    await writeConfig({ ...(await readConfig()), workspacePath: 'C:\\Somewhere' })
    expect((await readConfig()).workspacePath).toBe('C:\\Somewhere')
  })

  it('gets past a file lock that clears', async () => {
    // Two collisions then success — a scanner holding the file for a few
    // milliseconds, which is the case this exists for.
    let attempts = 0
    rename.mockImplementation((from, to) => {
      attempts += 1
      if (attempts <= 2) return Promise.reject(locked('EPERM'))
      return actual.rename(from, to)
    })

    await writeConfig({ ...(await readConfig()), workspacePath: 'C:\\Held' })

    expect(attempts).toBe(3)
    expect((await readConfig()).workspacePath).toBe('C:\\Held')
  })

  it('treats the other lock codes the same way', async () => {
    for (const code of ['EBUSY', 'EACCES']) {
      let first = true
      rename.mockImplementation((from, to) => {
        if (first) {
          first = false
          return Promise.reject(locked(code))
        }
        return actual.rename(from, to)
      })

      await writeConfig({ ...(await readConfig()), workspacePath: `C:\\${code}` })
      expect((await readConfig()).workspacePath).toBe(`C:\\${code}`)
    }
  })

  it('gives up rather than retrying forever', async () => {
    // A lock that never clears has to surface. Silently returning would be
    // worse than throwing: the caller would believe the licence was saved.
    rename.mockImplementation(() => Promise.reject(locked('EPERM')))

    await expect(writeConfig(await readConfig())).rejects.toThrow(/EPERM/)
  })

  it('does not retry a failure that retrying cannot fix', async () => {
    // A full disk or a read-only volume is not going to get better, and
    // sitting in a retry loop over it would just delay the error.
    const fatal: NodeJS.ErrnoException = new Error('ENOSPC: no space left on device')
    fatal.code = 'ENOSPC'
    rename.mockImplementation(() => Promise.reject(fatal))

    await expect(writeConfig(await readConfig())).rejects.toThrow(/ENOSPC/)
    expect(rename).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

const { readConfig, updateConfig } = await import('./config')
const { digestFor, fingerprint, resetFingerprintCache, usableSerial } = await import(
  './fingerprint'
)

/**
 * Which computer this is.
 *
 * The reading itself is one PowerShell call and is not worth mocking a shell
 * to prove. What is worth proving is everything around it: that junk serials
 * are refused, that two machines cannot collide, and that the answer is the
 * same tomorrow — because an unstable fingerprint silently burns a customer's
 * seat every time they launch the app.
 */

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'solo-fp-'))
  resetFingerprintCache()
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

describe('what the hardware admits to', () => {
  it('refuses the strings that mean nothing', () => {
    // Every one of these is reported by real consumer hardware. Craig's own
    // machine says "Default string". Treating it as a serial would give every
    // machine in a VM fleet the same fingerprint and collapse them onto one
    // seat, which is worse than having no fingerprint at all.
    for (const junk of [
      '',
      '  ',
      '0',
      'None',
      'Default string',
      'To be filled by O.E.M.',
      'System Serial Number',
      'not specified'
    ]) {
      expect(usableSerial(junk)).toBe('')
    }
  })

  it('keeps a real one, trimmed', () => {
    expect(usableSerial('  PF2M4T9K ')).toBe('PF2M4T9K')
  })
})

describe('the digest', () => {
  it('is stable for the same machine', () => {
    expect(digestFor('BOARD1', 'GUID1', 'x')).toBe(digestFor('BOARD1', 'GUID1', 'x'))
  })

  it('differs between machines', () => {
    expect(digestFor('BOARD1', 'GUID1', 'x')).not.toBe(digestFor('BOARD2', 'GUID1', 'x'))
    expect(digestFor('BOARD1', 'GUID1', 'x')).not.toBe(digestFor('BOARD1', 'GUID2', 'x'))
  })

  it('does not confuse a board-only machine with a guid-only one', () => {
    // Why both halves are labelled in the material. Without the labels,
    // board 'A' with no guid and guid 'A' with no board hash identically.
    expect(digestFor('A', '', 'x')).not.toBe(digestFor('', 'A', 'x'))
  })

  it('still identifies a machine that reports only a guid', () => {
    // The common case on consumer hardware, including the machine this was
    // written on: the board serial is junk, the machine GUID is real.
    expect(digestFor('', 'GUID1', 'x')).not.toBe(digestFor('', 'GUID2', 'x'))
  })

  it('never leaks the serial it was made from', () => {
    // The sign-in screen promises only the licence, the email and the
    // computer's name are sent. A raw motherboard serial would make that
    // untrue, so what leaves is a one-way hash.
    const digest = digestFor('PF2M4T9K', 'GUID1', 'x')

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(digest).not.toContain('PF2M4T9K')
  })

  it('falls back when the hardware says nothing at all', () => {
    // A virtual machine, or a policy that blocks WMI. Weaker, and the right
    // trade: a seat that cannot be identified must still be usable, because
    // the alternative is refusing to start.
    expect(digestFor('', '', 'install-1')).not.toBe(digestFor('', '', 'install-2'))
  })
})

describe('remembering it', () => {
  it('writes it to the config the first time and reuses it after', async () => {
    const first = await fingerprint()

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect((await readConfig()).fingerprint).toBe(first)

    // A fresh process, same machine: the stored answer, not a new reading.
    resetFingerprintCache()
    expect(await fingerprint()).toBe(first)
  })

  it('prefers what was stored over asking again', async () => {
    // If the hardware were re-read on every launch, a machine that answers
    // slowly or intermittently would drift and burn a seat each time.
    await updateConfig({ fingerprint: 'sha256:stored' })
    resetFingerprintCache()

    expect(await fingerprint()).toBe('sha256:stored')
  })
})
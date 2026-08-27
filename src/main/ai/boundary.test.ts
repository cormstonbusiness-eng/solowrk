import { describe, expect, it, vi } from 'vitest'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Where the assistant's borrowed tools are allowed to look.
 *
 * The app's own tools resolve every path through `resolveInWorkspace`, and
 * that is the whole defence against a prompt-injected instruction to read
 * somebody's SSH key: the model is reading text it did not write, so the
 * boundary cannot be a matter of the model's good behaviour.
 *
 * The SDK's built-in `Glob`, `Grep` and `Read` do not know the workspace
 * exists. They take absolute paths, and `Grep` with `output_mode: 'content'`
 * returns file contents — so the check has to happen in the permission
 * callback or it does not happen at all.
 *
 * The rule is reproduced here rather than imported because importing
 * `assistant.ts` drags in the Agent SDK and an Electron window. The test that
 * matters is that this *rule* is right; that it is the one wired up is a
 * two-line read of `requestPermission`.
 */
vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

const PATH_KEYS = ['path', 'file_path', 'notebook_path']

function escapingPath(root: string, input: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const value = input[key]
    if (typeof value !== 'string' || value === '') continue

    const base = resolve(root)
    const target = isAbsolute(value) ? resolve(value) : resolve(base, value)
    const rel = relative(base, target)

    const inside =
      target === base || (!rel.startsWith('..') && !isAbsolute(rel) && target.startsWith(base + sep))
    if (!inside) return value
  }
  return null
}

const ROOT = resolve('/workspace/SoloWrk')
const check = (input: Record<string, unknown>): string | null => escapingPath(ROOT, input)

describe('what a borrowed read tool may look at', () => {
  it('allows the workspace itself', () => {
    expect(check({ path: ROOT })).toBeNull()
    expect(check({})).toBeNull()
    expect(check({ path: '' })).toBeNull()
  })

  it('allows anything under it, relative or absolute', () => {
    expect(check({ path: 'Clients/Acme' })).toBeNull()
    expect(check({ file_path: resolve(ROOT, 'Clients/Acme/brief.md') })).toBeNull()
    expect(check({ notebook_path: 'analysis.ipynb' })).toBeNull()
  })

  it('refuses a path that climbs out', () => {
    expect(check({ path: '../..' })).toBe('../..')
    expect(check({ file_path: '../../.ssh/id_rsa' })).toBe('../../.ssh/id_rsa')
  })

  it('refuses an absolute path somewhere else entirely', () => {
    // The one that matters: a built-in tool is perfectly entitled to send an
    // absolute path, and a prompt-injected instruction would send this one.
    const elsewhere = resolve('/home/craig/.ssh/id_rsa')
    expect(check({ file_path: elsewhere })).toBe(elsewhere)
  })

  it('refuses a sibling that merely shares the name', () => {
    // C:\SoloWrk-backup is not inside C:\SoloWrk, however much it looks it.
    const sibling = `${ROOT}-backup`
    expect(check({ path: sibling })).toBe(sibling)
  })

  it('sees through a path that climbs out and back to somewhere else', () => {
    expect(check({ path: 'Clients/../../elsewhere' })).toBe('Clients/../../elsewhere')
  })

  it('allows a path that climbs and comes back inside', () => {
    // Ugly, but it lands in the workspace, and refusing it would be refusing
    // something harmless on the shape of the string rather than where it goes.
    expect(check({ path: 'Clients/../Projects' })).toBeNull()
  })

  it('checks every key a tool might use, not just the first', () => {
    expect(check({ path: 'Clients', file_path: '/etc/passwd' })).toBe('/etc/passwd')
  })
})

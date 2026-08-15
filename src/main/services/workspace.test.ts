import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { resolveInWorkspace } from './workspace'

/**
 * This is the containment boundary every file operation passes through,
 * including the AI's tools in phase 7. A hole here is the difference between
 * "the assistant edited a project note" and "the assistant edited System32".
 */
describe('resolveInWorkspace', () => {
  const root = 'C:\\Users\\Someone\\Solo'

  it('resolves a plain relative path inside the workspace', () => {
    expect(resolveInWorkspace(root, 'Clients')).toBe(resolve(root, 'Clients'))
    expect(resolveInWorkspace(root, 'Clients/Acme/brief.md')).toBe(
      resolve(root, 'Clients/Acme/brief.md')
    )
  })

  it('allows the workspace root itself', () => {
    expect(resolveInWorkspace(root, '')).toBe(resolve(root))
    expect(resolveInWorkspace(root, '.')).toBe(resolve(root))
  })

  it('rejects traversal above the workspace', () => {
    expect(() => resolveInWorkspace(root, '..')).toThrow(/escapes the workspace/)
    expect(() => resolveInWorkspace(root, '..\\..\\Windows\\System32')).toThrow(
      /escapes the workspace/
    )
    expect(() => resolveInWorkspace(root, 'Clients/../../secrets.txt')).toThrow(
      /escapes the workspace/
    )
  })

  it('rejects absolute paths outright', () => {
    expect(() => resolveInWorkspace(root, 'C:\\Windows\\System32')).toThrow(/Absolute paths/)
    expect(() => resolveInWorkspace(root, '/etc/passwd')).toThrow(/Absolute paths/)
  })

  it('rejects a sibling folder that merely shares a name prefix', () => {
    // resolve() would happily produce C:\...\Solo-backup from '..\Solo-backup',
    // and a naive startsWith check would accept it.
    expect(() => resolveInWorkspace(root, '..\\Solo-backup\\solo.db')).toThrow(
      /escapes the workspace/
    )
  })

  it('allows traversal that stays within the workspace', () => {
    expect(resolveInWorkspace(root, 'Clients/Acme/../Beta')).toBe(resolve(root, 'Clients/Beta'))
  })
})
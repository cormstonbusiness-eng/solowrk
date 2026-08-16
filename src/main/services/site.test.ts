import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

// site.ts reaches credentials.ts, which imports electron.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:\\userData') },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString()
  }
}))

const { parseRepo, resolveInSite } = await import('./site')

/**
 * `resolveInSite` is the containment boundary for every file operation on the
 * user's website — a repository outside the workspace that git will happily
 * commit whatever we put in it. It gets the same coverage as
 * `resolveInWorkspace` because two boundaries that are tested differently is
 * how one of them ends up weaker.
 */
describe('resolveInSite', () => {
  const root = 'C:\\sites\\my-website'

  it('resolves a path inside the site', () => {
    expect(resolveInSite(root, 'content/blog/a-post.md')).toBe(
      join(root, 'content', 'blog', 'a-post.md')
    )
  })

  it('allows the root itself', () => {
    expect(resolveInSite(root, '')).toBe(root)
  })

  it('refuses an absolute path', () => {
    expect(() => resolveInSite(root, 'C:\\Windows\\System32\\drivers\\etc\\hosts')).toThrow(
      /Absolute paths/
    )
    expect(() => resolveInSite(root, '/etc/passwd')).toThrow()
  })

  it('refuses traversal out of the site', () => {
    expect(() => resolveInSite(root, '../secrets.txt')).toThrow(/escapes/)
    expect(() => resolveInSite(root, 'content/../../secrets.txt')).toThrow(/escapes/)
    expect(() => resolveInSite(root, '..')).toThrow(/escapes/)
  })

  it('refuses a sibling folder that merely shares a prefix', () => {
    // `my-website-backup` starts with `my-website`, so a naive startsWith
    // check would treat it as inside the site.
    expect(() => resolveInSite(root, '../my-website-backup/secret.md')).toThrow(/escapes/)
  })

  it('refuses to resolve anything at all when no site is set', () => {
    // Otherwise an empty root resolves against the process working directory,
    // and a write lands somewhere entirely unrelated.
    expect(() => resolveInSite('', 'content/blog/a.md')).toThrow(/No website folder/)
  })

  it('allows a path that traverses but stays inside', () => {
    expect(resolveInSite(root, 'content/blog/../blog/a.md')).toBe(
      join(root, 'content', 'blog', 'a.md')
    )
  })
})

describe('parseRepo', () => {
  it('splits owner and repo', () => {
    expect(parseRepo('cormstonbusiness-eng/blockout-digital-website')).toEqual({
      owner: 'cormstonbusiness-eng',
      name: 'blockout-digital-website'
    })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRepo('  owner/repo  ')?.name).toBe('repo')
  })

  it('rejects anything that is not owner/repo', () => {
    // A full URL pasted in is the common mistake, and it must be rejected
    // rather than turned into a request to a nonsense path.
    expect(parseRepo('https://github.com/owner/repo')).toBeNull()
    expect(parseRepo('owner')).toBeNull()
    expect(parseRepo('owner/repo/extra')).toBeNull()
    expect(parseRepo('')).toBeNull()
    expect(parseRepo('owner/repo.git/../../x')).toBeNull()
  })
})

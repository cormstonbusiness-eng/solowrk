import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changelog, releaseFor } from './changelog'

/**
 * The update notes.
 *
 * Mostly one assertion that matters: the release being cut has notes written
 * for it. `npm run release` bumps package.json and then runs the tests, so a
 * release with nobody's notes fails there — before the installer is built and
 * long before anyone downloads it.
 */
const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

const rank = (version: string): number =>
  version.split('.').reduce((total, part) => total * 1000 + Number(part), 0)

describe('the changelog', () => {
  it('is never behind the version being shipped', () => {
    /**
     * Ahead is fine and is the normal way round — you write the notes, then
     * cut the release that bumps package.json to meet them. Behind is the
     * failure: it means a version went out with nobody's notes, and the
     * What's new card would tell the user nothing was written.
     *
     * `npm run release` bumps the version and then runs the tests, so this
     * fails there — before the installer is built.
     */
    expect(
      rank(changelog[0]!.version) >= rank(packageVersion),
      `package.json is ${packageVersion} but the newest changelog entry is ` +
        `${changelog[0]!.version}. Add an entry to src/shared/changelog.ts.`
    ).toBe(true)
  })

  it('finds a version by name', () => {
    expect(releaseFor(changelog[0]!.version)).toBeDefined()
    expect(releaseFor('0.0.0-nope')).toBeUndefined()
  })

  it('runs newest first', () => {
    // The card shows changelog[0] as the current release and everything after
    // it as history. Out of order, it would present an old release as new.
    const ranks = changelog.map((release) => rank(release.version))
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
  })

  it('lists every version once', () => {
    const versions = changelog.map((release) => release.version)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('is written for somebody who uses the app', () => {
    for (const release of changelog) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(release.changes.length).toBeGreaterThan(0)

      for (const change of release.changes) {
        // A headline that trails off with a full stop reads as a fragment in a
        // list; the detail underneath is where sentences go.
        expect(change.text.endsWith('.'), change.text).toBe(false)
        expect(change.text.length).toBeGreaterThan(3)
        expect(change.text.length).toBeLessThan(80)

        // No file names, no type names. Nobody reading this owns the repo.
        expect(change.text, change.text).not.toMatch(/\.tsx?\b|IPC|refactor/i)
      }
    }
  })

  it('says plainly when something moved behind the paywall', () => {
    // The one category people are entitled to be annoyed about, and the one
    // most tempting to file under "improved".
    const marketing = changelog
      .flatMap((release) => release.changes)
      .find((change) => change.text.includes('Marketing'))

    expect(marketing?.kind).toBe('changed')
  })
})
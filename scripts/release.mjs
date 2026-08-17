import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Cut a release.
 *
 * One command, because a release is three things that must all happen and must
 * happen in order — bump the version, build the installer, publish it — and
 * doing them by hand is how you end up with a published installer whose version
 * matches the one already out there, which the updater then ignores forever.
 *
 *   npm run release            → 0.1.0 becomes 0.1.1
 *   npm run release -- minor   → 0.1.0 becomes 0.2.0
 *   npm run release -- major   → 0.1.0 becomes 1.0.0
 *   npm run release -- 1.4.2   → exactly that
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = join(root, 'package.json')

/** Installers live apart from the source. Must match electron-builder.yml. */
const RELEASES_REPO = 'cormstonbusiness-eng/solowrk-releases'

/**
 * `npm` and `npx` are `.cmd` shims on Windows, and Node refuses to spawn those
 * without a shell. Everything else runs without one — and that distinction
 * matters rather than being pedantry: `shell: true` concatenates arguments into
 * one string without quoting them, so `git commit -m "Release v0.1.1"` arrives
 * as `-m Release` plus a pathspec that does not exist, and the commit fails
 * *after* the installer has already been published.
 *
 * The npm calls below pass no argument containing a space, so the shell is
 * safe there. Git's commit message does, so it must not have one.
 */
const needsShell = (command) =>
  process.platform === 'win32' && (command === 'npm' || command === 'npx')

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: needsShell(command),
    ...options
  })

const capture = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: needsShell(command)
  }).trim()

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

/**
 * Refuse to package a build older than the source it claims to be.
 *
 * The belt to the braces above. `npm run build` can fail in ways that leave the
 * previous output in place, and the failure mode is invisible — you get an
 * installer that works perfectly and is missing the thing you just wrote.
 * Comparing timestamps is crude but it is the exact check that would have
 * caught 0.1.5.
 */
function assertBuildIsCurrent() {
  const newest = (dir) => {
    let latest = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs)
    }
    return latest
  }

  const source = newest(join(root, 'src'))
  const built = newest(join(root, 'out'))

  if (built < source) {
    fail(
      'The build in out/ is older than the source in src/.\n' +
        '  Something went wrong compiling — packaging now would ship stale code.'
    )
  }
}

/* ------------------------------------------------------------ preflight */

// A release is built from what is committed, so anything uncommitted would be
// in the installer but not in the history — and unreproducible from that tag.
if (capture('git', ['status', '--porcelain']) !== '') {
  fail('You have uncommitted changes. Commit or stash them, then release.')
}

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  fail(
    'No GH_TOKEN set. electron-builder needs it to publish.\n' +
      '  Run:  $env:GH_TOKEN = (gh auth token)'
  )
}

/* -------------------------------------------------------------- version */

const bump = process.argv[2] ?? 'patch'
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
const [major, minor, patch] = manifest.version.split('.').map(Number)

const next = /^\d+\.\d+\.\d+$/.test(bump)
  ? bump
  : bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  fail(`"${bump}" is not major, minor, patch or a version number.`)
}

console.log(`\n  SoloWrk ${manifest.version} → ${next}\n`)

manifest.version = next
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)

/* ------------------------------------------------------ build & publish */

try {
  // Tests first. Publishing a broken build is worse than not publishing,
  // because the updater will hand it to you automatically.
  run('npm', ['test'])

  /**
   * Build from source before packaging.
   *
   * electron-builder packages whatever is sitting in `out/` — it does not
   * compile anything. Without this line a release ships the last build someone
   * happened to run, with a fresh version number on it, and nothing about the
   * output says so: the tests pass, the installer builds, the upload succeeds,
   * and the new version simply does not contain the change it was cut for.
   * That shipped once, as 0.1.5.
   *
   * `npm run build` runs typecheck first, so this covers that too.
   */
  run('npm', ['run', 'build'])
  assertBuildIsCurrent()

  /**
   * Create the draft release before building.
   *
   * electron-builder uploads assets in parallel, and each upload independently
   * finds-or-creates the release it belongs to. With no release to find, two of
   * them create one, and the assets end up split across a pair of releases
   * sharing a tag — the installer and the feed on one, the blockmap orphaned on
   * the other. That is reproducible, not a race you get away with.
   *
   * Creating it up front means every upload finds the same release.
   */
  run('gh', [
    'release',
    'create',
    `v${next}`,
    '--repo',
    RELEASES_REPO,
    '--draft',
    '--title',
    `${next}`,
    '--notes',
    `SoloWrk ${next}`
  ])

  run('npx', ['electron-builder', '--win', '--publish', 'always'])
} catch {
  // Put the version back so a failed release does not leave the number
  // advanced with nothing published against it.
  manifest.version = `${major}.${minor}.${patch}`
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)

  // And take the draft with it, so a retry starts from nothing rather than
  // finding a half-filled release from the attempt before.
  try {
    run('gh', ['release', 'delete', `v${next}`, '--repo', RELEASES_REPO, '--yes', '--cleanup-tag'])
  } catch {
    // It may never have been created. Nothing to tidy.
  }

  fail('Release failed. The version has been put back and the draft removed.')
}

/* -------------------------------------------------------------- publish */

/**
 * Flip the draft live.
 *
 * electron-builder uploads into a draft (see electron-builder.yml), so nothing
 * is downloadable until this runs. That ordering is the point: the release
 * becomes visible with every asset already attached, rather than existing for
 * ten minutes as an empty shell that an updater could find and choke on.
 */
try {
  run('gh', [
    'release',
    'edit',
    `v${next}`,
    '--repo',
    RELEASES_REPO,
    '--draft=false',
    '--latest'
  ])
} catch {
  fail(
    `The installer uploaded but the release is still a draft.\n` +
      `  Publish it by hand:  gh release edit v${next} --repo ${RELEASES_REPO} --draft=false --latest`
  )
}

/* --------------------------------------------------------------- record */

run('git', ['add', 'package.json', 'package-lock.json'])
run('git', ['commit', '-m', `Release v${next}`])
run('git', ['tag', `v${next}`])

console.log(`
  Published v${next}.

  Push the commit and tag when you are ready:
    git push && git push --tags

  Installed copies will offer the update within a few hours, or immediately
  from Settings → App → Check now.
`)
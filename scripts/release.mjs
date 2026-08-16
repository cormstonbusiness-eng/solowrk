import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
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

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: true, ...options })

const capture = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', shell: true }).trim()

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
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
  // Tests and typecheck first. Publishing a broken build is worse than not
  // publishing, because the updater will hand it to you automatically.
  run('npm', ['test'])
  run('npx', ['electron-builder', '--win', '--publish', 'always'])
} catch {
  // Put the version back so a failed release does not leave the number
  // advanced with nothing published against it.
  manifest.version = `${major}.${minor}.${patch}`
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  fail('Release failed. The version has been put back.')
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
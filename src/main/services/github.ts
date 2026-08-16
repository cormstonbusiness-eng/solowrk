import { getSecret } from './credentials'

/**
 * The GitHub API, used to publish.
 *
 * This is the first outbound request the app makes. It uses global `fetch` —
 * Electron 43 is on a recent Node, so there is no HTTP client to add and no
 * native module, which is the rule the whole build follows.
 *
 * **Publishing is one commit, always.** The obvious approach — the Contents
 * API — writes a single file per call, so a post and its hero image would
 * arrive as two commits: two Vercel builds, and a window in between where the
 * live post points at an image that does not exist yet. The Git Data API is
 * more plumbing (blob, tree, commit, ref) for the result that is actually
 * correct: every file lands together or nothing does.
 */

const API = 'https://api.github.com'

/** GitHub is usually fast; a request still hanging at 30s is not coming back. */
const TIMEOUT_MS = 30_000

export interface CommitFile {
  /** Repo-relative path, forward slashes. */
  path: string
  /** UTF-8 text, or base64 for anything binary. */
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface PublishResult {
  sha: string
  url: string
  branch: string
}

async function token(): Promise<string> {
  const value = await getSecret('github.token')
  if (value === null) {
    throw new Error('No GitHub token is saved. Add one in Settings → Website.')
  }
  return value
}

/**
 * One API call, with the errors turned into something a person can act on.
 *
 * GitHub's own messages are written for API consumers ("Bad credentials",
 * "Not Found") and are actively misleading in this context — a 404 here almost
 * always means the token cannot see the repository, not that it is missing.
 */
async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${await token()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'SoloWrk'
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new Error('GitHub did not respond. Check your connection and try again.')
    }
    throw new Error('Could not reach GitHub. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('GitHub rejected the token. It may have expired — create a new one.')
    }
    if (response.status === 404) {
      throw new Error(
        'GitHub cannot find that repository, which usually means the token does not have ' +
          'access to it rather than that it is missing. Check the repository name and that ' +
          'the token grants Contents access to it.'
      )
    }
    if (response.status === 403) {
      throw new Error('GitHub refused the request. The token is missing Contents write access.')
    }
    if (response.status === 409) {
      throw new Error('The branch moved while publishing. Try again.')
    }

    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub returned ${response.status}. ${detail.slice(0, 200)}`)
  }

  return (await response.json()) as T
}

/** Confirms the token works and the repo is reachable, before anything is written. */
export async function checkAccess(
  owner: string,
  name: string
): Promise<{ defaultBranch: string; permissions: boolean }> {
  const repo = await call<{ default_branch: string; permissions?: { push?: boolean } }>(
    `/repos/${owner}/${name}`
  )

  return {
    defaultBranch: repo.default_branch,
    // Fine-grained tokens do not always report permissions; absent is not "no".
    permissions: repo.permissions?.push !== false
  }
}

/**
 * Commit a set of files to a branch, as one commit.
 *
 * Files not named are untouched — the new tree is built with `base_tree` set to
 * the current one, so this adds and replaces rather than replacing the
 * repository. That matters: a publish must never be able to delete the site.
 */
export async function commitFiles(
  owner: string,
  name: string,
  branch: string,
  message: string,
  files: CommitFile[]
): Promise<PublishResult> {
  if (files.length === 0) throw new Error('Nothing to publish.')

  const repo = `/repos/${owner}/${name}`

  // Where the branch is now. Read first so the commit has a parent and cannot
  // orphan whatever is already there.
  const ref = await call<{ object: { sha: string } }>(`${repo}/git/ref/heads/${branch}`)
  const head = ref.object.sha
  const headCommit = await call<{ tree: { sha: string } }>(`${repo}/git/commits/${head}`)

  const blobs = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      sha: (
        await call<{ sha: string }>(`${repo}/git/blobs`, {
          method: 'POST',
          body: { content: file.content, encoding: file.encoding }
        })
      ).sha
    }))
  )

  const tree = await call<{ sha: string }>(`${repo}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: headCommit.tree.sha,
      tree: blobs.map((blob) => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      }))
    }
  })

  const commit = await call<{ sha: string; html_url: string }>(`${repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [head] }
  })

  // Not forced: if the branch moved while we were building the tree, this
  // fails with a 409 rather than discarding whatever arrived in the meantime.
  await call(`${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false }
  })

  return { sha: commit.sha, url: commit.html_url, branch }
}

export type DeployState = 'pending' | 'success' | 'failure' | 'none'

/**
 * How the deploy of a commit is going.
 *
 * Read from GitHub rather than Vercel: Vercel writes its build status back to
 * the commit, so the token we already have answers the question and there is no
 * second integration to set up, no second token to store, and nothing to break
 * if the hosting ever moves.
 */
export async function deployState(
  owner: string,
  name: string,
  sha: string
): Promise<{ state: DeployState; url: string }> {
  try {
    const status = await call<{
      state: string
      statuses: { state: string; target_url: string | null }[]
    }>(`/repos/${owner}/${name}/commits/${sha}/status`)

    if (status.statuses.length === 0) return { state: 'none', url: '' }

    const state: DeployState =
      status.state === 'success'
        ? 'success'
        : status.state === 'failure' || status.state === 'error'
          ? 'failure'
          : 'pending'

    return { state, url: status.statuses[0]?.target_url ?? '' }
  } catch {
    // Deploy state is a nicety. Failing to read it must not make the page look
    // broken when the publish itself succeeded.
    return { state: 'none', url: '' }
  }
}
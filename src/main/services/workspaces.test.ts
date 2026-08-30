import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

/** The tier the entitlement layer reports, stubbed per test. */
const tier = vi.fn(async () => 'free' as string)

vi.mock('./entitlements', async () => {
  const real = await vi.importActual<typeof import('./entitlements')>('./entitlements')
  return { ...real, currentTier: () => tier() }
})

const { updateConfig, readConfig } = await import('./config')
const { forgetWorkspace, knownWorkspaces, requireRoomForWorkspace, rememberWorkspace } =
  await import('./workspaces')
const { refusalFrom } = await import('@shared/limitError')

/**
 * A workspace per business.
 *
 * The tests that matter here are all about the same rule: the cap is on
 * *adding* a workspace and never on opening one. Getting that backwards would
 * lock somebody out of an entire company's books because their card expired,
 * which is the exact behaviour this product is sold against.
 */

let root = ''

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'solo-ws-config-'))
  root = await mkdtemp(join(tmpdir(), 'solo-ws-'))
  tier.mockResolvedValue('free')
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
})

/** A folder that looks enough like a workspace for `isWorkspace`. */
async function makeWorkspace(name: string): Promise<string> {
  const path = join(root, name)
  await mkdir(join(path, '_app'), { recursive: true })
  const { DatabaseSync } = await import('node:sqlite')
  new DatabaseSync(join(path, '_app', 'solo.db')).close()
  return path
}

describe('the list', () => {
  it('remembers a workspace as current and as known', async () => {
    const path = await makeWorkspace('One')
    await rememberWorkspace(path)

    const known = await knownWorkspaces()
    expect(known).toHaveLength(1)
    expect(known[0]).toMatchObject({ path, name: 'One', current: true, missing: false })
  })

  it('puts the most recently opened first', async () => {
    // The switcher lists them in the order somebody moves between them, not
    // the order they were made.
    const one = await makeWorkspace('One')
    const two = await makeWorkspace('Two')

    await rememberWorkspace(one)
    await rememberWorkspace(two)
    await rememberWorkspace(one)

    expect((await knownWorkspaces()).map((w) => w.name)).toEqual(['One', 'Two'])
  })

  it('does not list the same folder twice', async () => {
    const path = await makeWorkspace('One')
    await rememberWorkspace(path)
    await rememberWorkspace(path)

    expect(await knownWorkspaces()).toHaveLength(1)
  })

  it('shows a workspace whose folder has gone, rather than dropping it', async () => {
    // A drive that is not plugged in is not a workspace somebody deleted.
    const path = await makeWorkspace('Portable')
    await rememberWorkspace(path)
    await rm(path, { recursive: true, force: true })

    const [known] = await knownWorkspaces()
    expect(known?.missing).toBe(true)
    expect(known?.path).toBe(path)
  })

  it('adopts the old single path when upgrading from a config with no list', async () => {
    // Otherwise somebody who updates the app is shown an empty switcher and a
    // first-run wizard, with their real workspace nowhere in sight.
    const path = await makeWorkspace('Existing')
    await updateConfig({ workspacePath: path, workspaces: [] })

    expect((await readConfig()).workspaces).toEqual([path])
  })
})

describe('the cap', () => {
  it('lets Free make its first', async () => {
    await expect(requireRoomForWorkspace(null, join(root, 'First'))).resolves.toBeUndefined()
  })

  it('refuses Free a second', async () => {
    await rememberWorkspace(await makeWorkspace('One'))

    await expect(requireRoomForWorkspace(null, join(root, 'Two'))).rejects.toThrow()
  })

  it('refuses with a limit somebody can act on', async () => {
    // It has to arrive as a LimitReachedError so the upgrade modal can render
    // the real numbers rather than a bare message.
    await rememberWorkspace(await makeWorkspace('One'))

    const error = await requireRoomForWorkspace(null, join(root, 'Two')).catch((cause) => cause)
    const refusal = refusalFrom(error)

    expect(refusal?.kind).toBe('limit')
    expect(refusal?.facts).toMatchObject({ limit: 'workspaces', used: 1, cap: 1, needs: 'basicPlus' })
  })

  it('gives Basic+ three and refuses the fourth', async () => {
    tier.mockResolvedValue('basicPlus')

    for (const name of ['One', 'Two', 'Three']) {
      const path = await makeWorkspace(name)
      await expect(requireRoomForWorkspace(null, path)).resolves.toBeUndefined()
      await rememberWorkspace(path)
    }

    await expect(requireRoomForWorkspace(null, join(root, 'Four'))).rejects.toThrow()
  })

  it('never refuses Pro', async () => {
    tier.mockResolvedValue('pro')

    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      const path = await makeWorkspace(name)
      await expect(requireRoomForWorkspace(null, path)).resolves.toBeUndefined()
      await rememberWorkspace(path)
    }
  })

  it('never refuses a workspace already on the list', async () => {
    /*
      The whole point. Somebody who drops from Pro to Free with three
      workspaces keeps all three and can still open any of them — they simply
      cannot make a fourth. Refusing here would hold an entire company's books
      hostage over a lapsed card.
    */
    tier.mockResolvedValue('pro')
    const paths: string[] = []
    for (const name of ['One', 'Two', 'Three']) {
      const path = await makeWorkspace(name)
      paths.push(path)
      await rememberWorkspace(path)
    }

    tier.mockResolvedValue('free')

    for (const path of paths) {
      await expect(requireRoomForWorkspace(null, path)).resolves.toBeUndefined()
    }

    // Only a new one is refused.
    await expect(requireRoomForWorkspace(null, join(root, 'Fourth'))).rejects.toThrow()
  })
})

describe('forgetting one', () => {
  it('takes it off the list without touching the folder', async () => {
    // Forgetting is not deleting and must never become it: the folder holds
    // somebody's invoices and client records.
    const one = await makeWorkspace('One')
    const two = await makeWorkspace('Two')
    await rememberWorkspace(one)
    await rememberWorkspace(two)

    const left = await forgetWorkspace(one)

    expect(left.map((w) => w.name)).toEqual(['Two'])
    const { isWorkspace } = await import('./workspace')
    expect(await isWorkspace(one)).toBe(true)
  })

  it('refuses to forget the one that is open', async () => {
    // There would be nothing to fall back to, and the app would be left
    // holding a database it does not admit to knowing.
    const path = await makeWorkspace('Only')
    await rememberWorkspace(path)

    await expect(forgetWorkspace(path)).rejects.toThrow(/Switch to another/)
  })
})

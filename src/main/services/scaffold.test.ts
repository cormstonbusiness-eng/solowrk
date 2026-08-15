import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db'
import { migrations } from '../db/migrations'
import { getSettings } from './settings'
import { WORKSPACE_TREE, databasePath, isWorkspace, scaffoldWorkspace } from './workspace'

/**
 * Exercises the real thing on a real temp folder: the tree the wizard creates
 * and the database that lands inside it. Everything except Electron's dialog
 * and userData pointer, which have no logic worth faking.
 */
describe('workspace creation', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-test-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates the full folder tree', async () => {
    const workspace = join(root, 'Solo')
    await scaffoldWorkspace(workspace)

    for (const folder of WORKSPACE_TREE) {
      const info = await stat(join(workspace, folder))
      expect(info.isDirectory(), `${folder} should exist`).toBe(true)
    }
  })

  it('is idempotent, so it can repair a tidied-up workspace', async () => {
    const workspace = join(root, 'Solo')
    await scaffoldWorkspace(workspace)
    await writeFile(join(workspace, 'Clients', 'keep.txt'), 'existing work')

    await scaffoldWorkspace(workspace)

    const info = await stat(join(workspace, 'Clients', 'keep.txt'))
    expect(info.isFile()).toBe(true)
  })

  it('only counts as a workspace once the database exists', async () => {
    const workspace = join(root, 'Solo')
    await scaffoldWorkspace(workspace)
    expect(await isWorkspace(workspace)).toBe(false)

    const db = new Database(databasePath(workspace))
    try {
      expect(await isWorkspace(workspace)).toBe(true)
      expect(getSettings(db).currency).toBe('GBP')
    } finally {
      db.close()
    }
  })

  it('reopens an existing database without re-running migrations', async () => {
    const workspace = join(root, 'Solo')
    await scaffoldWorkspace(workspace)

    const first = new Database(databasePath(workspace))
    first.run("UPDATE settings SET business_name = ? WHERE id = 1", ['Kept'])
    first.close()

    const second = new Database(databasePath(workspace))
    try {
      expect(getSettings(second).businessName).toBe('Kept')
      // Derived from the migration list so adding one does not break this test.
      expect(second.all('SELECT id FROM _migrations')).toHaveLength(migrations.length)
    } finally {
      second.close()
    }
  })
})
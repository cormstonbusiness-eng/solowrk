import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace, PROJECT_FOLDERS } = await import('./workspace')
const { applyRename, checkProject, planRename, projectUsage, repairProject } = await import(
  './structure'
)

/**
 * Structure checking and repair, against real folders.
 *
 * The rule being defended here is the one that would be unforgivable to get
 * wrong: **repair creates and never deletes**. Somebody presses a button
 * called "Repair" on a folder holding a year of work, and what happens next
 * has to be safe under every reading.
 */

describe('checking and repairing', () => {
  let db: InstanceType<typeof Database>
  let root: string
  let projectId: number

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-struct-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')

    db.run(
      "INSERT INTO projects (name, folder, created_at, updated_at) VALUES ('Ashfield', 'Projects/Ashfield', datetime('now'), datetime('now'))"
    )
    projectId = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const make = async (...paths: string[]): Promise<void> => {
    for (const path of paths) {
      await mkdir(join(root, 'Projects/Ashfield', path), { recursive: true })
    }
  }

  it('says the folder is not there at all', async () => {
    const report = await checkProject(db, root, projectId)

    expect(report.exists).toBe(false)
    expect(report.healthy).toBe(false)
    expect(report.missing.length).toBeGreaterThan(0)
  })

  it('is healthy on a project built to the standard structure', async () => {
    await make(...PROJECT_FOLDERS)

    const report = await checkProject(db, root, projectId)
    expect(report.healthy).toBe(true)
    expect(report.score).toBe(100)
  })

  it('names what is missing', async () => {
    await make('00-Admin', '01-Brief')

    const report = await checkProject(db, root, projectId)
    expect(report.missing).toContain('02-Assets')
    expect(report.healthy).toBe(false)
  })

  it('puts back only what was missing', async () => {
    await make('00-Admin')

    const result = await repairProject(db, root, projectId)

    expect(result.report.healthy).toBe(true)
    expect(result.failed).toEqual([])
    expect(result.created).not.toContain('00-Admin')
  })

  it('never deletes a folder the user made', async () => {
    // The rule the whole feature rests on. Somebody presses "Repair" on a
    // folder holding a year of work.
    await make(...PROJECT_FOLDERS, '05-Client-Supplied/Scans')
    await writeFile(join(root, 'Projects/Ashfield/05-Client-Supplied/Scans/plan.pdf'), 'x')

    await repairProject(db, root, projectId)

    const still = await readdir(join(root, 'Projects/Ashfield/05-Client-Supplied/Scans'))
    expect(still).toEqual(['plan.pdf'])
  })

  it('never touches a file inside a folder it is repairing', async () => {
    await make('00-Admin')
    await writeFile(join(root, 'Projects/Ashfield/00-Admin/quote.pdf'), 'x')

    await repairProject(db, root, projectId)

    expect(await readdir(join(root, 'Projects/Ashfield/00-Admin'))).toEqual(['quote.pdf'])
  })

  it('does not let a template escape the workspace', async () => {
    // A folder called `../../Windows` in a template must not create anything.
    db.run(
      `INSERT INTO templates (name, description, payload, created_at, updated_at)
       VALUES ('Nasty', '', ?, datetime('now'), datetime('now'))`,
      [JSON.stringify({ folders: ['../../escaped'], tasks: [] })]
    )
    const templateId = db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
    await make('00-Admin')

    const result = await repairProject(db, root, projectId, templateId)

    expect(result.created).toEqual([])
    expect(result.failed).toEqual(['../../escaped'])
  })
})

describe('disk usage', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-usage-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('adds up a project and finds its biggest files', async () => {
    db.run(
      "INSERT INTO projects (name, folder, created_at, updated_at) VALUES ('Ashfield', 'Projects/Ashfield', datetime('now'), datetime('now'))"
    )
    await mkdir(join(root, 'Projects/Ashfield/02-Assets'), { recursive: true })
    await writeFile(join(root, 'Projects/Ashfield/02-Assets/big.exr'), 'x'.repeat(5000))
    await writeFile(join(root, 'Projects/Ashfield/02-Assets/small.txt'), 'x'.repeat(10))

    const [usage] = await projectUsage(db, root)

    expect(usage!.files).toBe(2)
    expect(usage!.bytes).toBe(5010)
    expect(usage!.largest[0]!.path).toBe('02-Assets/big.exr')
    expect(usage!.lastTouched).not.toBeNull()
  })

  it('reports a project with no folder as empty rather than failing', async () => {
    db.run(
      "INSERT INTO projects (name, folder, created_at, updated_at) VALUES ('Ghost', 'Projects/Ghost', datetime('now'), datetime('now'))"
    )

    const [usage] = await projectUsage(db, root)
    expect(usage!.bytes).toBe(0)
    expect(usage!.lastTouched).toBeNull()
  })
})

describe('bulk rename', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-rename-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
    await mkdir(join(root, 'Projects/Ashfield/04-Deliverables'), { recursive: true })
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const folder = 'Projects/Ashfield/04-Deliverables'

  const put = async (...names: string[]): Promise<void> => {
    for (const name of names) await writeFile(join(root, folder, name), 'x')
  }

  it('previews without touching anything', async () => {
    await put('a.exr', 'b.exr')

    const plan = await planRename(db, root, folder, 'shot_{ref}')

    expect(plan.map((one) => one.to)).toEqual(['shot_001.exr', 'shot_002.exr'])
    // Still exactly as they were.
    expect((await readdir(join(root, folder))).sort()).toEqual(['a.exr', 'b.exr'])
  })

  it('renames the files', async () => {
    await put('a.exr', 'b.exr')

    const result = await applyRename(db, root, folder, 'shot_{ref}')

    expect(result.renamed).toBe(2)
    expect((await readdir(join(root, folder))).sort()).toEqual(['shot_001.exr', 'shot_002.exr'])
  })

  it('skips a collision rather than taking the rename halfway', async () => {
    // One bad name must not stop the good ones, and must not overwrite a file.
    await put('a.exr', 'b.exr')

    const result = await applyRename(db, root, folder, 'shot')

    expect(result.renamed).toBe(1)
    expect(result.skipped).toHaveLength(1)
    // Nothing was lost: two files in, two files out.
    expect((await readdir(join(root, folder))).length).toBe(2)
  })

  it('does nothing at all when every name has a problem', async () => {
    await put('a.exr')

    const result = await applyRename(db, root, folder, '{client}_{ref}')

    expect(result.renamed).toBe(0)
    expect(await readdir(join(root, folder))).toEqual(['a.exr'])
  })

  it('leaves a folder alone rather than renaming it', async () => {
    await put('a.exr')
    await mkdir(join(root, folder, 'previews'))

    await applyRename(db, root, folder, 'shot_{ref}')

    expect((await readdir(join(root, folder))).sort()).toEqual(['previews', 'shot_001.exr'])
  })
})

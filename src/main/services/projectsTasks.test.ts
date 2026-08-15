import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../db'
import { createClient } from './clients'
import { PROJECT_FOLDERS, createProject, listProjects } from './projects'
import { createTask, listTasks, moveTask, updateTask } from './tasks'
import { createNote, listNotes, readNote, writeNote } from './notes'
import { templateFromProject } from './templates'
import { scaffoldWorkspace } from './workspace'

describe('projects and tasks', () => {
  let root: string
  let db: Database

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-p2-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('creates a client folder under Clients', async () => {
    const client = await createClient(db, root, { name: 'Acme Ltd' })
    expect(client.folder).toBe(join('Clients', 'Acme Ltd'))
    expect((await stat(join(root, client.folder, '_client'))).isDirectory()).toBe(true)
  })

  it('sanitises an awkward client name into a legal folder', async () => {
    const client = await createClient(db, root, { name: 'Smith/Jones: Ltd.' })
    expect(client.folder).toBe(join('Clients', 'Smith Jones Ltd'))
    expect((await stat(join(root, client.folder))).isDirectory()).toBe(true)
  })

  it('gives two clients of the same name separate folders', async () => {
    const first = await createClient(db, root, { name: 'Acme' })
    const second = await createClient(db, root, { name: 'Acme' })
    expect(second.folder).not.toBe(first.folder)
  })

  it('creates the project folder tree inside its client', async () => {
    const client = await createClient(db, root, { name: 'Acme' })
    const project = await createProject(db, root, { name: 'Rebrand', clientId: client.id })

    expect(project.folder).toBe(join('Clients', 'Acme', 'Rebrand'))
    for (const folder of PROJECT_FOLDERS) {
      expect((await stat(join(root, project.folder, folder))).isDirectory()).toBe(true)
    }
  })

  it('files a project with no client under _Internal', async () => {
    const project = await createProject(db, root, { name: 'Website refresh' })
    expect(project.folder).toBe(join('Clients', '_Internal', 'Website refresh'))
  })

  it('reports task counts on the project summary', async () => {
    const project = await createProject(db, root, { name: 'Rebrand' })
    createTask(db, { title: 'One', projectId: project.id })
    const done = createTask(db, { title: 'Two', projectId: project.id })
    updateTask(db, done.id, { status: 'done' })

    const summary = listProjects(db).find((p) => p.id === project.id)
    expect(summary?.taskCount).toBe(2)
    expect(summary?.openTaskCount).toBe(1)
  })

  it('stamps completed_at from status rather than trusting the caller', () => {
    const task = createTask(db, { title: 'Ship it' })
    expect(task.completedAt).toBeNull()

    const done = updateTask(db, task.id, { status: 'done' })
    expect(done.completedAt).not.toBeNull()

    const reopened = updateTask(db, task.id, { status: 'todo' })
    expect(reopened.completedAt).toBeNull()
  })

  it('appends new tasks to the end of their column', () => {
    const first = createTask(db, { title: 'First' })
    const second = createTask(db, { title: 'Second' })
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('drops a moved task between its new neighbours', () => {
    const a = createTask(db, { title: 'A' })
    const b = createTask(db, { title: 'B' })
    const c = createTask(db, { title: 'C' })

    // Move C to sit before B.
    const moved = moveTask(db, c.id, { status: 'todo', projectId: null, beforeId: b.id })

    expect(moved.sortOrder).toBeGreaterThan(a.sortOrder)
    expect(moved.sortOrder).toBeLessThan(b.sortOrder)

    const order = listTasks(db, { topLevelOnly: true }).map((t) => t.title)
    expect(order).toEqual(['A', 'C', 'B'])
  })

  it('moves a task between columns', () => {
    const task = createTask(db, { title: 'A' })
    const moved = moveTask(db, task.id, { status: 'doing', projectId: null, beforeId: null })
    expect(moved.status).toBe('doing')
  })

  it('deletes subtasks along with their parent', () => {
    const parent = createTask(db, { title: 'Parent' })
    createTask(db, { title: 'Child', parentId: parent.id })
    expect(listTasks(db)).toHaveLength(2)

    db.run('DELETE FROM tasks WHERE id = ?', [parent.id])
    expect(listTasks(db)).toHaveLength(0)
  })

  it('counts subtask progress on the parent', () => {
    const parent = createTask(db, { title: 'Parent' })
    const one = createTask(db, { title: 'A', parentId: parent.id })
    createTask(db, { title: 'B', parentId: parent.id })
    updateTask(db, one.id, { status: 'done' })

    const [top] = listTasks(db, { topLevelOnly: true })
    expect(top?.subtaskCount).toBe(2)
    expect(top?.subtaskDoneCount).toBe(1)
  })

  it('filters tasks by project, category and search', async () => {
    const project = await createProject(db, root, { name: 'Website' })
    const [category] = db.all<{ id: number }>('SELECT id FROM categories ORDER BY id')

    createTask(db, {
      title: 'Design homepage',
      projectId: project.id,
      categoryId: category!.id
    })
    createTask(db, { title: 'Write copy', projectId: project.id })
    createTask(db, { title: 'Chase invoice' })

    expect(listTasks(db, { search: 'homepage' })).toHaveLength(1)
    expect(listTasks(db, { projectId: project.id })).toHaveLength(2)
    expect(listTasks(db, { categoryId: category!.id })).toHaveLength(1)
    // projectId: null means "not attached to a project", not "any project".
    expect(listTasks(db, { projectId: null })).toHaveLength(1)
  })

  it('refuses a task pointing at a project that does not exist', () => {
    expect(() => createTask(db, { title: 'Orphan', projectId: 9999 })).toThrow(/FOREIGN KEY/)
  })

  it('writes notes as real markdown files and reads them back', async () => {
    const project = await createProject(db, root, { name: 'Rebrand' })
    const note = await createNote(db, root, project.id, 'Kickoff meeting')

    expect(note.file.endsWith('.md')).toBe(true)
    expect((await stat(join(root, note.file))).isFile()).toBe(true)

    await writeNote(db, root, note.id, '# Kickoff\n\nAgreed scope.')
    expect(await readNote(db, root, note.id)).toContain('Agreed scope')
    expect(listNotes(db, project.id)).toHaveLength(1)
  })

  it('captures a project as a template with tasks reset to to-do', async () => {
    const project = await createProject(db, root, { name: 'Rebrand' })
    const task = createTask(db, { title: 'Moodboard', projectId: project.id })
    updateTask(db, task.id, { status: 'done' })

    const template = templateFromProject(db, project.id, 'Brand identity')
    expect(template.payload.tasks).toHaveLength(1)
    expect(template.payload.tasks[0]?.status).toBe('todo')

    // And a project created from it gets the seeded task.
    const fresh = await createProject(db, root, {
      name: 'Rebrand two',
      templateId: template.id
    })
    expect(listTasks(db, { projectId: fresh.id })).toHaveLength(1)
  })
})

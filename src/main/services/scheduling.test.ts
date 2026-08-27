import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const { scaffoldWorkspace } = await import('./workspace')
const { createProject } = await import('./projects')
const { createTask, getTask, updateTask } = await import('./tasks')
const { createBlock, updateBlock } = await import('./blocks')
const { adoptEstimate, scheduleTask, unscheduledTasks } = await import('./scheduling')

describe('scheduling a task', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-sched-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('puts the task in the diary and gives it a time', () => {
    const task = createTask(db, { title: 'Write the copy', estimateMinutes: 90 })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    expect(block).toMatchObject({
      title: 'Write the copy',
      blockType: 'task',
      taskId: task.id,
      startsAt: '2026-08-18T09:00',
      // The estimate decides the length.
      endsAt: '2026-08-18T10:30'
    })
    expect(getTask(db, task.id).scheduledAt).toBe('2026-08-18T09:00')
  })

  it('falls back to the default length without inventing an estimate', () => {
    const task = createTask(db, { title: 'Something vague' })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    expect(block.endsAt).toBe('2026-08-18T10:00')
    // A task scheduled for an hour because an hour is the default has still
    // not been estimated, and every figure built on estimates depends on that.
    expect(getTask(db, task.id).estimateMinutes).toBeNull()
  })

  it('carries the project across, so the block is the right colour', async () => {
    const project = await createProject(db, root, { name: 'Rebrand', colour: '#3B82F6' })
    const task = createTask(db, { title: 'Moodboard', projectId: project.id })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    expect(block.projectId).toBe(project.id)
    expect(block.displayColour).toBe('#3B82F6')
  })
})

describe('the task and its block, kept in step', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-sched2-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('follows the block when it is dragged', () => {
    const task = createTask(db, { title: 'Draft' })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    updateBlock(db, block.id, { startsAt: '2026-08-20T14:00', endsAt: '2026-08-20T15:00' })
    expect(getTask(db, task.id).scheduledAt).toBe('2026-08-20T14:00')
  })

  it('returns the task to the rail, intact, when the block is deleted', () => {
    const task = createTask(db, { title: 'Draft', estimateMinutes: 45, notes: 'Keep it short' })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    db.run('DELETE FROM calendar_blocks WHERE id = ?', [block.id])

    const after = getTask(db, task.id)
    // Deleting a block never deletes its task, and takes nothing else with it.
    expect(after.scheduledAt).toBeNull()
    expect(after).toMatchObject({ title: 'Draft', estimateMinutes: 45, notes: 'Keep it short' })
    expect(unscheduledTasks(db).map((one) => one.title)).toEqual(['Draft'])
  })

  it('reports the earliest of several sittings', () => {
    const task = createTask(db, { title: 'Long haul' })
    scheduleTask(db, { taskId: task.id, startsAt: '2026-08-20T09:00' })
    scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    expect(getTask(db, task.id).scheduledAt).toBe('2026-08-18T09:00')
  })

  it('falls back to the next sitting when the first is deleted', () => {
    const task = createTask(db, { title: 'Long haul' })
    const first = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })
    scheduleTask(db, { taskId: task.id, startsAt: '2026-08-20T09:00' })

    db.run('DELETE FROM calendar_blocks WHERE id = ?', [first.id])
    expect(getTask(db, task.id).scheduledAt).toBe('2026-08-20T09:00')
  })

  it('lets go when the block stops pointing at the task', () => {
    const task = createTask(db, { title: 'Draft' })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    db.run("UPDATE calendar_blocks SET task_id = NULL WHERE id = ?", [block.id])
    expect(getTask(db, task.id).scheduledAt).toBeNull()
  })
})

describe('estimates', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-sched3-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('are not touched by resizing the block', () => {
    const task = createTask(db, { title: 'Draft', estimateMinutes: 60 })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })

    updateBlock(db, block.id, { endsAt: '2026-08-18T12:00' })

    // Dragging a block out to three hours because that is the slot going free
    // is not a revised estimate, and an app that decided it was would corrupt
    // every figure built on estimates.
    expect(getTask(db, task.id).estimateMinutes).toBe(60)
  })

  it('can be adopted from the block, when asked', () => {
    const task = createTask(db, { title: 'Draft', estimateMinutes: 60 })
    const block = scheduleTask(db, { taskId: task.id, startsAt: '2026-08-18T09:00' })
    updateBlock(db, block.id, { endsAt: '2026-08-18T12:00' })

    expect(adoptEstimate(db, block.id).estimateMinutes).toBe(180)
  })

  it('refuses a block that is not scheduling anything', () => {
    const block = createBlock(db, {
      title: 'Lunch',
      startsAt: '2026-08-18T13:00',
      endsAt: '2026-08-18T14:00'
    })
    expect(() => adoptEstimate(db, block.id)).toThrow(/not scheduling/)
  })
})

describe('the unscheduled rail', () => {
  let db: InstanceType<typeof Database>
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solo-rail-'))
    await scaffoldWorkspace(root)
    db = new Database(':memory:')
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  it('leaves out anything already on the grid', () => {
    const scheduled = createTask(db, { title: 'Booked in' })
    createTask(db, { title: 'Still floating' })
    scheduleTask(db, { taskId: scheduled.id, startsAt: '2026-08-18T09:00' })

    expect(unscheduledTasks(db).map((one) => one.title)).toEqual(['Still floating'])
  })

  it('leaves out what is done and what is filed away', () => {
    createTask(db, { title: 'Finished', status: 'done' })
    const filed = createTask(db, { title: 'Filed' })
    updateTask(db, filed.id, { archived: true })
    createTask(db, { title: 'Live' })

    expect(unscheduledTasks(db).map((one) => one.title)).toEqual(['Live'])
  })

  it('leaves out subtasks, which belong to their parent row', () => {
    const parent = createTask(db, { title: 'Build the thing' })
    createTask(db, { title: 'A step of it', parentId: parent.id })

    expect(unscheduledTasks(db).map((one) => one.title)).toEqual(['Build the thing'])
  })

  it('puts what has a deadline first, soonest first', () => {
    createTask(db, { title: 'No deadline' })
    createTask(db, { title: 'Later', dueAt: '2026-09-01' })
    createTask(db, { title: 'Sooner', dueAt: '2026-08-20' })

    expect(unscheduledTasks(db).map((one) => one.title)).toEqual([
      'Sooner',
      'Later',
      'No deadline'
    ])
  })

  it('searches by title', () => {
    createTask(db, { title: 'Write the copy' })
    createTask(db, { title: 'Send the invoice' })

    expect(unscheduledTasks(db, { search: 'copy' }).map((one) => one.title)).toEqual([
      'Write the copy'
    ])
  })
})

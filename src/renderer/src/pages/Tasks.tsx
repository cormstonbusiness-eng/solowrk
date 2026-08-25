import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, CircleCheckBig, Columns3, List, Plus, Tag } from 'lucide-react'
import type { TaskStatus, TaskWithContext } from '@shared/types'
import { COLOUR_CHOICES, TASK_STATUSES } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Dot, Empty } from '@/components/ui/Empty'
import { Field } from '@/components/ui/Field'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { TaskRow } from './tasks/TaskRow'
import { TaskModal } from './tasks/TaskModal'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'

type View = 'board' | 'list'

/**
 * A compact colour swatch for the add row. The full picker is eight swatches
 * wide, which is too much furniture for a row you type in.
 */
function ColourDot({
  value,
  onChange
}: {
  value: string
  onChange: (colour: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Task colour"
        title="Task colour"
        className="grid h-9 w-9 place-items-center rounded-control border border-line bg-raised transition-colors hover:border-line-strong"
      >
        <span
          style={{ backgroundColor: value || 'transparent' }}
          className={cn(
            'h-3.5 w-3.5 rounded-full',
            value === '' && 'border border-dashed border-line-strong'
          )}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute top-full right-0 z-20 mt-1 flex w-[132px] flex-wrap gap-1.5 rounded-control border border-line-strong bg-overlay p-2 shadow-xl">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              title="No colour"
              className="h-5 w-5 rounded-full border border-dashed border-line-strong"
            />
            {COLOUR_CHOICES.map((colour) => (
              <button
                key={colour}
                type="button"
                onClick={() => {
                  onChange(colour)
                  setOpen(false)
                }}
                style={{ backgroundColor: colour }}
                className="h-5 w-5 rounded-full transition-transform hover:scale-110"
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Tasks(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('board')
  const [projectFilter, setProjectFilter] = useState<number | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<TaskWithContext | null>(null)
  const [managingCategories, setManagingCategories] = useState(false)
  const [dragging, setDragging] = useState<TaskWithContext | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newProjectId, setNewProjectId] = useState<number | null>(null)
  const [newDueAt, setNewDueAt] = useState('')
  const [newColour, setNewColour] = useState('')
  const quickAdd = useRef<HTMLInputElement>(null)

  useOpenParam('new', () => quickAdd.current?.focus())

  const { data: tasks = [] } = useQuery({
    queryKey: keys.tasks({ topLevelOnly: true }),
    queryFn: () => window.solo.invoke('tasks:list', { topLevelOnly: true })
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const { data: categories = [] } = useQuery({
    queryKey: keys.categories,
    queryFn: () => window.solo.invoke('categories:list')
  })

  /**
   * Quick add. It inherits whatever the filters are set to, because if you are
   * looking at one project's tasks, the task you are about to write is almost
   * certainly that project's.
   */
  const add = useMutation({
    mutationFn: () =>
      window.solo.invoke('tasks:create', {
        title: newTitle.trim(),
        // The row's own project wins; the filter is only a fallback, so
        // filtering to a project and typing still does the obvious thing.
        projectId: newProjectId ?? projectFilter,
        categoryId: categoryFilter,
        dueAt: newDueAt || null,
        colour: newColour
      }),
    onSuccess: () => {
      invalidate(['tasks'])
      // Title clears; project, date and colour stay, because adding five tasks
      // to the same project in a row is the normal case.
      setNewTitle('')
      quickAdd.current?.focus()
    }
  })

  const toggle = useMutation({
    mutationFn: (task: TaskWithContext) =>
      window.solo.invoke('tasks:update', {
        id: task.id,
        patch: { status: task.status === 'done' ? 'todo' : 'done' }
      }),
    onSuccess: () => invalidate(['tasks'])
  })

  const archive = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke('tasks:update', { id, patch: { archived: true } }),
    onSuccess: () => invalidate(['tasks'])
  })

  const archiveDone = useMutation({
    mutationFn: async () => {
      // Sequential rather than parallel: these are local SQLite writes, and a
      // burst of them racing gains nothing but makes a partial failure murky.
      for (const task of tasks.filter((entry) => entry.status === 'done')) {
        await window.solo.invoke('tasks:update', { id: task.id, patch: { archived: true } })
      }
    },
    onSuccess: () => invalidate(['tasks'])
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('tasks:delete', { id }),
    onSuccess: () => invalidate(['tasks'])
  })

  const move = useMutation({
    mutationFn: (args: { id: number; status: TaskStatus; projectId: number | null }) =>
      window.solo.invoke('tasks:move', { ...args, beforeId: null }),
    onSuccess: () => invalidate(['tasks'])
  })

  const sensors = useSensors(
    // A small distance threshold so clicking a task opens it instead of
    // starting a drag the user did not intend.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const visible = tasks.filter((task) => {
    if (projectFilter !== null && task.projectId !== projectFilter) return false
    if (categoryFilter !== null && task.categoryId !== categoryFilter) return false
    if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const onDragEnd = (event: DragEndEvent): void => {
    setDragging(null)
    const status = event.over?.id as TaskStatus | undefined
    const task = tasks.find((t) => t.id === Number(event.active.id))
    if (!status || !task || task.status === status) return
    move.mutate({ id: task.id, status, projectId: task.projectId })
  }

  return (
    <Page
      title="Tasks"
      description="Everything to do, across every project."
      actions={
        <>
          {tasks.some((task) => task.status === 'done') && (
            <Button
              variant="ghost"
              onClick={() => archiveDone.mutate()}
              disabled={archiveDone.isPending}
            >
              <Archive size={14} strokeWidth={1.75} />
              Archive done
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/tasks/archived')}>
            Archived
          </Button>
          <Button variant="ghost" onClick={() => setManagingCategories(true)}>
            <Tag size={14} strokeWidth={1.75} />
            Categories
          </Button>
          <div className="flex rounded-control border border-line p-0.5">
            {(['board', 'list'] as View[]).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setView(name)}
                aria-label={`${name} view`}
                className="relative grid h-7 w-8 place-items-center rounded-[6px]"
              >
                {view === name && (
                  <motion.span
                    layoutId="task-view"
                    transition={transition.layout}
                    className="absolute inset-0 rounded-[6px] bg-raised"
                  />
                )}
                <span className={cn('relative z-10', view === name ? 'text-ink' : 'text-faint')}>
                  {name === 'board' ? <Columns3 size={14} /> : <List size={14} />}
                </span>
              </button>
            ))}
          </div>
        </>
      }
    >
      {/* Project and due date sit in the add row, not behind a second step:
          almost every task has both, and going back in to set them afterwards
          was the single most repeated action in the app. */}
      <div className="mb-2 flex gap-2">
        <TextInput
          ref={quickAdd}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newTitle.trim()) add.mutate()
          }}
          placeholder="Add a task and press Enter"
        />
        <Select
          value={newProjectId}
          onChange={setNewProjectId}
          placeholder="No project"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          className="w-[170px] shrink-0"
        />
        <TextInput
          type="date"
          value={newDueAt}
          onChange={(e) => setNewDueAt(e.target.value)}
          title="Due date"
          className="w-[150px] shrink-0"
        />
        <ColourDot value={newColour} onChange={setNewColour} />
        <Button
          variant="primary"
          onClick={() => add.mutate()}
          disabled={!newTitle.trim()}
          aria-label="Add task"
        >
          <Plus size={14} strokeWidth={1.75} />
        </Button>
      </div>

      <div className="mb-3 flex gap-2">
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks"
          className="max-w-[240px]"
        />
        <Select
          value={projectFilter}
          onChange={setProjectFilter}
          placeholder="All projects"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          className="w-[190px]"
        />
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="All categories"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          className="w-[180px]"
        />
      </div>

      {tasks.length === 0 ? (
        <Empty
          icon={CircleCheckBig}
          title="No tasks yet"
          body="Add one above, or open a project and add it there. Set a due date and it appears on your calendar."
        />
      ) : view === 'board' ? (
        <DndContext
          sensors={sensors}
          onDragStart={(event: DragStartEvent) =>
            setDragging(tasks.find((t) => t.id === Number(event.active.id)) ?? null)
          }
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="grid grid-cols-3 gap-3">
            {TASK_STATUSES.map((status) => (
              <Column
                key={status.value}
                status={status.value}
                label={status.label}
                tasks={visible.filter((t) => t.status === status.value)}
                onToggle={(task) => toggle.mutate(task)}
                onOpen={setOpen}
              />
            ))}
          </div>

          <DragOverlay>
            {dragging && (
              <div className="w-[280px] rotate-1 opacity-90">
                <BoardCard task={dragging} onToggle={() => {}} onOpen={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="flex max-w-[900px] flex-col gap-1">
          <AnimatePresence initial={false}>
            {visible.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                showProject
                onToggle={() => toggle.mutate(task)}
                onOpen={() => setOpen(task)}
                onArchive={() => archive.mutate(task.id)}
                onDelete={() => remove.mutate(task.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <TaskModal task={open} onClose={() => setOpen(null)} />
      <CategoryManager
        open={managingCategories}
        onClose={() => setManagingCategories(false)}
      />
    </Page>
  )
}

function Column({
  status,
  label,
  tasks,
  onToggle,
  onOpen
}: {
  status: TaskStatus
  label: string
  tasks: TaskWithContext[]
  onToggle: (task: TaskWithContext) => void
  onOpen: (task: TaskWithContext) => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[320px] flex-col rounded-card border bg-surface p-2.5 transition-colors duration-150',
        isOver ? 'border-accent bg-raised' : 'border-line'
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        <span className="numeric text-[11px] text-faint">{tasks.length}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {tasks.map((task) => (
            <DraggableCard
              key={task.id}
              task={task}
              onToggle={() => onToggle(task)}
              onOpen={() => onOpen(task)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DraggableCard({
  task,
  onToggle,
  onOpen
}: {
  task: TaskWithContext
  onToggle: () => void
  onOpen: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <BoardCard task={task} onToggle={onToggle} onOpen={onOpen} dragging={isDragging} />
    </div>
  )
}

function BoardCard({
  task,
  onToggle,
  onOpen,
  onArchive,
  dragging
}: {
  task: TaskWithContext
  onToggle: () => void
  onOpen: () => void
  onArchive?: () => void
  dragging?: boolean
}): React.JSX.Element {
  return (
    <div className={cn(dragging && 'opacity-40')}>
      <TaskRow
        task={task}
        onToggle={onToggle}
        onOpen={onOpen}
        onArchive={onArchive}
        showProject
      />
    </div>
  )
}

/** Categories are the colour-coding, so managing them lives beside the tasks. */
function CategoryManager({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [name, setName] = useState('')
  const [colour, setColour] = useState(DEFAULT_ENTITY_COLOUR)

  const { data: categories = [] } = useQuery({
    queryKey: keys.categories,
    queryFn: () => window.solo.invoke('categories:list')
  })

  const create = useMutation({
    mutationFn: () => window.solo.invoke('categories:create', { name, colour }),
    onSuccess: () => {
      invalidate(['categories', 'tasks'])
      setName('')
    }
  })

  const update = useMutation({
    mutationFn: (args: { id: number; colour: string }) =>
      window.solo.invoke('categories:update', { id: args.id, patch: { colour: args.colour } }),
    onSuccess: () => invalidate(['categories', 'tasks'])
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('categories:delete', { id }),
    onSuccess: () => invalidate(['categories', 'tasks'])
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Categories"
      description="Colour-coding for tasks. Deleting one leaves its tasks in place, uncategorised."
      width={460}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {categories.map((category) => (
          <div
            key={category.id}
            className="flex items-center gap-3 rounded-control bg-raised px-3 py-2"
          >
            <Dot colour={category.colour} />
            <span className="flex-1 text-[13px] text-ink">{category.name}</span>
            <ColourPicker
              value={category.colour}
              onChange={(next) => update.mutate({ id: category.id, colour: next })}
            />
            <button
              type="button"
              onClick={() => remove.mutate(category.id)}
              className="text-[11px] text-faint hover:text-danger"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <Field label="New category">
          <div className="flex gap-2">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) create.mutate()
              }}
              placeholder="Research"
            />
            <Button variant="primary" onClick={() => create.mutate()} disabled={!name.trim()}>
              <Plus size={14} strokeWidth={1.75} />
            </Button>
          </div>
        </Field>
        <div className="mt-2.5">
          <ColourPicker value={colour} onChange={setColour} />
        </div>
      </div>
    </Modal>
  )
}
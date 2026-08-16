import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Plus, Trash2 } from 'lucide-react'
import type { TaskInput, TaskStatus, TaskWithContext } from '@shared/types'
import { PRIORITIES, TASK_STATUSES } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { keys, useInvalidate } from '@/lib/api'
import { toDateInput } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Edits a task and its subtasks. Subtasks are ordinary tasks with a parent, so
 * they get the same fields — they are just presented inline here rather than
 * needing their own screen.
 */
export function TaskModal({
  task,
  onClose
}: {
  task: TaskWithContext | null
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<TaskWithContext | null>(task)
  const [newSubtask, setNewSubtask] = useState('')

  useEffect(() => setDraft(task), [task])

  const { data: categories = [] } = useQuery({
    queryKey: keys.categories,
    queryFn: () => window.solo.invoke('categories:list')
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const { data: subtasks = [] } = useQuery({
    queryKey: ['tasks', 'subtasks', task?.id],
    queryFn: () => window.solo.invoke('tasks:list', {}),
    enabled: task !== null,
    select: (all) => all.filter((t) => t.parentId === task?.id)
  })

  const save = useMutation({
    mutationFn: (patch: Partial<TaskInput>) =>
      window.solo.invoke('tasks:update', { id: task!.id, patch }),
    onSuccess: () => invalidate(['tasks'])
  })

  const addSubtask = useMutation({
    mutationFn: (title: string) =>
      window.solo.invoke('tasks:create', {
        title,
        parentId: task!.id,
        projectId: task!.projectId,
        categoryId: task!.categoryId
      }),
    onSuccess: () => {
      invalidate(['tasks'])
      setNewSubtask('')
    }
  })

  const toggleSubtask = useMutation({
    mutationFn: (subtask: TaskWithContext) =>
      window.solo.invoke('tasks:update', {
        id: subtask.id,
        patch: { status: subtask.status === 'done' ? 'todo' : 'done' }
      }),
    onSuccess: () => invalidate(['tasks'])
  })

  const removeSubtask = useMutation({
    mutationFn: (id: number) => window.solo.invoke('tasks:delete', { id }),
    onSuccess: () => invalidate(['tasks'])
  })

  const remove = useMutation({
    mutationFn: () => window.solo.invoke('tasks:delete', { id: task!.id }),
    onSuccess: () => {
      invalidate(['tasks'])
      onClose()
    }
  })

  /** Field edits save immediately — a task panel with a Save button invites lost edits. */
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]): void => {
    if (!draft) return
    setDraft({ ...draft, [key]: value } as TaskWithContext)
    save.mutate({ [key]: value } as Partial<TaskInput>)
  }

  return (
    <Modal
      open={task !== null}
      onClose={onClose}
      title="Task"
      width={540}
      footer={
        <>
          <Button variant="danger" size="sm" onClick={() => remove.mutate()}>
            <Trash2 size={13} strokeWidth={1.75} />
            Delete
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-3.5">
          <Field label="Title">
            <TextInput
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onBlur={(e) => save.mutate({ title: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Status">
              <Select
                value={draft.status}
                onChange={(value) => update('status', (value ?? 'todo') as TaskStatus)}
                options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              />
            </Field>
            <Field label="Priority">
              <Select
                value={draft.priority}
                onChange={(value) => update('priority', value ?? 1)}
                options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
              />
            </Field>
            <Field label="Due date">
              <TextInput
                type="date"
                value={toDateInput(draft.dueAt)}
                onChange={(e) => update('dueAt', e.target.value || null)}
              />
            </Field>
          </div>

          <Field label="Colour" hint="Overrides the category's colour for this one task.">
            <div className="flex items-center gap-3">
              <ColourPicker value={draft.colour} onChange={(colour) => update('colour', colour)} />
              {draft.colour && (
                <button
                  type="button"
                  onClick={() => update('colour', '')}
                  className="text-[11px] text-faint transition-colors hover:text-ink"
                >
                  Use the category's
                </button>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <Select
                value={draft.projectId}
                onChange={(value) => update('projectId', value)}
                placeholder="No project"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label="Category" hint="Sets the task's colour.">
              <Select
                value={draft.categoryId}
                onChange={(value) => update('categoryId', value)}
                placeholder="None"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              onBlur={(e) => save.mutate({ notes: e.target.value })}
              className="w-full resize-y rounded-control border border-line bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
            />
          </Field>

          <div className="border-t border-line pt-3.5">
            <p className="mb-2 text-[12px] font-medium text-muted">
              Subtasks {subtasks.length > 0 && `(${subtasks.filter((s) => s.status === 'done').length}/${subtasks.length})`}
            </p>

            <div className="flex flex-col gap-1">
              <AnimatePresence initial={false}>
                {subtasks.map((subtask) => (
                  <motion.div
                    key={subtask.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={transition.press}
                    className="group flex items-center gap-2 rounded-control bg-raised px-2.5 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSubtask.mutate(subtask)}
                      className={cn(
                        'grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border',
                        subtask.status === 'done'
                          ? 'border-success bg-success text-white'
                          : 'border-line-strong hover:border-muted'
                      )}
                    >
                      {subtask.status === 'done' && <Check size={10} strokeWidth={3} />}
                    </button>
                    <span
                      className={cn(
                        'flex-1 truncate text-[12.5px]',
                        subtask.status === 'done' ? 'text-faint line-through' : 'text-ink'
                      )}
                    >
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSubtask.mutate(subtask.id)}
                      className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                    >
                      <Trash2 size={12} strokeWidth={1.75} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-2 flex gap-2">
              <TextInput
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSubtask.trim()) addSubtask.mutate(newSubtask.trim())
                }}
                placeholder="Add a subtask"
                className="h-8 text-[12.5px]"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => newSubtask.trim() && addSubtask.mutate(newSubtask.trim())}
                disabled={!newSubtask.trim()}
              >
                <Plus size={13} strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
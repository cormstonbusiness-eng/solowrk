import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CircleCheckBig, Plus } from 'lucide-react'
import type { TaskWithContext } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { TICK_SETTLE_MS, transition } from '@/lib/motion'
import { QuickAddHint, useQuickAdd } from '@/components/list/QuickAdd'
import { useEntityActions } from '@/hooks/useEntityActions'
import { TaskRow } from './TaskRow'
import { TaskModal } from './TaskModal'
import { BulkBar } from '@/components/list/BulkBar'
import { useSelection } from '@/hooks/useSelection'
import { useUndo } from '@/hooks/useUndo'

/**
 * The task list for a single project, used on the project detail page. The
 * standalone Tasks page reuses TaskRow but adds its own filtering and board.
 */
export function TaskList({ projectId }: { projectId: number }): React.JSX.Element {
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState<TaskWithContext | null>(null)

  const filter = { projectId, topLevelOnly: true }
  const { data: tasks = [] } = useQuery({
    queryKey: keys.tasks(filter),
    queryFn: () => window.solo.invoke('tasks:list', filter)
  })

  const quick = useQuickAdd(title)

  const create = useMutation({
    mutationFn: () =>
      window.solo.invoke('tasks:create', {
        title: quick.parsed.title || title.trim(),
        // The project this list belongs to wins over a typed #tag: you are
        // looking at one project's tasks, and a task added here belongs to it.
        projectId,
        categoryId: quick.categoryId ?? undefined,
        dueAt: quick.dueAt,
        priority: quick.parsed.priority ?? undefined
      }),
    onSuccess: () => {
      invalidate(['tasks'])
      setTitle('')
    }
  })

  const archive = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke('tasks:update', { id, patch: { archived: true } }),
    onSuccess: () => invalidate(['tasks'])
  })

  const actions = useEntityActions()
  const { offer } = useUndo()

  const remove = useMutation({
    mutationFn: (task: { id: number; title: string }) =>
      actions.remove({ type: 'task', id: task.id }, task.title)
  })

  const toggle = useMutation({
    mutationFn: (task: TaskWithContext) =>
      window.solo.invoke('tasks:update', {
        id: task.id,
        patch: { status: task.status === 'done' ? 'todo' : 'done' }
      }),
    // Delayed on purpose — see TICK_SETTLE_MS. The row has an animation to
    // finish before it is allowed to move to the Done list.
    onSuccess: () => setTimeout(() => invalidate(['tasks']), TICK_SETTLE_MS)
  })

  const open_ = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')

  // Open first, then done — the order they are drawn in, so the drawer's
  // arrows walk the list the way the eye does, and so a Shift-range covers
  // what is between two rows on screen rather than between two ids.
  const shown = [...open_, ...done]
  const siblings = shown.map((task) => ({ type: 'task' as const, id: task.id }))
  const selection = useSelection(shown.map((task) => task.id))

  const rename = useMutation({
    mutationFn: (input: { id: number; title: string }) =>
      window.solo.invoke('tasks:update', { id: input.id, patch: { title: input.title } }),
    onSuccess: () => invalidate(['tasks'])
  })

  /**
   * Bulk actions, each as one decision with one undo.
   *
   * Archiving nine tasks is a single thing somebody did, and offering nine
   * separate undos for it would be offering to half-undo it — which is worse
   * than not offering at all.
   */
  const chosen = shown.filter((task) => selection.isSelected(task.id))

  const bulkArchive = async (): Promise<void> => {
    const ids = chosen.map((task) => task.id)
    selection.clear()
    for (const id of ids) {
      await window.solo.invoke('tasks:update', { id, patch: { archived: true } })
    }
    invalidate(['tasks'])
    offer(`Archived ${ids.length} task${ids.length === 1 ? '' : 's'}`, async () => {
      for (const id of ids) {
        await window.solo.invoke('tasks:update', { id, patch: { archived: false } })
      }
      invalidate(['tasks'])
    })
  }

  const bulkDelete = async (): Promise<void> => {
    // Through the trash, one at a time, exactly as a single delete goes —
    // which is what makes all of them restorable afterwards.
    const targets = [...chosen]
    selection.clear()
    for (const task of targets) {
      await window.solo.invoke('entity:delete', { type: 'task', id: task.id })
    }
    invalidate(['tasks'])
    offer(`Deleted ${targets.length} task${targets.length === 1 ? '' : 's'}`)
  }

  return (
    <div className="max-w-[860px]">
      <div className="mb-3 flex gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) create.mutate()
            }}
            placeholder="Draw the logo friday ~Design"
          />
          <QuickAddHint resolved={quick} />
        </div>
        <Button
          variant="primary"
          onClick={() => title.trim() && create.mutate()}
          disabled={!title.trim()}
        >
          <Plus size={14} strokeWidth={1.75} />
          Add
        </Button>
      </div>

      <Swap
        empty={tasks.length === 0}
        fallback={
          <Empty
            icon={CircleCheckBig}
            title="No tasks yet"
            body="Add the first thing that needs doing. Give tasks a category to colour-code them, and a due date to see them on the dashboard."
          />
        }
      >
        <div className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {open_.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                siblings={siblings}
                selected={selection.isSelected(task.id)}
                selectable={selection.count > 0}
                onSelect={(modifiers) => selection.click(task.id, modifiers)}
                onRename={(title) => rename.mutate({ id: task.id, title })}
                onToggle={() => toggle.mutate(task)}
                onOpen={() => setOpen(task)}
                onArchive={() => archive.mutate(task.id)}
                onDelete={() => remove.mutate(task)}
              />
            ))}
          </AnimatePresence>

          {done.length > 0 && (
            <>
              <motion.p
                layout
                transition={transition.layout}
                className="mt-3 mb-1 text-[11px] tracking-[0.08em] text-faint uppercase"
              >
                Done ({done.length})
              </motion.p>
              <AnimatePresence initial={false}>
                {done.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    siblings={siblings}
                    selected={selection.isSelected(task.id)}
                    selectable={selection.count > 0}
                    onSelect={(modifiers) => selection.click(task.id, modifiers)}
                    onToggle={() => toggle.mutate(task)}
                    onOpen={() => setOpen(task)}
                  />
                ))}
              </AnimatePresence>
            </>
          )}
        </div>
      </Swap>

      <BulkBar
        count={selection.count}
        noun="task"
        onArchive={() => void bulkArchive()}
        onDelete={() => void bulkDelete()}
        onClear={selection.clear}
      />

      <TaskModal task={open} onClose={() => setOpen(null)} />
    </div>
  )
}
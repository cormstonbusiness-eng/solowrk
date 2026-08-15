import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CircleCheckBig, Plus } from 'lucide-react'
import type { TaskWithContext } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { Empty } from '@/components/ui/Empty'
import { keys, useInvalidate } from '@/lib/api'
import { transition } from '@/lib/motion'
import { TaskRow } from './TaskRow'
import { TaskModal } from './TaskModal'

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

  const create = useMutation({
    mutationFn: (value: string) => window.solo.invoke('tasks:create', { title: value, projectId }),
    onSuccess: () => {
      invalidate(['tasks'])
      setTitle('')
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

  const open_ = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')

  return (
    <div className="max-w-[860px]">
      <div className="mb-3 flex gap-2">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) create.mutate(title.trim())
          }}
          placeholder="Add a task and press Enter"
        />
        <Button
          variant="primary"
          onClick={() => title.trim() && create.mutate(title.trim())}
          disabled={!title.trim()}
        >
          <Plus size={14} strokeWidth={1.75} />
          Add
        </Button>
      </div>

      {tasks.length === 0 ? (
        <Empty
          icon={CircleCheckBig}
          title="No tasks yet"
          body="Add the first thing that needs doing. Give tasks a category to colour-code them, and a due date to see them on the dashboard."
        />
      ) : (
        <div className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {open_.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() => toggle.mutate(task)}
                onOpen={() => setOpen(task)}
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
                    onToggle={() => toggle.mutate(task)}
                    onOpen={() => setOpen(task)}
                  />
                ))}
              </AnimatePresence>
            </>
          )}
        </div>
      )}

      <TaskModal task={open} onClose={() => setOpen(null)} />
    </div>
  )
}
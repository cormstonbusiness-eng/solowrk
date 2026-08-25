import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, ArrowLeft, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Dot, Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Archived tasks.
 *
 * The point of archiving rather than deleting is that the record survives —
 * what you did, when you finished it, and the time tracked against it. So this
 * screen is built for looking things up: search, filter by project, and restore
 * anything that turns out not to have been finished after all.
 */
export function ArchivedTasks(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<number | null>(null)

  const { data: tasks = [] } = useQuery({
    queryKey: keys.tasks({ archived: 'only' }),
    queryFn: () => window.solo.invoke('tasks:list', { archived: 'only' })
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const restore = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke('tasks:update', { id, patch: { archived: false } }),
    onSuccess: () => invalidate(['tasks'])
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('tasks:delete', { id }),
    onSuccess: () => invalidate(['tasks'])
  })

  const visible = tasks.filter((task) => {
    if (projectFilter !== null && task.projectId !== projectFilter) return false
    if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <Page
      title="Archived tasks"
      description="Finished and filed away. Everything is kept — restore anything you need back."
      actions={
        <Button variant="ghost" onClick={() => navigate('/tasks')}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back to tasks
        </Button>
      }
    >
      <Swap
        empty={tasks.length === 0}
        fallback={
          <Empty
            icon={Archive}
            title="Nothing archived"
            body="Archive a task from its hover menu, or clear a finished board in one go with “Archive done”. Nothing is deleted — subtasks, notes and tracked time all stay with it."
          />
        }
      >
        <>
          <div className="mb-3 flex gap-2">
            <div className="relative max-w-[280px] flex-1">
              <Search
                size={13}
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
              />
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search archived tasks"
                className="pl-8"
              />
            </div>
            <Select
              value={projectFilter}
              onChange={setProjectFilter}
              placeholder="All projects"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              className="w-[190px]"
            />
            <div className="flex-1" />
            <span className="self-center text-[11.5px] text-faint">
              {visible.length} of {tasks.length}
            </span>
          </div>

          {visible.length === 0 ? (
            <Empty
              icon={Search}
              title="Nothing matches"
              body="Try a different search, or clear the project filter."
            />
          ) : (
            <motion.div
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="flex max-w-[900px] flex-col gap-1"
            >
              <AnimatePresence initial={false}>
                {visible.map((task) => (
                  <motion.div
                    key={task.id}
                    layout
                    variants={listItemVariants}
                    exit={{ opacity: 0, height: 0 }}
                    transition={transition.layout}
                    style={
                      task.colour || task.categoryColour
                        ? {
                            borderLeftColor: task.colour || task.categoryColour || undefined,
                            borderLeftWidth: 2
                          }
                        : undefined
                    }
                    className="group flex items-center gap-2.5 rounded-control border border-transparent bg-raised px-2.5 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                      {task.title}
                    </span>

                    {task.projectName && (
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-faint">
                        <Dot colour={task.projectColour ?? '#5a5a63'} size={6} />
                        {task.projectName}
                      </span>
                    )}

                    <span
                      className={cn(
                        'shrink-0 text-[10.5px]',
                        task.status === 'done' ? 'text-success' : 'text-faint'
                      )}
                    >
                      {task.status === 'done' ? 'Done' : 'Unfinished'}
                    </span>

                    <span className="numeric w-[92px] shrink-0 text-right text-[11px] text-faint">
                      {formatDate(task.archivedAt)}
                    </span>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Restore ${task.title}`}
                        title="Restore to the board"
                        onClick={() => restore.mutate(task.id)}
                        className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                      >
                        <RotateCcw size={13} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${task.title}`}
                        title="Delete permanently"
                        onClick={() => remove.mutate(task.id)}
                        className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                      >
                        <Trash2 size={13} strokeWidth={1.75} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </>
      </Swap>
    </Page>
  )
}

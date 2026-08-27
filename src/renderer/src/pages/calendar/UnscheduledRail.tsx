import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Inbox, Search, Wand2 } from 'lucide-react'
import type { TaskWithContext } from '@shared/types'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'
import { cn } from '@/lib/utils'
import { transition } from '@/lib/motion'
import { durationLabel } from './grid'

/**
 * What has not been given a time yet.
 *
 * The rail exists because the honest answer to "when am I doing this?" is
 * usually "I have not decided", and a to-do list with no diary beside it lets
 * that stay unanswered indefinitely. Dragging from here onto the grid is the
 * moment of deciding, and it is the only gesture the rail has.
 */
export const RAIL_WIDTH = 260

export function UnscheduledRail({
  today,
  fillable,
  onDragTask,
  onFillGaps
}: {
  today: string
  /** How many of these would fit in this week's holes. Zero hides the offer. */
  fillable: number
  /** Called on press; the grid takes over from there. */
  onDragTask: (task: TaskWithContext, event: React.PointerEvent) => void
  onFillGaps: () => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')

  const { data: tasks = [], isPending } = useQuery({
    queryKey: ['calendar', 'unscheduled', search],
    queryFn: () => window.solo.invoke('calendar:unscheduled', search ? { search } : undefined)
  })

  /**
   * Grouped by project, because that is how the work is thought about — and
   * because a flat list of thirty tasks from four projects is a list nobody
   * reads to the bottom of.
   */
  const groups = useMemo(() => {
    const byProject = new Map<string, { name: string; colour: string; tasks: TaskWithContext[] }>()
    for (const task of tasks) {
      const key = task.projectName ?? ''
      const group = byProject.get(key) ?? {
        name: task.projectName ?? 'No project',
        colour: task.projectColour ?? '',
        tasks: []
      }
      group.tasks.push(task)
      byProject.set(key, group)
    }
    // Unattached work last: it is real, but it is not what a week is built
    // around, and it should not head the list.
    return [...byProject.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([, group]) => group)
  }, [tasks])

  return (
    <aside
      style={{ width: RAIL_WIDTH }}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-card border border-line"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <span className="text-[11px] tracking-[0.06em] text-faint uppercase">Unscheduled</span>
        <span className="numeric text-[11px] text-faint">{tasks.length}</span>
      </div>

      <div className="relative shrink-0 border-b border-line px-2 py-1.5">
        <Search
          size={12}
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a task"
          className="w-full rounded-control bg-raised py-1 pr-2 pl-7 text-[12px] text-ink placeholder:text-faint focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isPending ? null : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <Inbox size={18} strokeWidth={1.5} className="text-faint" />
            <p className="text-[12px] text-muted">
              {search ? 'Nothing matching.' : 'Everything has a time on it.'}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.name} className="mb-3 last:mb-0">
              <p className="mb-1 flex items-center gap-1.5 px-1 text-[10.5px] tracking-[0.05em] text-faint uppercase">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: group.colour || DEFAULT_ENTITY_COLOUR }}
                />
                <span className="truncate">{group.name}</span>
              </p>

              <div className="flex flex-col gap-1">
                {group.tasks.map((task) => {
                  const late = task.dueAt !== null && task.dueAt.slice(0, 10) < today
                  return (
                    <motion.div
                      key={task.id}
                      layout
                      transition={transition.layout}
                      onPointerDown={(event) => onDragTask(task, event)}
                      className={cn(
                        'cursor-grab rounded-control border border-line bg-raised px-2 py-1.5',
                        'transition-colors select-none hover:border-line-strong active:cursor-grabbing'
                      )}
                    >
                      <p className="truncate text-[12.5px] text-ink">{task.title}</p>

                      {(task.estimateMinutes !== null || task.dueAt) && (
                        <p className="numeric mt-0.5 flex items-center gap-2 text-[10.5px]">
                          {task.estimateMinutes !== null && (
                            <span className="text-faint">
                              {durationLabel(task.estimateMinutes)}
                            </span>
                          )}
                          {task.dueAt && (
                            <span className={late ? 'text-danger' : 'text-faint'}>
                              {late ? 'Late' : `Due ${task.dueAt.slice(8, 10)}/${task.dueAt.slice(5, 7)}`}
                            </span>
                          )}
                        </p>
                      )}
                    </motion.div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Gaps only, never moving what is already committed — §18's fourth
          decision, answered cautiously on purpose. It says how many it can
          place before it places any, because a button that silently did a
          different amount of work each time is one nobody presses twice. */}
      {fillable > 0 ? (
        <button
          type="button"
          onClick={onFillGaps}
          className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line px-3 py-2 text-[11.5px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <Wand2 size={12} strokeWidth={1.75} />
          Fit {fillable} into this week&rsquo;s gaps
        </button>
      ) : (
        <p className="shrink-0 border-t border-line px-3 py-1.5 text-[10.5px] text-faint">
          Drag onto the grid to schedule
        </p>
      )}
    </aside>
  )
}

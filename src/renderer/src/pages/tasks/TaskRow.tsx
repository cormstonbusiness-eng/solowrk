import { motion } from 'motion/react'
import { Check, ChevronRight, GripVertical } from 'lucide-react'
import type { TaskWithContext } from '@shared/types'
import { PRIORITIES } from '@shared/types'
import { Dot } from '@/components/ui/Empty'
import { describeDue } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

const dueTone = {
  danger: 'text-danger',
  warning: 'text-warning',
  muted: 'text-faint'
} as const

/**
 * One task, used by both the list and the board. Colour comes from the
 * category, which is the thing the user actually assigns a colour to.
 */
export function TaskRow({
  task,
  onToggle,
  onOpen,
  showProject,
  dragHandle,
  dragging
}: {
  task: TaskWithContext
  onToggle: () => void
  onOpen: () => void
  showProject?: boolean
  dragHandle?: React.ReactNode
  dragging?: boolean
}): React.JSX.Element {
  const done = task.status === 'done'
  const due = describeDue(task.dueAt)
  const priority = PRIORITIES.find((p) => p.value === task.priority)

  return (
    <motion.div
      layout
      transition={transition.layout}
      className={cn(
        'group flex items-center gap-2.5 rounded-control border border-transparent bg-raised px-2.5 py-2',
        'transition-colors duration-150 hover:border-line-strong',
        dragging && 'opacity-40'
      )}
    >
      {dragHandle && (
        <span className="cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
          {dragHandle ?? <GripVertical size={13} />}
        </span>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={cn(
          'grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border transition-colors duration-150',
          done ? 'border-success bg-success text-white' : 'border-line-strong hover:border-muted'
        )}
      >
        {done && <Check size={11} strokeWidth={3} />}
      </button>

      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            'truncate text-left text-[13px]',
            done ? 'text-faint line-through' : 'text-ink'
          )}
        >
          {task.title}
        </span>

        {task.subtaskCount > 0 && (
          <span className="numeric shrink-0 text-[10.5px] text-faint">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-2.5">
        {task.priority >= 2 && priority && (
          <span style={{ color: priority.colour }} className="text-[10.5px] font-medium">
            {priority.label}
          </span>
        )}

        {showProject && task.projectName && (
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <Dot colour={task.projectColour ?? '#8a8a93'} size={6} />
            {task.projectName}
          </span>
        )}

        {task.categoryName && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <Dot colour={task.categoryColour ?? '#8a8a93'} size={6} />
            {task.categoryName}
          </span>
        )}

        {task.dueAt && !done && (
          <span className={cn('text-[11px]', dueTone[due.tone])}>{due.label}</span>
        )}

        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className="text-faint opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    </motion.div>
  )
}
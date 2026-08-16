import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Archive } from 'lucide-react'
import type { ProjectStatus, ProjectSummary } from '@shared/types'
import { PROJECT_STATUSES } from '@shared/types'
import { Dot } from '@/components/ui/Empty'
import { describeDue } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Three columns over five statuses.
 *
 * The board is about *where a job is*, and there are only three answers to
 * that: not begun, being worked on, finished. `on_hold` and `cancelled` are
 * still worth recording, so they keep their status and show as a badge inside
 * the column they belong to, rather than earning columns of their own that sit
 * empty most of the time.
 */
export const COLUMNS: {
  id: 'not_started' | 'in_progress' | 'done'
  label: string
  statuses: ProjectStatus[]
  /** Where a card dropped in this column lands. */
  drop: ProjectStatus
}[] = [
  { id: 'not_started', label: 'Not started', statuses: ['planned'], drop: 'planned' },
  {
    id: 'in_progress',
    label: 'In progress',
    statuses: ['active', 'on_hold'],
    drop: 'active'
  },
  {
    id: 'done',
    label: 'Done',
    statuses: ['completed', 'cancelled'],
    drop: 'completed'
  }
]

const DRAG_THRESHOLD = 4

export function ProjectBoard({
  projects,
  onMove,
  onArchive
}: {
  projects: ProjectSummary[]
  onMove: (project: ProjectSummary, status: ProjectStatus) => void
  onArchive: (project: ProjectSummary) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-3">
      {COLUMNS.map((column) => {
        const cards = projects.filter((project) => column.statuses.includes(project.status))

        return (
          <div
            key={column.id}
            data-column={column.drop}
            className="flex min-h-[220px] flex-col rounded-card border border-line bg-surface/40 p-2"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] tracking-[0.08em] text-faint uppercase">
                {column.label}
              </span>
              <span className="numeric text-[11px] text-faint">{cards.length}</span>
            </div>

            <motion.div
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col gap-1.5"
            >
              {cards.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onMove={onMove}
                  onArchive={() => onArchive(project)}
                />
              ))}
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}

function ProjectCard({
  project,
  onMove,
  onArchive
}: {
  project: ProjectSummary
  onMove: (project: ProjectSummary, status: ProjectStatus) => void
  onArchive: () => void
}): React.JSX.Element {
  const due = describeDue(project.dueOn)
  const status = PROJECT_STATUSES.find((entry) => entry.value === project.status)
  // Only worth showing when it says something the column does not already.
  const badge = project.status === 'on_hold' || project.status === 'cancelled' ? status : null

  /**
   * Pointer-based drag, as elsewhere in the app: the drop target is just the
   * column under the cursor, which `elementFromPoint` answers directly, and a
   * pointer that never moves leaves the card's link behaviour intact.
   */
  function startDrag(event: React.PointerEvent): void {
    if (event.button !== 0) return

    const originX = event.clientX
    const originY = event.clientY
    let moved = false
    let target: ProjectStatus | null = null

    const onPointerMove = (move: PointerEvent): void => {
      if (!moved && Math.hypot(move.clientX - originX, move.clientY - originY) < DRAG_THRESHOLD) {
        return
      }
      moved = true
      const column = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>('[data-column]')
      target = (column?.dataset.column as ProjectStatus | undefined) ?? null
    }

    const onPointerUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      if (!moved) return
      // A real drag happened, so this is not a click on the link either.
      up.preventDefault()
      if (target && target !== project.status) onMove(project, target)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  return (
    <motion.div layout variants={listItemVariants} transition={transition.layout}>
      <div
        onPointerDown={startDrag}
        style={{ borderLeftColor: project.colour, borderLeftWidth: 2 }}
        className={cn(
          'group relative rounded-control border border-transparent bg-raised px-2.5 py-2',
          'cursor-grab transition-colors hover:border-line-strong active:cursor-grabbing'
        )}
      >
        <Link to={`/projects/${project.id}`} className="block" draggable={false}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-ink">{project.name}</p>
              <p className="truncate text-[11px] text-faint">
                {project.clientName ?? 'Internal'}
              </p>
            </div>
            <Dot colour={project.colour} size={7} />
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            {badge && (
              <span style={{ color: badge.colour }} className="text-[10.5px] font-medium">
                {badge.label}
              </span>
            )}
            {project.dueOn && (
              <span
                className={cn(
                  'text-[10.5px]',
                  due.tone === 'danger'
                    ? 'text-danger'
                    : due.tone === 'warning'
                      ? 'text-warning'
                      : 'text-faint'
                )}
              >
                {due.label}
              </span>
            )}
            <span className="numeric ml-auto text-[10.5px] text-muted">
              {project.openTaskCount}/{project.taskCount}
            </span>
          </div>
        </Link>

        <button
          type="button"
          aria-label={`Archive ${project.name}`}
          title="Archive — keeps everything, hides it from here"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onArchive()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute top-1.5 right-1.5 rounded-[5px] bg-surface p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
        >
          <Archive size={12} strokeWidth={1.75} />
        </button>
      </div>
    </motion.div>
  )
}

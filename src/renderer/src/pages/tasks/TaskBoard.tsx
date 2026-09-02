import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { AnimatePresence } from 'motion/react'
import type { TaskStatus, TaskWithContext } from '@shared/types'
import { TASK_STATUSES } from '@shared/types'
import { cn } from '@/lib/utils'
import { TaskRow } from './TaskRow'

/**
 * The task board: three columns, drag a card between them.
 *
 * The columns are `TASK_STATUSES` rather than a list of its own, so "to do,
 * doing, done" is defined once and the board cannot drift from the status a
 * task actually holds. There is no fourth column and no hidden state — where a
 * card sits *is* its status, which is the whole point of looking at a board
 * instead of a list.
 *
 * Lifted out of the Tasks page so a single project can show the same board
 * over its own tasks. Two implementations of the same gesture would be two
 * things to keep in step, and the one inside a project would have been the one
 * that quietly fell behind.
 *
 * Deliberately has no opinion about where the tasks came from, how they are
 * filtered, or what happens after a move. It renders what it is given and
 * reports the drop.
 */
export function TaskBoard({
  tasks,
  onMove,
  onToggle,
  onOpen,
  showProject = true
}: {
  tasks: TaskWithContext[]
  /** Called only when the card actually changes column. */
  onMove: (task: TaskWithContext, status: TaskStatus) => void
  onToggle: (task: TaskWithContext) => void
  onOpen: (task: TaskWithContext) => void
  /**
   * Off inside a single project, where naming it on every card is the same
   * word repeated down the screen and tells nobody anything they did not
   * already know from the heading.
   */
  showProject?: boolean
}): React.JSX.Element {
  const [dragging, setDragging] = useState<TaskWithContext | null>(null)

  const sensors = useSensors(
    // A small distance threshold so clicking a task opens it instead of
    // starting a drag the user did not intend.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function onDragEnd(event: DragEndEvent): void {
    setDragging(null)
    const status = event.over?.id as TaskStatus | undefined
    const task = tasks.find((entry) => entry.id === Number(event.active.id))
    // A drop back into the column it came from is not a move, and treating it
    // as one would write to the database every time somebody picked a card up
    // and thought better of it.
    if (!status || !task || task.status === status) return
    onMove(task, status)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) =>
        setDragging(tasks.find((entry) => entry.id === Number(event.active.id)) ?? null)
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
            tasks={tasks.filter((task) => task.status === status.value)}
            onToggle={onToggle}
            onOpen={onOpen}
            showProject={showProject}
          />
        ))}
      </div>

      {/*
        The card follows the cursor at a slight angle, which is the one bit of
        theatre on the board. It reads as "picked up" rather than "sliding",
        and it makes the drop target underneath easier to see.
      */}
      <DragOverlay>
        {dragging && (
          <div className="w-[240px] rotate-1 opacity-90">
            <BoardCard
              task={dragging}
              onToggle={() => {}}
              onOpen={() => {}}
              showProject={showProject}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  status,
  label,
  tasks,
  onToggle,
  onOpen,
  showProject
}: {
  status: TaskStatus
  label: string
  tasks: TaskWithContext[]
  onToggle: (task: TaskWithContext) => void
  onOpen: (task: TaskWithContext) => void
  showProject: boolean
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
              showProject={showProject}
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
  onOpen,
  showProject
}: {
  task: TaskWithContext
  onToggle: () => void
  onOpen: () => void
  showProject: boolean
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <BoardCard
        task={task}
        onToggle={onToggle}
        onOpen={onOpen}
        dragging={isDragging}
        showProject={showProject}
      />
    </div>
  )
}

function BoardCard({
  task,
  onToggle,
  onOpen,
  dragging,
  showProject = true
}: {
  task: TaskWithContext
  onToggle: () => void
  onOpen: () => void
  dragging?: boolean
  showProject?: boolean
}): React.JSX.Element {
  return (
    <div className={cn(dragging && 'opacity-40')}>
      <TaskRow task={task} onToggle={onToggle} onOpen={onOpen} showProject={showProject} stacked />
    </div>
  )
}

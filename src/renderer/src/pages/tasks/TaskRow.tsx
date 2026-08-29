import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Archive, Check, ChevronRight, GripVertical, Trash2 } from 'lucide-react'
import type { EntityRef, TaskWithContext } from '@shared/types'
import { PRIORITIES } from '@shared/types'
import { Dot } from '@/components/ui/Empty'
import { Inspect } from '@/components/detail/Inspect'
import { StruckText, Tickbox } from '@/components/ui/Tickbox'
import { InlineEdit } from '@/components/list/InlineEdit'
import { describeDue } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

const dueTone = {
  danger: 'text-danger',
  warning: 'text-warning',
  muted: 'text-faint'
} as const

/**
 * One task, used by both the list and the board. The left edge carries its
 * colour: the task's own if it has one, otherwise its category's.
 *
 * Two layouts, because the two places are not the same shape. The list is one
 * wide line and can afford to set the title and everything about it side by
 * side. A board column is about 250px, which is narrower than a good many
 * titles on their own — so `stacked` gives the title the full width and drops
 * the rest onto a second line beneath it.
 *
 * This is what the board used to get wrong. It rendered the list row as-is and
 * the row simply overflowed, painting the title across the column beside it.
 */
export function TaskRow({
  task,
  onToggle,
  onOpen,
  onDelete,
  onArchive,
  onRename,
  onSelect,
  selected,
  selectable,
  showProject,
  stacked,
  dragHandle,
  dragging,
  siblings
}: {
  task: TaskWithContext
  onToggle: () => void
  onOpen: () => void
  /** Omit and the title is not editable in place. */
  onRename?: (title: string) => void
  /** Omit and the row shows no checkbox and cannot be picked. */
  onSelect?: (modifiers: { shift?: boolean; toggle?: boolean }) => void
  selected?: boolean
  /** True once anything is selected: the boxes stop hiding on hover. */
  selectable?: boolean
  /** The rows the drawer's arrows walk. Omit and there are simply no arrows. */
  siblings?: EntityRef[]
  /** Omit to hide the hover delete. */
  onDelete?: () => void
  /** Omit to hide the hover archive. */
  onArchive?: () => void
  showProject?: boolean
  /** Title on its own lines, everything else beneath. For narrow columns. */
  stacked?: boolean
  dragHandle?: React.ReactNode
  dragging?: boolean
}): React.JSX.Element {
  const settled = task.status === 'done'

  /**
   * What the tick shows, which is not always what the database says yet.
   *
   * A checkbox that waits for a round trip before it moves is a checkbox people
   * click twice. This one commits to the answer immediately and lets the write
   * catch up — and because ticking a task is what makes it leave the list, the
   * row it is drawn on may well be on its way out by the time the write lands.
   * The tick has to have finished by then.
   */
  const [pending, setPending] = useState<boolean | null>(null)
  const done = pending ?? settled

  // Once the database agrees, stop overriding it — otherwise a task changed
  // somewhere else in the app would be stuck showing this row's last guess.
  useEffect(() => {
    if (pending !== null && pending === settled) setPending(null)
  }, [pending, settled])

  const due = describeDue(task.dueAt)
  const priority = PRIORITIES.find((p) => p.value === task.priority)
  // The task's own colour wins over its category's — someone who colours one
  // task red means that task, not everything in its category.
  const stripe = task.colour || task.categoryColour || ''

  /* The pieces, built once and arranged twice. ------------------------- */

  /* Hidden until the row is hovered, and then permanently once anything is
     selected — a checkbox that vanished mid-selection would make picking the
     next row a hunt. */
  const pick = onSelect && (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected === true}
      aria-label={`Select ${task.title}`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect({ shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey })
      }}
      className={cn(
        'grid size-[15px] shrink-0 place-items-center rounded-[3px] border transition-all',
        selected
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line-strong text-transparent hover:border-accent',
        selected || selectable ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      )}
    >
      <Check size={10} strokeWidth={3} />
    </button>
  )

  const grip = dragHandle && (
    <span className="cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
      {dragHandle ?? <GripVertical size={13} />}
    </span>
  )

  const tick = (
    <Tickbox
      done={done}
      label={task.title}
      onToggle={() => {
        setPending(!done)
        onToggle()
      }}
    />
  )

  const title = onRename ? (
    // Click the title to change it. No edit mode, no Save button — the row
    // opens on the chevron and the drawer, so the title is free to be the
    // control it looks like.
    <InlineEdit
      value={task.title}
      label={`Rename ${task.title}`}
      onSave={onRename}
      className={cn(
        // `min-w-0` is what lets it give way. A flex item defaults to
        // `min-width: auto`, so without this the title refuses to shrink past
        // its own text and pushes the row out of whatever contains it.
        'min-w-0 flex-1 text-[13px]',
        stacked ? 'break-words' : 'truncate',
        done && 'text-faint line-through'
      )}
    />
  ) : (
    <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
      <StruckText done={done} wrap={stacked} className="text-[13px]">
        {task.title}
      </StruckText>
    </button>
  )

  const subtasks = task.subtaskCount > 0 && (
    <span className="numeric shrink-0 text-[10.5px] text-faint">
      {task.subtaskDoneCount}/{task.subtaskCount}
    </span>
  )

  const tags = (
    <>
      {task.priority >= 2 && priority && (
        <span style={{ color: priority.colour }} className="shrink-0 text-[10.5px] font-medium">
          {priority.label}
        </span>
      )}

      {showProject && task.projectName && (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
          <Dot colour={task.projectColour ?? '#8a8a93'} size={6} />
          <span className="truncate">{task.projectName}</span>
        </span>
      )}

      {task.categoryName && (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <Dot colour={task.categoryColour ?? '#8a8a93'} size={6} />
          <span className="truncate">{task.categoryName}</span>
        </span>
      )}

      {task.dueAt && !done && (
        <span className={cn('shrink-0 text-[11px]', dueTone[due.tone])}>{due.label}</span>
      )}
    </>
  )

  const actions = (
    <>
      {onArchive && (
        <button
          type="button"
          aria-label={`Archive ${task.title}`}
          title="Archive — keeps everything, takes it off the board"
          onClick={(event) => {
            event.stopPropagation()
            onArchive()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
        >
          <Archive size={13} strokeWidth={1.75} />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${task.title}`}
          onClick={(event) => {
            // The row opens the task; this must not do both.
            event.stopPropagation()
            onDelete()
          }}
          className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      )}

      <span onPointerDown={(event) => event.stopPropagation()}>
        <Inspect subject={{ type: 'task', id: task.id }} siblings={siblings} label={task.title} />
      </span>

      {/* The way in.
          It used to be the title, and the title is now the rename control —
          so this had to stop being decoration and become the thing it has
          always looked like. A row with no way to open it is what you get
          if inline editing is added and nobody checks. */}
      <button
        type="button"
        aria-label={`Open ${task.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="rounded-control p-0.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
      >
        <ChevronRight size={14} strokeWidth={1.75} />
      </button>
    </>
  )

  /* ------------------------------------------------------------------- */

  const shell = cn(
    'group rounded-control border border-transparent bg-raised px-2.5 py-2',
    'transition-colors duration-150 hover:border-line-strong',
    dragging && 'opacity-40',
    selected && 'border-accent bg-accent-subtle'
  )

  if (stacked) {
    return (
      <motion.div
        layout
        exit={{ opacity: 0, scale: 0.98 }}
        transition={transition.layout}
        style={stripe ? { borderLeftColor: stripe, borderLeftWidth: 2 } : undefined}
        className={cn(shell, 'flex flex-col gap-1.5 overflow-hidden')}
      >
        {/* `items-start` so the tick stays level with the first line of a title
            that runs to three, rather than drifting to the middle of the card. */}
        <div className="flex items-start gap-2.5">
          {pick}
          {grip}
          {tick}
          {title}
        </div>

        {/* Indented past the tick so it reads as belonging to the title above,
            and wrapping rather than overflowing: on a card there is a second
            line to spare. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[27px]">
          {tags}
          {subtasks}
          <span className="ml-auto flex shrink-0 items-center gap-2.5">{actions}</span>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      layout
      // Leaving is a fade in place, not a collapse. The rows above and below
      // close the gap themselves through their own layout animation, which
      // keeps the list moving as one thing rather than as a hole opening.
      exit={{ opacity: 0, scale: 0.98 }}
      transition={transition.layout}
      style={stripe ? { borderLeftColor: stripe, borderLeftWidth: 2 } : undefined}
      className={cn(shell, 'flex items-center gap-2.5')}
    >
      {pick}
      {grip}
      {tick}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {title}
        {subtasks}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {tags}
        {actions}
      </div>
    </motion.div>
  )
}

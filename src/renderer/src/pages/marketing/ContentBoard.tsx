import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import type { ContentItemWithContext, ContentStatus } from '@shared/types'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Content by how far along it is.
 *
 * §6.1's pipeline, in the order work actually moves: an idea becomes a draft,
 * a draft becomes ready, ready gets a date, and a date eventually becomes a
 * thing that went out. Parked sits apart at the end, collapsed — it is where
 * things go to stop, and giving it a column of equal weight would make a
 * shelved idea look like a stage of production.
 */

const COLUMNS: { value: ContentStatus; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'drafting', label: 'Drafting' },
  { value: 'ready', label: 'Ready' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' }
]

export function ContentBoard({
  items,
  hidden,
  onOpen,
  onMove
}: {
  items: ContentItemWithContext[]
  hidden: Set<number>
  onOpen: (item: ContentItemWithContext) => void
  onMove: (input: { id: number; status: ContentStatus }) => void
}): React.JSX.Element {
  const [showParked, setShowParked] = useState(false)

  // 4px, so a click opens a card rather than nudging it into the next column.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const visible = items.filter((item) => item.channelId === null || !hidden.has(item.channelId))
  const parked = visible.filter((item) => item.status === 'parked')

  function onDragEnd(event: DragEndEvent): void {
    const status = event.over?.id as ContentStatus | undefined
    const id = Number(event.active.id)
    if (!status) return

    const item = visible.find((one) => one.id === id)
    if (!item || item.status === status) return

    onMove({ id, status })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((column) => (
          <Column
            key={column.value}
            status={column.value}
            label={column.label}
            items={visible.filter((item) => item.status === column.value)}
            onOpen={onOpen}
          />
        ))}

        {/* Parked, kept out of the way but never out of reach — a shelved idea
            you cannot find again might as well have been deleted. */}
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowParked((open) => !open)}
            className="flex items-center gap-1.5 px-1 text-[12px] text-faint transition-colors hover:text-ink"
          >
            <ChevronRight
              size={12}
              strokeWidth={2}
              className={cn('transition-transform', showParked && 'rotate-90')}
            />
            Parked
            <span className="numeric text-[11px] text-disabled">{parked.length}</span>
          </button>

          {showParked && (
            <Column status="parked" label="" items={parked} onOpen={onOpen} bare />
          )}
        </div>
      </div>
    </DndContext>
  )
}

function Column({
  status,
  label,
  items,
  onOpen,
  bare
}: {
  status: ContentStatus
  label: string
  items: ContentItemWithContext[]
  onOpen: (item: ContentItemWithContext) => void
  /** The parked column, whose header is the disclosure button above it. */
  bare?: boolean
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div ref={setNodeRef} className="flex w-[220px] shrink-0 flex-col gap-2">
      {!bare && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[12px] text-ink">{label}</span>
          <span className="numeric ml-auto text-[11px] text-faint">{items.length}</span>
        </div>
      )}

      {/*
        An empty column draws nothing but its header, and a drop zone only
        while something is over it. §11 is blunt about why: six permanently
        outlined empty boxes was most of the visual noise on the old board.
      */}
      <motion.div
        variants={listVariants}
        initial="hidden"
        animate="visible"
        className={cn(
          'flex min-h-[60px] flex-col gap-1.5 rounded-card p-1 transition-colors',
          isOver && 'bg-hover ring-1 ring-accent/40 ring-inset'
        )}
      >
        {items.map((item) => (
          <Card key={item.id} item={item} onOpen={onOpen} />
        ))}
      </motion.div>
    </div>
  )
}

function Card({
  item,
  onOpen
}: {
  item: ContentItemWithContext
  onOpen: (item: ContentItemWithContext) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id })

  return (
    <motion.button
      ref={setNodeRef}
      variants={listItemVariants}
      type="button"
      onClick={() => onOpen(item)}
      {...listeners}
      {...attributes}
      style={{
        borderLeftColor: item.channelColour,
        borderLeftWidth: 3,
        ...(transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : {})
      }}
      className={cn(
        'flex flex-col gap-1 rounded-control border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong',
        isDragging && 'z-10 opacity-90 shadow-lg'
      )}
    >
      <span className="truncate text-[12.5px] text-ink">{item.title || 'Untitled'}</span>

      {item.hook.trim() !== '' && (
        <span className="line-clamp-2 text-[11px] leading-snug text-faint">{item.hook}</span>
      )}

      <span className="flex items-center gap-2 text-[10.5px] text-disabled">
        {item.channelName !== '' && <span className="truncate">{item.channelName}</span>}
        {item.scheduledFor && (
          <span className="numeric ml-auto shrink-0">{item.scheduledFor.slice(5, 10)}</span>
        )}
      </span>
    </motion.button>
  )
}

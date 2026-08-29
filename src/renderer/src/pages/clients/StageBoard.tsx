import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { useMutation } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { Client, RelationshipStage } from '@shared/types'
import { CLIENT_STAGES } from '@shared/types'
import { useInvalidate } from '@/lib/api'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Clients by where they stand.
 *
 * This is the pipeline that used to live in Marketing. It was built there as a
 * lead tracker, which is a sales function — marketing is where a freelancer
 * plans how work gets *found*, and sales is what happens after somebody puts
 * their hand up. Moving it here means a person exists in one place rather than
 * two, and it is the same board it always was, over clients instead of leads.
 *
 * What did not come with it is the lead's next-action discipline: a client has
 * no next action to be adrift from, and inventing one would put a red flag on
 * every client somebody has ever finished working with. The commitment that
 * replaces it lives in Marketing, against channels rather than people.
 */

const STAGE_TINT: Record<RelationshipStage, string> = {
  lead: 'bg-line-strong',
  prospect: 'bg-warning',
  active: 'bg-success',
  dormant: 'bg-accent',
  former: 'bg-danger'
}

export function StageBoard({
  clients,
  onOpen
}: {
  clients: Client[]
  onOpen: (id: number) => void
}): React.JSX.Element {
  const invalidate = useInvalidate()

  const move = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: RelationshipStage }) =>
      window.solo.invoke('clients:update', { id, patch: { relationshipStage: stage } }),
    onSuccess: () => invalidate(['clients'])
  })

  // 4px, so a click on a card opens it rather than nudging it into the next
  // column. Below that, an ordinary click reads as a drag on a trackpad.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function onDragEnd(event: DragEndEvent): void {
    const stage = event.over?.id as RelationshipStage | undefined
    const id = Number(event.active.id)
    if (!stage) return

    const client = clients.find((one) => one.id === id)
    if (!client || client.relationshipStage === stage) return

    move.mutate({ id, stage })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {CLIENT_STAGES.map((stage) => (
          <Column
            key={stage.value}
            stage={stage.value}
            label={stage.label}
            clients={clients.filter((client) => client.relationshipStage === stage.value)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </DndContext>
  )
}

function Column({
  stage,
  label,
  clients,
  onOpen
}: {
  stage: RelationshipStage
  label: string
  clients: Client[]
  onOpen: (id: number) => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  return (
    <div ref={setNodeRef} className="flex w-[220px] shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_TINT[stage])} />
        <span className="text-[12px] text-ink">{label}</span>
        <span className="numeric ml-auto text-[11px] text-faint">{clients.length}</span>
      </div>

      {/*
        An empty column draws nothing but its header, and a drop zone only
        while something is being dragged over it. Five permanently outlined
        empty boxes is most of the visual noise on a board this shape.
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
        {clients.map((client) => (
          <Card key={client.id} client={client} onOpen={onOpen} />
        ))}
      </motion.div>
    </div>
  )
}

function Card({
  client,
  onOpen
}: {
  client: Client
  onOpen: (id: number) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: client.id
  })

  return (
    <motion.button
      ref={setNodeRef}
      variants={listItemVariants}
      type="button"
      onClick={() => onOpen(client.id)}
      {...listeners}
      {...attributes}
      // `transform` only while dragging — never `top` or `left`, which the
      // browser cannot composite and which judder on a long column.
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        'flex flex-col gap-0.5 rounded-control border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong',
        isDragging && 'z-10 opacity-90 shadow-lg'
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: client.colour }}
        />
        <span className="truncate text-[12.5px] text-ink">{client.name}</span>
      </span>

      {client.contactName.trim() !== '' && (
        <span className="truncate pl-3.5 text-[11px] text-faint">{client.contactName}</span>
      )}
    </motion.button>
  )
}

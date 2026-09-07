import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { GripVertical, Lock, Maximize2, Minimize2, Plus, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useFeature } from '@/lib/features'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { MODULE_IDS, REGISTRY, type ModuleId } from './modules'
import type { Slot } from './layout'

/** How far the pointer must travel before this is a drag and not a click. */
const DRAG_THRESHOLD = 5

/**
 * The dashboard grid: what is on it, in what order, at what size.
 *
 * Three columns. A compact module takes one and a detailed one takes two, which
 * is the whole sizing model — see `modules.tsx` for why it is two fixed sizes
 * rather than a resize handle.
 *
 * Reordering is the same pointer-drag the project and client boards use:
 * `elementFromPoint` answers what is under the cursor, and a movement threshold
 * means a pointer that never travels leaves the module's own buttons working.
 * Nothing is dragged visually — `motion`'s `layout` animates the reflow, so the
 * cards move under the cursor rather than a ghost being carried across them.
 */
export function Grid({
  slots,
  onChange
}: {
  slots: Slot[]
  onChange: (next: Slot[]) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState<ModuleId | null>(null)
  const [adding, setAdding] = useState(false)

  const used = new Set(slots.map((slot) => slot.id))
  const available = MODULE_IDS.filter((id) => !used.has(id))

  function move(id: ModuleId, toIndex: number): void {
    const from = slots.findIndex((slot) => slot.id === id)
    if (from === -1 || from === toIndex) return

    const next = [...slots]
    const [moved] = next.splice(from, 1)
    next.splice(toIndex, 0, moved!)
    onChange(next)
  }

  function startDrag(event: React.PointerEvent, id: ModuleId): void {
    if (event.button !== 0) return

    const originX = event.clientX
    const originY = event.clientY
    let moved = false

    const onPointerMove = (point: PointerEvent): void => {
      if (!moved && Math.hypot(point.clientX - originX, point.clientY - originY) < DRAG_THRESHOLD) {
        return
      }

      if (!moved) {
        moved = true
        setDragging(id)
      }

      /*
        The slot under the cursor, read from the DOM rather than tracked in
        state. The cards reflow as the order changes, so anything computed up
        front would be describing a layout that no longer exists by the time
        the pointer arrives.
      */
      const over = document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest<HTMLElement>('[data-slot-index]')

      const index = over?.dataset.slotIndex
      if (index !== undefined) move(id, Number(index))
    }

    const onPointerUp = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      setDragging(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  return (
    <>
      <div className="grid grid-cols-3 items-start gap-4">
        {slots.map((slot, index) => (
          <ModuleCard
            key={slot.id}
            slot={slot}
            index={index}
            dragging={dragging === slot.id}
            onDragStart={(event) => startDrag(event, slot.id)}
            onResize={() =>
              onChange(
                slots.map((entry) =>
                  entry.id === slot.id
                    ? { ...entry, size: entry.size === 'compact' ? 'detailed' : 'compact' }
                    : entry
                )
              )
            }
            onRemove={() => onChange(slots.filter((entry) => entry.id !== slot.id))}
          />
        ))}

        {/*
          The add button is a cell in the grid rather than a header action, so
          it sits at the end of the modules and reads as "another one of these"
          instead of a page-level control that happens to be nearby.
        */}
        {available.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'flex min-h-[104px] items-center justify-center gap-2 rounded-card',
              'border border-dashed border-line text-[12.5px] text-faint',
              'transition-colors hover:border-line-strong hover:bg-raised hover:text-muted'
            )}
          >
            <Plus size={15} strokeWidth={1.75} />
            Add a module
          </button>
        )}
      </div>

      <AddMenu
        open={adding}
        available={available}
        onClose={() => setAdding(false)}
        onAdd={(id) => {
          onChange([...slots, { id, size: 'compact' }])
          setAdding(false)
        }}
      />
    </>
  )
}

function ModuleCard({
  slot,
  index,
  dragging,
  onDragStart,
  onResize,
  onRemove
}: {
  slot: Slot
  index: number
  dragging: boolean
  onDragStart: (event: React.PointerEvent) => void
  onResize: () => void
  onRemove: () => void
}): React.JSX.Element {
  const module = REGISTRY[slot.id]
  const Icon = module.icon
  const Render = module.Render

  /*
    `feature ?? 'marketing'` stands in for "no gate at all" so the hook is
    called unconditionally — `locked` is what decides, and it checks for a
    declared feature first. The same trick the sidebar rows use.
  */
  const entitled = useFeature(module.feature ?? 'marketing')
  const locked = module.feature !== undefined && !entitled

  return (
    <motion.div
      layout
      data-slot-index={index}
      transition={transition.layout}
      className={cn(
        slot.size === 'detailed' ? 'col-span-2' : 'col-span-1',
        // Lifted and dimmed while it is the one being moved, so it is obvious
        // which card the cursor owns when several are sliding at once.
        dragging && 'z-10 opacity-90 shadow-modal'
      )}
    >
      <Card className="group relative">
        <div className="mb-3 flex items-center gap-2">
          {/*
            The handle is the only place a drag starts. Dragging from anywhere
            on the card would mean every list row inside it had to stop the
            event to stay clickable.
          */}
          <button
            type="button"
            onPointerDown={onDragStart}
            aria-label={`Move ${module.name}`}
            className="cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical size={13} strokeWidth={1.75} />
          </button>

          <Icon size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
          <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{module.name}</span>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={onResize}
              aria-label={slot.size === 'compact' ? 'Show more' : 'Show less'}
              title={slot.size === 'compact' ? 'Detailed' : 'Compact'}
              className="text-faint hover:text-ink"
            >
              {slot.size === 'compact' ? (
                <Maximize2 size={12} strokeWidth={1.75} />
              ) : (
                <Minimize2 size={12} strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${module.name}`}
              className="text-faint hover:text-danger"
            >
              <X size={12} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {locked ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-disabled">
            <Lock size={12} strokeWidth={2} />
            Part of SoloWork Pro
          </div>
        ) : (
          <Render size={slot.size} />
        )}
      </Card>
    </motion.div>
  )
}

/**
 * The add menu.
 *
 * Only offers modules that are not already on the dashboard — adding a second
 * copy of Money would be a way to make a dashboard worse, and there is no
 * reading of "add" that means "duplicate".
 *
 * A gated module is offered rather than hidden, and says so on the card once
 * added. Somebody deciding whether Marketing is worth paying for should be able
 * to see what it would put on their dashboard.
 */
function AddMenu({
  open,
  available,
  onClose,
  onAdd
}: {
  open: boolean
  available: ModuleId[]
  onClose: () => void
  onAdd: (id: ModuleId) => void
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[14vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
            onClick={onClose}
            className="absolute inset-0 bg-[rgba(6,6,8,0.6)]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={transition.modal}
            className="relative h-fit w-full max-w-[560px] overflow-hidden rounded-panel border border-line-strong bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-[13px] font-medium text-ink">Add a module</p>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>

            <div className="max-h-[46vh] overflow-y-auto p-1.5">
              {available.map((id) => {
                const module = REGISTRY[id]
                const Icon = module.icon

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onAdd(id)}
                    className="flex w-full items-start gap-3 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-raised"
                  >
                    <Icon size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink">{module.name}</span>
                      <span className="block text-[11.5px] text-muted">{module.description}</span>
                    </span>
                    <Plus size={13} strokeWidth={2} className="mt-1 shrink-0 text-faint" />
                  </button>
                )
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

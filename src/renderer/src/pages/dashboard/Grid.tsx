import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  GripVertical,
  Lock,
  Maximize2,
  Minimize2,
  Plus,
  X,
  type LucideIcon
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useFeature } from '@/lib/features'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { ACCENT_VAR, MODULE_IDS, REGISTRY, type ModuleId } from './modules'
import type { Accent } from './modules'
import type { Slot } from './layout'

/** How far the pointer must travel before this is a drag and not a click. */
const DRAG_THRESHOLD = 5

/**
 * The module's icon on a wash of its own colour.
 *
 * The one place each module is allowed to be itself. At 22px with the tint at
 * 14% it is a mark rather than a decoration — enough that the eye finds Money
 * or Overdue without reading either title, and far too small to trouble the
 * rule that keeps this app mostly ground and ink.
 *
 * `color-mix` rather than a second token per colour: six accents would
 * otherwise need six more variables that only ever appear here.
 */
function IconChip({
  icon: Icon,
  accent,
  size = 24
}: {
  icon: LucideIcon
  accent: Accent
  size?: number
}): React.JSX.Element {
  const colour = ACCENT_VAR[accent]

  return (
    <span
      className="grid shrink-0 place-items-center rounded-chip"
      style={{
        width: size,
        height: size,
        color: colour,
        backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`
      }}
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.9} />
    </span>
  )
}

/**
 * What is being dragged, and where it is.
 *
 * `width` and `height` are captured from the card at the moment it is picked
 * up, because the floating copy leaves the grid and would otherwise collapse to
 * its content — and the placeholder left behind needs to hold exactly the space
 * the card had, or every other card jumps the instant a drag begins.
 *
 * `offsetX/Y` is where inside the card the pointer grabbed it. Without it the
 * card snaps its corner to the cursor on the first move, which is the single
 * thing that makes a drag feel like it is being thrown rather than carried.
 */
interface Drag {
  id: ModuleId
  width: number
  height: number
  offsetX: number
  offsetY: number
  x: number
  y: number
}

/**
 * The dashboard grid: what is on it, in what order, at what size.
 *
 * Three columns. A compact module takes one and a detailed one takes two, which
 * is the whole sizing model — see `modules.tsx` for why it is two fixed sizes
 * rather than a resize handle.
 *
 * **The card follows the cursor.** It is lifted out of the grid into a fixed
 * position that tracks the pointer, and a placeholder holding its exact size
 * stays behind with a dashed accent outline showing where it will land. The
 * other cards reorder underneath as the pointer crosses them, so the gap is
 * always the answer to "if I let go now, where does this go".
 *
 * The first version had no floating card: the grid simply reordered live and
 * the card stayed in the flow. Everything was in the right place and it felt
 * wrong — nothing was in your hand, so the reflow read as the page twitching
 * rather than as you moving something.
 *
 * Which slot the pointer is over comes from `elementFromPoint`, as it does on
 * the project and client boards. The floating card sets `pointer-events: none`
 * precisely so that call sees the grid underneath it rather than the card being
 * carried.
 */
export function Grid({
  slots,
  onChange
}: {
  slots: Slot[]
  onChange: (next: Slot[]) => void
}): React.JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null)
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

    // The card, not the grip that was pressed.
    const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-slot-index]')
    if (!card) return

    const box = card.getBoundingClientRect()
    const originX = event.clientX
    const originY = event.clientY
    let lifted = false

    const onPointerMove = (point: PointerEvent): void => {
      if (
        !lifted &&
        Math.hypot(point.clientX - originX, point.clientY - originY) < DRAG_THRESHOLD
      ) {
        return
      }

      if (!lifted) {
        lifted = true
        setDrag({
          id,
          width: box.width,
          height: box.height,
          offsetX: originX - box.left,
          offsetY: originY - box.top,
          x: point.clientX,
          y: point.clientY
        })
      } else {
        setDrag((current) =>
          current ? { ...current, x: point.clientX, y: point.clientY } : current
        )
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
      setDrag(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const carried = drag ? slots.find((slot) => slot.id === drag.id) : undefined

  return (
    <>
      <div className="grid grid-cols-3 items-start gap-4">
        {slots.map((slot, index) => (
          <ModuleCard
            key={slot.id}
            slot={slot}
            index={index}
            drag={drag?.id === slot.id ? drag : null}
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

      {/*
        The card in your hand.

        Rendered outside the grid so the layout cannot move it, positioned from
        the pointer minus where it was grabbed. `pointer-events-none` is not
        cosmetic: `elementFromPoint` above has to see the grid underneath, and
        would otherwise only ever find this.

        Tilted very slightly and lifted with a shadow. Enough to read as picked
        up, not so much that it stops looking like the thing it is.
      */}
      {drag && carried && (
        <div
          className="pointer-events-none fixed z-50 opacity-95"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: drag.width,
            transform: 'rotate(-1deg) scale(1.02)'
          }}
        >
          <Card className="shadow-modal">
            <ModuleBody slot={carried} />
          </Card>
        </div>
      )}

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

/** A module's header and contents, shared by the card and the floating copy. */
function ModuleBody({ slot }: { slot: Slot }): React.JSX.Element {
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
    <>
      <div className="mb-3 flex items-center gap-2">
        <GripVertical size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
        <IconChip icon={Icon} accent={module.accent} size={22} />
        <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{module.name}</span>
      </div>

      {locked ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-disabled">
          <Lock size={12} strokeWidth={2} />
          Part of SoloWork Pro
        </div>
      ) : (
        <Render size={slot.size} />
      )}
    </>
  )
}

function ModuleCard({
  slot,
  index,
  drag,
  onDragStart,
  onResize,
  onRemove
}: {
  slot: Slot
  index: number
  /** Set only on the card being carried; null on every other. */
  drag: Drag | null
  onDragStart: (event: React.PointerEvent) => void
  onResize: () => void
  onRemove: () => void
}): React.JSX.Element {
  const module = REGISTRY[slot.id]
  const Icon = module.icon
  const Render = module.Render

  const entitled = useFeature(module.feature ?? 'marketing')
  const locked = module.feature !== undefined && !entitled

  /*
    The space the card came out of, held open at exactly the height it had.

    Without the fixed height the grid closes up the instant a card is lifted,
    every other module jumps, and the gap you are aiming at is not the gap it
    will land in.
  */
  if (drag) {
    return (
      <motion.div
        layout
        data-slot-index={index}
        transition={transition.layout}
        className={slot.size === 'detailed' ? 'col-span-2' : 'col-span-1'}
      >
        <div
          className="rounded-card"
          style={{
            height: drag.height,
            // Inline rather than a utility: `ring` has no dashed form, and the
            // colour comes from the same token the tour's spotlight uses.
            outline: '2px dashed var(--color-accent)',
            outlineOffset: '-2px',
            background: 'var(--color-accent-subtle)'
          }}
        />
      </motion.div>
    )
  }

  return (
    <motion.div
      layout
      data-slot-index={index}
      transition={transition.layout}
      className={slot.size === 'detailed' ? 'col-span-2' : 'col-span-1'}
    >
      <Card className="group relative overflow-hidden">
        {/*
          A wash of the module's colour bleeding out of the top-left corner.
          Very faint and very large, so it reads as the card being lit rather
          than as a shape drawn on it. `overflow-hidden` keeps it inside the
          rounded corners.
        */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 -left-16 h-32 w-32 rounded-full opacity-[0.14] blur-2xl"
          style={{ backgroundColor: ACCENT_VAR[module.accent] }}
        />

        <div className="relative mb-3 flex items-center gap-2">
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

          <IconChip icon={Icon} accent={module.accent} size={22} />
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
                    className="flex w-full items-start gap-3 rounded-control px-2.5 py-2.5 text-left transition-colors hover:bg-raised"
                  >
                    <IconChip icon={Icon} accent={module.accent} size={26} />
                    {/*
                      The description is the thing being read to make the
                      decision, so it is not the dimmest text on the row. The
                      name is a label for something you have not seen yet; the
                      sentence under it is what tells you whether you want it.
                    */}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{module.name}</span>
                      <span className="mt-0.5 block text-[12px] leading-[1.5] text-muted">
                        {module.description}
                      </span>
                    </span>
                    <Plus size={13} strokeWidth={2} className="mt-1.5 shrink-0 text-faint" />
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

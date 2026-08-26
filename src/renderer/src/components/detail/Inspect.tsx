import { PanelRight } from 'lucide-react'
import type { EntityRef } from '@shared/types'
import { useDrawer } from '@/hooks/useDrawer'
import { cn } from '@/lib/utils'

/**
 * The button on a row that opens the detail drawer.
 *
 * Its own affordance rather than the row's click, deliberately. Every list in
 * the app already does something when you click a row — clients and projects
 * go to their page, tasks and invoices open an editor — and quietly changing
 * all of that so a drawer appears instead would break the one gesture people
 * already know. So the drawer is added next to what is there, in the same
 * place on every list, and nothing that worked yesterday works differently.
 *
 * `siblings` is what the drawer's ↑ and ↓ walk. A list that passes it gets
 * keyboard navigation for nothing; a list that does not simply has no arrows.
 */
export function Inspect({
  subject,
  siblings,
  label,
  className
}: {
  subject: EntityRef
  siblings?: EntityRef[]
  /** What this row is, for the screen reader: "Inspect Acme Ltd". */
  label: string
  className?: string
}): React.JSX.Element {
  const { open, ref } = useDrawer()
  const showing = ref?.type === subject.type && ref.id === subject.id

  return (
    <button
      type="button"
      aria-label={`Inspect ${label}`}
      onClick={(event) => {
        // The row underneath has its own click, and this is not it.
        event.stopPropagation()
        open(subject, siblings)
      }}
      className={cn(
        'rounded-control p-1 text-faint transition-all duration-150',
        'hover:bg-raised hover:text-ink focus-visible:opacity-100',
        // Hidden until the row is hovered, so a list of forty rows is not
        // forty icons — but always shown for the row currently open, which is
        // what tells you where you are while the arrows walk the list.
        showing ? 'text-accent opacity-100' : 'opacity-0 group-hover:opacity-100',
        className
      )}
    >
      <PanelRight size={13} strokeWidth={1.75} />
    </button>
  )
}

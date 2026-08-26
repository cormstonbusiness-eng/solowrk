import { AnimatePresence, motion } from 'motion/react'
import { Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ListState } from '@/hooks/useListState'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The bar above a list: search, filter chips, a view switcher, saved views.
 *
 * One component for every list in the app, replacing the search box that lived
 * on clients, the status dropdown on invoices, the category dropdown on
 * documents and three more like them. Not because duplication is untidy — the
 * six of them worked — but because a filter you can see beats one you have to
 * open, and because the saved views underneath can only be one feature if the
 * filters they save are one thing.
 */
export function Toolbar({
  search,
  facets,
  state,
  children
}: {
  /** Omit for a list with nothing worth searching. */
  search?: { placeholder: string; key?: string }
  facets?: Facet[]
  state: ListState
  /** The view switcher and saved views, which sit at the right. */
  children?: React.ReactNode
}): React.JSX.Element {
  const searchKey = search?.key ?? 'q'

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      {search && (
        <div className="relative w-[260px] shrink-0">
          <Search
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
          />
          <input
            value={state.one(searchKey) ?? ''}
            onChange={(event) => state.set(searchKey, event.target.value)}
            placeholder={search.placeholder}
            className={cn(
              'h-8.5 w-full rounded-control border border-line bg-raised pr-2.5 pl-8',
              'text-[13px] text-ink outline-none placeholder:text-faint',
              'transition-colors focus:border-line-strong'
            )}
          />
        </div>
      )}

      {facets?.map((facet) => <Chips key={facet.key} facet={facet} state={state} />)}

      {/* Only ever there when it would do something, so the bar is not carrying
          a dead control on a list nobody has filtered. */}
      <AnimatePresence>
        {state.active > 0 && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={transition.press}
            onClick={state.clear}
            className="flex items-center gap-1 rounded-control px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={12} strokeWidth={1.75} />
            Clear
          </motion.button>
        )}
      </AnimatePresence>

      <div className="flex-1" />
      {children}
    </div>
  )
}

export interface Facet {
  /** The query parameter this filter writes. */
  key: string
  /** Shown before the chips when the filter is off, so a bare bar still reads. */
  label?: string
  options: { value: string; label: string; count?: number; colour?: string }[]
  /**
   * Single-choice, for a filter where two answers at once is nonsense.
   * Everything else is multiple, and several statuses at once is usually what
   * somebody wants.
   */
  single?: boolean
}

/**
 * One filter, as chips.
 *
 * Chips rather than a dropdown because the state of the list is then readable
 * without opening anything — the commonest confusion with a filtered list is
 * not knowing it is filtered — and because more than one answer at a time
 * needs no extra machinery.
 */
function Chips({ facet, state }: { facet: Facet; state: ListState }): React.JSX.Element {
  const chosen = state.values(facet.key)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {facet.label && chosen.length === 0 && (
        <span className="mr-0.5 text-[11px] text-faint">{facet.label}</span>
      )}

      {facet.options.map((option) => {
        const on = chosen.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              facet.single
                ? state.set(facet.key, on ? null : option.value)
                : state.toggle(facet.key, option.value)
            }
            style={
              on && option.colour
                ? {
                    color: option.colour,
                    borderColor: `${option.colour}55`,
                    backgroundColor: `${option.colour}1a`
                  }
                : undefined
            }
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px]',
              'transition-colors duration-press',
              on && !option.colour
                ? 'border-accent bg-accent-subtle text-accent'
                : on
                  ? ''
                  : 'border-line text-muted hover:bg-raised hover:text-ink'
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-faint')}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Which shape a list is drawn in — a segmented control, not a dropdown.
 *
 * Two or three options that are all visible at once, because switching between
 * a list and a board is something people do repeatedly rather than set once.
 */
export function ViewSwitcher<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon: LucideIcon }[]
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-control border border-line bg-raised p-0.5">
      {options.map((option) => {
        const Icon = option.icon
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            title={option.label}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className="relative rounded-[5px] px-2 py-1"
          >
            {on && (
              <motion.span
                // One element that moves between the two, so the highlight
                // slides rather than blinking out and in somewhere else.
                layoutId="view-switcher"
                transition={transition.layout}
                className="absolute inset-0 rounded-[5px] bg-surface shadow-card"
              />
            )}
            <Icon
              size={13}
              strokeWidth={1.75}
              className={cn('relative transition-colors', on ? 'text-ink' : 'text-faint')}
            />
          </button>
        )
      })}
    </div>
  )
}

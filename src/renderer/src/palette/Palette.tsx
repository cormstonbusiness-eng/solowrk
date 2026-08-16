import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Search } from 'lucide-react'
import { fuzzyRank, highlight } from '@/lib/fuzzy'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useCommands, type Command } from './commands'

/** Nothing typed: show a useful shortlist rather than every record in the app. */
const RESTING_LIMIT = 8
const RESULT_LIMIT = 30

/**
 * Ctrl+K. Searches everything in the workspace and runs verb commands, over
 * one keyboard path: type, arrow, Enter.
 *
 * The data is fetched only while the palette is open and filtered in the
 * renderer. A freelancer's workspace is hundreds of records, not millions, so
 * a search index in the main process would be machinery without a payoff — and
 * filtering here means results respond to keystrokes with no IPC round trip.
 */
export function Palette(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Reopening should feel like a fresh start, not resume a stale search.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  // Stable, so the command list is not rebuilt on every keystroke.
  const close = useCallback(() => setOpen(false), [])
  const commands = useCommands({ enabled: open, navigate, queryClient, close })

  const results = useMemo(() => {
    const ranked = fuzzyRank(commands, query, (command) => command.searchText, RESULT_LIMIT)
    return query === '' ? ranked.slice(0, RESTING_LIMIT) : ranked
  }, [commands, query])

  useEffect(() => setActive(0), [query])

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') return setOpen(false)

    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setActive((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      results[active]?.item.run()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-center px-6 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(6,6,8,0.6)]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={transition.modal}
            className="relative h-fit w-full max-w-[600px] overflow-hidden rounded-panel border border-line-strong bg-surface shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={15} strokeWidth={1.75} className="shrink-0 text-faint" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search projects, clients, invoices — or type a command"
                className="h-12 flex-1 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
              />
              <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">
                Esc
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-faint">
                  Nothing matches “{query}”.
                </p>
              ) : (
                results.map(({ item, indices }, index) => (
                  <Row
                    key={item.id}
                    command={item}
                    indices={query === '' ? [] : indices}
                    index={index}
                    active={index === active}
                    onHover={() => setActive(index)}
                  />
                ))
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10.5px] text-faint">
              <span className="flex items-center gap-1">
                <CornerDownLeft size={10} strokeWidth={2} /> to run
              </span>
              <span>↑↓ to move</span>
              <span className="ml-auto">Ctrl K</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function Row({
  command,
  indices,
  index,
  active,
  onHover
}: {
  command: Command
  indices: number[]
  index: number
  active: boolean
  onHover: () => void
}): React.JSX.Element {
  const Icon = command.icon

  return (
    <button
      type="button"
      data-index={index}
      onMouseMove={onHover}
      onClick={() => command.run()}
      className={cn(
        'flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors',
        active ? 'bg-raised' : 'hover:bg-raised/60'
      )}
    >
      {command.colour ? (
        <span
          style={{ backgroundColor: command.colour }}
          className="h-2 w-2 shrink-0 rounded-full"
        />
      ) : (
        <Icon size={14} strokeWidth={1.75} className="shrink-0 text-faint" />
      )}

      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {/* Only the label is highlighted; the searchable text includes the
            group and subtitle, and marking those would look like noise. */}
        {highlight(command.label, indices.filter((position) => position < command.label.length)).map(
          (part, partIndex) => (
            <span key={partIndex} className={part.match ? 'text-accent' : undefined}>
              {part.text}
            </span>
          )
        )}
      </span>

      {command.subtitle && (
        <span className="max-w-[190px] shrink-0 truncate text-[11.5px] text-muted">
          {command.subtitle}
        </span>
      )}
      <span className="shrink-0 text-[10.5px] tracking-[0.06em] text-faint uppercase">
        {command.group}
      </span>
    </button>
  )
}
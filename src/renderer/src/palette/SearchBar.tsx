import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Search } from 'lucide-react'
import { fuzzyRank, highlight } from '@/lib/fuzzy'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/celebrate'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useCommands, type Command } from './commands'

/**
 * Run a command and make sure a failure is seen.
 *
 * Several commands are async — logging time, starting a timer, creating a
 * record — and their failures used to vanish. The bar closes on the way out, so
 * a rejected promise meant the results disappeared and nothing happened, with
 * no error anywhere: indistinguishable from the command having worked.
 *
 * Not awaited by the callers, deliberately. The results should close the
 * instant Enter is pressed rather than waiting on the main process, so the
 * outcome is reported through a toast rather than by holding the list open.
 */
function runCommand(command: Command): void {
  try {
    const result = command.run()
    if (result instanceof Promise) {
      void result.catch((cause: unknown) => {
        toast('That did not work', {
          // `late` is the kind that renders in the warning colour; there is no
          // 'warning' kind, and inventing one for this would mean a new colour
          // and a new icon for a case that is already rare.
          kind: 'late',
          body: cause instanceof Error ? cause.message : 'The command could not be completed.'
        })
      })
    }
  } catch (cause) {
    // A command that throws synchronously, before any promise exists.
    toast('That did not work', {
      kind: 'late',
      body: cause instanceof Error ? cause.message : 'The command could not be completed.'
    })
  }
}

/** Nothing typed: show a useful shortlist rather than every record in the app. */
const RESTING_LIMIT = 8
const RESULT_LIMIT = 30

/**
 * The search bar, in the title bar.
 *
 * Searches everything in the workspace and runs verb commands, over one
 * keyboard path: type, arrow, Enter. It replaces a Ctrl+K modal that did the
 * same job — same commands, same ranking, same keys — behind a shortcut that
 * had to be known about before it could be used. A search bar that is simply
 * there is discoverable by looking at the window.
 *
 * Ctrl+K still works and now focuses this rather than opening anything. Nothing
 * appears over the app, so there is nothing to dismiss, and the habit survives
 * for anyone who had it.
 *
 * The data is fetched only while the bar has something in it and is filtered in
 * the renderer. A freelancer's workspace is hundreds of records, not millions,
 * so a search index in the main process would be machinery without a payoff —
 * and filtering here means results respond to keystrokes with no IPC round
 * trip.
 */
export function SearchBar(): React.JSX.Element | null {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status } = useWorkspace()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  /*
    Results show while the bar has focus, not merely while it has text. Typing
    something, clicking into the app and coming back should show the list again
    rather than leaving a filled box with nothing under it.
  */
  const open = focused

  const close = useCallback(() => {
    setQuery('')
    setActive(0)
    inputRef.current?.blur()
  }, [])

  /*
    Ctrl+K focuses rather than opening. `select()` as well as `focus()` so a
    second press over a stale query replaces it by typing, which is what the
    same key does in every browser address bar.
  */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /*
    A click anywhere else closes the results. Listening on the window rather
    than using the input's blur, because blur fires before a result's click
    lands and would close the list out from under the thing being clicked.
  */
  useEffect(() => {
    if (!open) return

    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setFocused(false)
    }

    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // Stable, so the command list is not rebuilt on every keystroke.
  const commands = useCommands({ enabled: open, query, navigate, queryClient, close })

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
    if (event.key === 'Escape') {
      close()
      return
    }

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
      const chosen = results[active]?.item
      if (chosen) runCommand(chosen)
    }
  }

  /*
    Nothing to search until a workspace is open.

    The title bar is on screen during first-run setup too, where there are no
    projects, clients or invoices to find and every command would act on a
    database that does not exist yet. A search box on that screen is an
    invitation to a dead end.

    After the hooks above, never before them: React counts hooks per render,
    and returning early ahead of them would change the count the moment a
    workspace opened.
  */
  if (status?.state !== 'ready') return null

  return (
    // `no-drag` because the title bar is the window's drag region, and an input
    // inside it would otherwise move the window instead of taking a cursor.
    <div ref={boxRef} className="no-drag relative w-full max-w-[440px]">
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border px-3 py-1 transition-colors',
          open ? 'border-line-strong bg-surface' : 'border-line bg-raised hover:border-line-strong'
        )}
      >
        <Search size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Search or run a command"
          className="h-5 flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-faint focus:outline-none"
        />
        {!open && (
          <kbd className="shrink-0 rounded border border-line px-1 py-px text-[9.5px] text-faint">
            Ctrl K
          </kbd>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={transition.press}
            /*
              Anchored under the input rather than centred on the screen. The
              title bar does not clip it, so it can hang over the page — which
              is the point: the app stays visible behind its own search instead
              of being covered by it.
            */
            className="absolute top-[calc(100%+6px)] left-0 z-50 w-[520px] max-w-[92vw] overflow-hidden rounded-panel border border-line-strong bg-surface shadow-2xl"
          >
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-faint">
                  {query === '' ? 'Start typing to search' : `Nothing matches “${query}”.`}
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
              <span className="ml-auto">Esc to clear</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      onClick={() => runCommand(command)}
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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Undo2 } from 'lucide-react'
import { EASE, transition } from '@/lib/motion'

/**
 * "That's gone — undo?"
 *
 * Its own thing rather than part of `Toasts`, because the two are not the same
 * kind of message. A notification is the app telling you something happened
 * while you were elsewhere; this is the app asking about something you did a
 * second ago, and it has exactly one action. They sit in different corners for
 * the same reason.
 *
 * Only ever one at a time. Undo means the last thing, and a stack of three
 * offers is a stack of three chances to undo the wrong one.
 */

/**
 * Twelve seconds, against four for a notification.
 *
 * A notification is read or it is not. This is waiting for somebody to notice
 * a mistake, and noticing takes longer than reading — usually it is the moment
 * the list redraws without the row they meant to keep.
 */
const DWELL_MS = 12_000

interface Offer {
  id: number
  message: string
  /**
   * Absent for a message that is only telling you what happened. The bar
   * doubles as that, because a result of an undo — "it is back, but its
   * project has gone" — belongs in the same place the offer was, not in the
   * notification corner where it would read as something the app did on its
   * own.
   */
  undo?: () => void | Promise<void>
}

interface UndoState {
  /** Offer to undo the thing just done. Replaces any offer already showing. */
  offer: (message: string, undo?: () => void | Promise<void>) => void
}

const UndoContext = createContext<UndoState | null>(null)

export function UndoProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [showing, setShowing] = useState<Offer | null>(null)
  const [busy, setBusy] = useState(false)
  // Hovering holds the offer open. Noticing the mistake and reaching for the
  // mouse is exactly the case this exists for, and it must not expire in the
  // half second between the two.
  const [held, setHeld] = useState(false)
  const next = useRef(1)

  const offer = useCallback((message: string, undo?: () => void | Promise<void>): void => {
    setBusy(false)
    setHeld(false)
    setShowing({ id: next.current++, message, undo })
  }, [])

  const value = useMemo(() => ({ offer }), [offer])

  return (
    <UndoContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
        <AnimatePresence>
          {showing && (
            <motion.div
              key={showing.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={transition.page}
              onMouseEnter={() => setHeld(true)}
              onMouseLeave={() => setHeld(false)}
              className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-panel border border-line-strong bg-surface py-2 pr-2 pl-3.5 shadow-modal"
            >
              <span className="text-[12.5px] whitespace-nowrap text-ink">{showing.message}</span>

              {showing.undo && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const run = showing.undo
                    if (!run) return
                    setBusy(true)
                    void Promise.resolve(run()).finally(() => setShowing(null))
                  }}
                  className="flex items-center gap-1.5 rounded-control bg-raised px-2 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50"
                >
                  <Undo2 size={12} strokeWidth={1.75} />
                  Undo
                </button>
              )}

              <Draining key={`bar-${showing.id}`} held={held} onDone={() => setShowing(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </UndoContext.Provider>
  )
}

/**
 * The bar draining along the bottom, and the timer itself.
 *
 * The same idea as the notification toast's: a thing that vanishes without
 * warning is worse than one that never appeared, and the bar turns "it went"
 * into "it is going".
 */
function Draining({ held, onDone }: { held: boolean; onDone: () => void }): React.JSX.Element {
  useEffect(() => {
    if (held) return
    const timer = setTimeout(onDone, DWELL_MS)
    return () => clearTimeout(timer)
    // `onDone` is a fresh closure every render; the hold is what decides
    // whether this should be counting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held])

  return (
    <motion.span
      aria-hidden
      initial={{ scaleX: 1 }}
      animate={{ scaleX: held ? 1 : 0 }}
      transition={{ duration: held ? 0 : DWELL_MS / 1000, ease: EASE }}
      className="absolute bottom-0 left-0 h-[2px] w-full origin-left bg-accent/50"
    />
  )
}

export function useUndo(): UndoState {
  const value = useContext(UndoContext)
  if (!value) throw new Error('useUndo must be used inside an UndoProvider')
  return value
}

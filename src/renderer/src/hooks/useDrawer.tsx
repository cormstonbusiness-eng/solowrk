import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { EntityRef } from '@shared/types'
import { refFromParam, refToParam } from '@/lib/entities'

/**
 * Which record the detail drawer is showing.
 *
 * Split deliberately, because the two halves have different lifetimes.
 *
 * The **ref lives in the URL** (`?open=invoice:12`). That makes a record
 * something you can link to — a notification, the command palette, or a later
 * version of the assistant can open one without the drawer needing to know who
 * asked — and it makes the back button close the drawer, which is what every
 * user tries first.
 *
 * The **sibling list lives here**, in React. It is the rows of whatever list
 * was on screen when the drawer opened, and it exists so ↑ and ↓ can move
 * through them without closing. Putting it in the URL would mean serialising a
 * list of ids into the address bar to support one keystroke. The cost of
 * keeping it in memory is that after a reload the arrows stop working until
 * the next row is clicked, which is a fair trade.
 */
interface DrawerState {
  ref: EntityRef | null
  open: (ref: EntityRef, siblings?: EntityRef[]) => void
  close: () => void
  /** Move to the next or previous row of the list the drawer was opened from. */
  step: (delta: 1 | -1) => void
  /** Whether stepping would go anywhere, so the UI can say when it would not. */
  canStep: boolean
}

const DrawerContext = createContext<DrawerState | null>(null)

/** The URL parameter, so nothing else has to know its name. */
export const DRAWER_PARAM = 'open'

export function DrawerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const [siblings, setSiblings] = useState<EntityRef[]>([])

  const raw = searchParams.get(DRAWER_PARAM)
  const ref = useMemo(() => refFromParam(raw), [raw])

  // `setSearchParams` is a fresh function every render and would re-make every
  // callback below, which in turn re-runs the key handler's effect on every
  // keystroke. The ref keeps the callbacks stable.
  const setParams = useRef(setSearchParams)
  setParams.current = setSearchParams
  const paramsRef = useRef(searchParams)
  paramsRef.current = searchParams

  const show = useCallback((next: EntityRef | null, replace: boolean): void => {
    const params = new URLSearchParams(paramsRef.current)
    if (next) params.set(DRAWER_PARAM, refToParam(next))
    else params.delete(DRAWER_PARAM)
    setParams.current(params, { replace })
  }, [])

  const open = useCallback(
    (next: EntityRef, list?: EntityRef[]): void => {
      setSiblings(list ?? [])
      show(next, false)
    },
    [show]
  )

  const close = useCallback((): void => {
    // Replace rather than push: closing should not leave an entry that the
    // back button walks straight back into.
    show(null, true)
  }, [show])

  const index = ref ? siblings.findIndex((row) => row.type === ref.type && row.id === ref.id) : -1

  const step = useCallback(
    (delta: 1 | -1): void => {
      if (index < 0) return
      const next = siblings[index + delta]
      if (!next) return
      // Replaced, so walking a list of forty rows leaves one history entry
      // rather than forty.
      show(next, true)
    },
    [index, siblings, show]
  )

  const value = useMemo(
    () => ({ ref, open, close, step, canStep: index >= 0 && siblings.length > 1 }),
    [ref, open, close, step, index, siblings.length]
  )

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
}

export function useDrawer(): DrawerState {
  const value = useContext(DrawerContext)
  if (!value) throw new Error('useDrawer must be used inside a DrawerProvider')
  return value
}

/**
 * Keyboard for the drawer: Escape closes, ↑ and ↓ walk the list.
 *
 * Lives with the state rather than in the component so the arrow keys are
 * ignored while something in the drawer has focus — otherwise ↓ in a search
 * box would move to the next record instead of the next result.
 */
export function useDrawerKeys(active: boolean): void {
  const { close, step } = useDrawer()

  useEffect(() => {
    if (!active) return

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true
      if (typing) return

      event.preventDefault()
      step(event.key === 'ArrowDown' ? 1 : -1)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, close, step])
}

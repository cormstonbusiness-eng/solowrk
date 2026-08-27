import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Selecting rows, including the awkward parts.
 *
 * The awkward parts are all Shift: a range runs from the last row *clicked*,
 * not the last row selected, and it has to work backwards as readily as
 * forwards. Get the anchor wrong and Shift-clicking upward selects nothing,
 * which is the bug every hand-rolled list ships with.
 *
 * The rule is separated from the hook so it can be tested without a component
 * — `resolveClick` is the whole of the behaviour, and the hook is a `useState`
 * around it.
 */

export type ClickModifiers = { shift?: boolean; toggle?: boolean }

export interface SelectionState {
  selected: Set<number>
  /** The last row clicked without Shift. Where a range starts from. */
  anchor: number | null
}

export const emptySelection: SelectionState = { selected: new Set(), anchor: null }

/**
 * What a click does.
 *
 * `order` is the rows currently on screen, in the order they are shown —
 * passed in on every call because it changes with every filter and sort, and
 * a range drawn against last render's order would select rows nobody can see.
 */
export function resolveClick(
  state: SelectionState,
  id: number,
  order: number[],
  modifiers: ClickModifiers = {}
): SelectionState {
  if (modifiers.shift && state.anchor !== null) {
    const from = order.indexOf(state.anchor)
    const to = order.indexOf(id)

    // A row filtered away since leaves an anchor pointing at nothing. Treat
    // the click as a plain one rather than selecting the whole list, which is
    // what an index of -1 would otherwise do.
    if (from === -1 || to === -1) return { selected: new Set([id]), anchor: id }

    const [low, high] = from <= to ? [from, to] : [to, from]
    const range = order.slice(low, high + 1)

    // Added to what is there rather than replacing it, so two Shift-ranges
    // build up — which is what somebody doing it twice means. And the anchor
    // does not move, so repeated Shift-clicks redraw from a fixed point
    // instead of creeping down the list one row at a time.
    return { selected: new Set([...state.selected, ...range]), anchor: state.anchor }
  }

  if (modifiers.toggle) {
    const next = new Set(state.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // The anchor moves even when toggling *off*: the next range should run
    // from the row last touched, whatever happened to it.
    return { selected: next, anchor: id }
  }

  // A plain click on the only selected row clears it. Anything else replaces
  // the selection, which is what every list in every OS does.
  if (state.selected.size === 1 && state.selected.has(id)) return emptySelection
  return { selected: new Set([id]), anchor: id }
}

/** Select everything on screen, or clear when it already is. */
export function resolveToggleAll(state: SelectionState, order: number[]): SelectionState {
  if (order.length === 0) return state
  const all = order.every((id) => state.selected.has(id))
  return all ? emptySelection : { selected: new Set(order), anchor: order.at(-1) ?? null }
}

export interface Selection {
  selected: Set<number>
  count: number
  isSelected: (id: number) => boolean
  click: (id: number, modifiers?: ClickModifiers) => void
  toggleAll: () => void
  clear: () => void
  allSelected: boolean
}

export function useSelection(order: number[]): Selection {
  const [state, setState] = useState<SelectionState>(emptySelection)

  // Read inside the setter rather than closed over, so a click always resolves
  // against what is on screen at the moment of the press.
  const live = useRef(order)
  live.current = order

  const click = useCallback((id: number, modifiers: ClickModifiers = {}): void => {
    setState((current) => resolveClick(current, id, live.current, modifiers))
  }, [])

  const toggleAll = useCallback((): void => {
    setState((current) => resolveToggleAll(current, live.current))
  }, [])

  const clear = useCallback(() => setState(emptySelection), [])

  // Read by the key handler, which is registered once and would otherwise be
  // looking at whatever the selection was when the list first rendered.
  const current = useRef(state)
  current.current = state

  /**
   * Escape clears, Ctrl+A takes everything on screen.
   *
   * Ctrl+A is only claimed while something is already selected. Stealing it
   * from an empty list would break selecting text on the page, and somebody
   * who has not picked a row has not signalled they are working with rows.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (event.key === 'Escape') {
        clear()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        // Decided out here, not inside the setter. A state updater has to be
        // pure — React is entitled to run it twice — and by the second run the
        // event is long finished, so `preventDefault` in there does nothing
        // some of the time and something the rest of it.
        if (live.current.length === 0) return
        if (current.current.selected.size === 0) return
        event.preventDefault()
        setState((state) => resolveToggleAll(state, live.current))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clear])

  return useMemo(
    () => ({
      selected: state.selected,
      count: state.selected.size,
      isSelected: (id: number) => state.selected.has(id),
      click,
      toggleAll,
      clear,
      allSelected: order.length > 0 && order.every((id) => state.selected.has(id))
    }),
    [state, order, click, toggleAll, clear]
  )
}

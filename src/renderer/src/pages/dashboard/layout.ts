import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_LAYOUT, MODULE_IDS, type ModuleId, type ModuleSize } from './modules'

/**
 * Which modules are on the dashboard, in what order, at what size.
 *
 * Stored in the workspace database under one key rather than in browser
 * storage, for the same reason the tour's flag is: it belongs to the business,
 * not to the machine. Moving a workspace to a new computer brings the dashboard
 * somebody arranged with it.
 *
 * One JSON string rather than a table. A layout is a single value that is
 * always read and written whole — there is no query anybody would ever run
 * against it — and a table would be three migrations to store an array.
 */
const KEY = 'dashboard.layout'

export interface Slot {
  id: ModuleId
  size: ModuleSize
}

/**
 * Read a stored layout back, discarding anything that no longer makes sense.
 *
 * Written defensively because this string outlives the code that wrote it. A
 * module removed in a later version leaves its id behind in every workspace
 * that had it on the dashboard, and a dashboard that throws on load because of
 * a module somebody deleted months ago would be a bad way to find that out.
 *
 * Unknown ids are dropped, duplicates are dropped, and an unrecognised size
 * falls back to compact rather than failing.
 */
function parse(raw: string | null): Slot[] | null {
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null

    const seen = new Set<string>()
    const slots: Slot[] = []

    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { id, size } = entry as { id?: unknown; size?: unknown }

      if (typeof id !== 'string') continue
      if (!MODULE_IDS.includes(id as ModuleId)) continue
      if (seen.has(id)) continue

      seen.add(id)
      slots.push({ id: id as ModuleId, size: size === 'detailed' ? 'detailed' : 'compact' })
    }

    return slots
  } catch {
    // A hand-edited or truncated value is a reason to start from the default,
    // not a reason to show somebody an error about their own dashboard.
    return null
  }
}

export interface LayoutState {
  slots: Slot[]
  /** False until the stored layout has been read, so nothing flashes. */
  ready: boolean
  setSlots: (next: Slot[]) => void
}

export function useDashboardLayout(): LayoutState {
  const [slots, setLocal] = useState<Slot[]>(DEFAULT_LAYOUT)
  const [ready, setReady] = useState(false)

  /*
    Guards the first write. Without it the load itself looks like a change and
    saves the default layout back over whatever was stored a moment before it
    arrived — which would quietly reset the dashboard of anybody whose database
    was slow to answer.
  */
  const loaded = useRef(false)

  useEffect(() => {
    let cancelled = false

    void window.solo
      .invoke('state:get', { key: KEY })
      .then((raw) => {
        if (cancelled) return
        const stored = parse(raw)
        if (stored && stored.length > 0) setLocal(stored)
        loaded.current = true
        setReady(true)
      })
      .catch(() => {
        // An unreadable value is a default dashboard, not a broken screen.
        if (cancelled) return
        loaded.current = true
        setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Save on every change rather than on a timer.
   *
   * Every change here is a deliberate act — adding a module, dragging one,
   * resizing one — and there is no stream of them to batch. Writing
   * immediately means closing the app straight after a drag keeps the drag.
   */
  const setSlots = useCallback((next: Slot[]) => {
    setLocal(next)
    if (!loaded.current) return
    void window.solo.invoke('state:set', { key: KEY, value: JSON.stringify(next) }).catch(() => {
      // The dashboard still looks right for this session; it is a layout, not
      // somebody's invoice.
    })
  }, [])

  return { slots, ready, setSlots }
}

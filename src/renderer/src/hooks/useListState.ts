import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DRAWER_PARAM } from './useDrawer'

/**
 * A list's filters, kept in the address bar.
 *
 * Three things fall out of this that are awkward any other way. A filtered
 * list becomes something you can link to — a notification can point at the
 * overdue invoices rather than at all of them. The back button undoes a
 * filter, which is what people try. And a saved view is nothing more than the
 * stored query string, so `views.ts` never has to know what an invoice filter
 * is or grow a column when a page gains one.
 *
 * Filters are held as arrays throughout, and an empty array means no filter
 * rather than "match nothing" — the chips read "All" in that state, which is
 * the only reading that makes an empty filter bar mean what it looks like.
 */

/**
 * The parameters that are not filters, and so never travel in a saved view.
 *
 * `open` is which record the drawer is showing. A saved view carrying one
 * would reopen somebody's drawer on a record from three weeks ago, or on one
 * since deleted — the filter was the thing worth keeping, not what happened to
 * be selected at the time. `new` and `client` are one-shot instructions from
 * elsewhere in the app, cleared as soon as they fire.
 */
const NOT_A_FILTER = new Set<string>([DRAWER_PARAM, 'new', 'client'])

/** Just the filters, which is exactly what a saved view stores. */
export function filtersOnly(params: URLSearchParams): URLSearchParams {
  const kept = new URLSearchParams()
  for (const [key, value] of params) {
    if (!NOT_A_FILTER.has(key)) kept.append(key, value)
  }
  return kept
}

export interface ListState {
  /** One filter's selected values. Empty means unfiltered. */
  values: (key: string) => string[]
  /** Whether one value of one filter is on. */
  has: (key: string, value: string) => boolean
  /** Turn one value of a filter on or off, leaving the rest alone. */
  toggle: (key: string, value: string) => void
  /** Replace a filter outright — for a search box, or a single-choice control. */
  set: (key: string, value: string | string[] | null) => void
  /** A single value, for filters that only ever have one. */
  one: (key: string) => string | null
  /** Drop every filter, leaving anything that is not one alone. */
  clear: () => void
  /** How many filters are currently narrowing the list. */
  active: number
  /** The filters as a query string, which is exactly what a saved view holds. */
  query: string
  /** Apply a saved view's query string. */
  apply: (query: string) => void
}

export function useListState(): ListState {
  const [searchParams, setSearchParams] = useSearchParams()

  // `setSearchParams` is a new function every render; the ref keeps every
  // callback below stable so a page can depend on them without re-running an
  // effect on each keystroke.
  const setParams = useRef(setSearchParams)
  setParams.current = setSearchParams
  const current = useRef(searchParams)
  current.current = searchParams

  const write = useCallback((mutate: (params: URLSearchParams) => void): void => {
    const params = new URLSearchParams(current.current)
    mutate(params)
    // Replaced rather than pushed. Typing six letters into a search box should
    // not put six entries in the history for the back button to walk out of
    // one at a time.
    setParams.current(params, { replace: true })
  }, [])

  const values = useCallback(
    (key: string): string[] => current.current.getAll(key).filter(Boolean),
    // Re-made whenever the params change, so a component reading it re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams]
  )

  const has = useCallback((key: string, value: string) => values(key).includes(value), [values])

  const toggle = useCallback(
    (key: string, value: string): void => {
      write((params) => {
        const existing = params.getAll(key)
        params.delete(key)
        const next = existing.includes(value)
          ? existing.filter((one) => one !== value)
          : [...existing, value]
        for (const one of next) params.append(key, one)
      })
    },
    [write]
  )

  const set = useCallback(
    (key: string, value: string | string[] | null): void => {
      write((params) => {
        params.delete(key)
        const list = value === null ? [] : Array.isArray(value) ? value : [value]
        for (const one of list) if (one !== '') params.append(key, one)
      })
    },
    [write]
  )

  const one = useCallback((key: string): string | null => values(key)[0] ?? null, [values])

  const clear = useCallback((): void => {
    write((params) => {
      for (const key of [...params.keys()]) {
        if (!NOT_A_FILTER.has(key)) params.delete(key)
      }
    })
  }, [write])

  const filters = useMemo(() => filtersOnly(searchParams), [searchParams])

  const apply = useCallback(
    (query: string): void => {
      write((params) => {
        // The view replaces the filters and nothing else: whatever record the
        // drawer is showing stays open, because applying a filter is not a
        // reason to close what somebody is reading.
        for (const key of [...params.keys()]) if (!NOT_A_FILTER.has(key)) params.delete(key)
        for (const [key, value] of new URLSearchParams(query)) params.append(key, value)
      })
    },
    [write]
  )

  return {
    values,
    has,
    toggle,
    set,
    one,
    clear,
    active: new Set([...filters.keys()]).size,
    query: filters.toString(),
    apply
  }
}

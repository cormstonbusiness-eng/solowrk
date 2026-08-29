import { useSyncExternalStore } from 'react'
import { refusalFrom, type Refusal } from '@shared/limitError'

/**
 * The limit somebody has just run into.
 *
 * §5.1 is emphatic that hitting a limit must never be a disabled control: the
 * create action is allowed to fail, but it has to say what happened and offer
 * the way past. So the refusal travels from the main process as a structured
 * error, is caught once here, and becomes a modal.
 *
 * Caught centrally rather than at each call site. Every creation in this app
 * is a TanStack mutation, and the query client takes a global `onError` — so
 * one handler covers `clients:create`, `projects:create` and every other
 * without thirty pages each remembering to try/catch. A page that wants its
 * own handling still gets it: `onError` here does not swallow the rejection.
 *
 * A module-level store rather than a context, matching `celebrate.ts`, because
 * the producer is a query-client callback that sits outside the React tree
 * entirely and has no provider to reach for.
 */

let current: Refusal | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Show the modal, if this failure was a refusal — either kind.
 *
 * Returns whether it was, so a call site that wants to suppress its own error
 * toast can ask. Anything else is left entirely alone — a disk error must not
 * be reported as a reason to upgrade.
 */
export function raiseLimit(error: unknown): boolean {
  const refusal = refusalFrom(error)
  if (!refusal) return false

  // The first one wins. Two mutations failing together is one wall, not two
  // modals fighting over the same corner of the screen.
  if (current) return true

  current = refusal
  emit()
  return true
}

export function dismissLimit(): void {
  if (!current) return
  current = null
  emit()
}

export function useLimitReached(): Refusal | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}

/** Testing seam, so one test's refusal does not leak into the next. */
export function resetLimits(): void {
  current = null
  emit()
}

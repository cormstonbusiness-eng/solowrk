import { useSyncExternalStore } from 'react'
import type { AppNotification, NotificationKind } from '@shared/types'

/**
 * The two moments in this app worth marking.
 *
 * An invoice being paid, and a licence unlocking. Both are things that happen
 * *elsewhere* from where they are best celebrated — somebody marks an invoice
 * paid on the Invoices page, and the figure that ought to jump is on the
 * dashboard — so this holds the news until the page that can show it arrives.
 *
 * A celebration fired to an empty room is worse than none: it spends the
 * moment and the user never sees it. So each one is *taken* rather than
 * broadcast, and taking it clears it.
 *
 * A module-level store rather than a context, because the two producers and
 * the two consumers are on opposite sides of the router and threading a
 * provider through for two booleans would be more machinery than the feature.
 * `useSyncExternalStore` keeps it correct under concurrent rendering without a
 * dependency.
 */

interface State {
  /** Toasts raised by the renderer itself, alongside the ones from main. */
  toasts: AppNotification[]
  /** A payment that has arrived and not yet been shown on the dashboard. */
  paid: { amount: number; client: string } | null
  /** Features unlocked since the sidebar last looked. */
  unlocked: string[]
}

let state: State = { toasts: [], paid: null, unlocked: [] }
const listeners = new Set<() => void>()

function set(next: State): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Local toasts carry negative ids.
 *
 * Real notifications come from the database with positive ones, and the toast
 * stack shows both. The sign is what stops a click on a local toast calling
 * `notifications:read` for a row that does not exist.
 */
let nextId = -1

export function toast(
  title: string,
  options: { body?: string; kind?: NotificationKind; link?: string } = {}
): void {
  const notification: AppNotification = {
    id: nextId,
    kind: options.kind ?? 'info',
    title,
    body: options.body ?? '',
    link: options.link ?? '',
    readAt: null,
    archived: false,
    createdAt: new Date().toISOString()
  }
  nextId -= 1

  set({ ...state, toasts: [...state.toasts, notification] })
}

export function dismissToast(id: number): void {
  set({ ...state, toasts: state.toasts.filter((one) => one.id !== id) })
}

/* ------------------------------------------------------------------ *
 * An invoice being paid
 * ------------------------------------------------------------------ */

/**
 * Record that money arrived, and say so once.
 *
 * The toast fires immediately, where the user is. The figure and the border
 * flash wait for the dashboard, which is where the number they care about
 * lives.
 */
export function celebratePayment(amount: number, client: string | null): void {
  set({ ...state, paid: { amount, client: client ?? 'a client' } })

  toast('Paid.', {
    kind: 'money',
    body: `${formatMoney(amount)} from ${client ?? 'a client'}.`,
    link: '/finance'
  })
}

/** Read it once and clear it. A celebration shown twice is a glitch. */
export function takePayment(): { amount: number; client: string } | null {
  const paid = state.paid
  if (paid) set({ ...state, paid: null })
  return paid
}

/* ------------------------------------------------------------------ *
 * A licence unlocking
 * ------------------------------------------------------------------ */

/**
 * Features that were not there a moment ago.
 *
 * Called from the auth watcher with the difference, never with the whole set —
 * a first load is not an upgrade, and treating it as one would throw confetti
 * at somebody who has been paying for a year.
 */
export function celebrateUnlock(features: string[]): void {
  if (features.length === 0) return

  /**
   * No toast for this one, deliberately.
   *
   * The specification pairs a toast with the what's-new panel, and both would
   * land in the same corner of the window at the same moment. The panel is the
   * announcement: it says more, it links into each feature, and unlike a toast
   * it waits rather than leaving after four seconds — which matters, because
   * somebody who has just paid should not have to catch the news.
   */
  set({ ...state, unlocked: [...new Set([...state.unlocked, ...features])] })
}

export function takeUnlocked(): string[] {
  const unlocked = state.unlocked
  if (unlocked.length > 0) set({ ...state, unlocked: [] })
  return unlocked
}

/* ------------------------------------------------------------------ *
 * Reading it
 * ------------------------------------------------------------------ */

/** The toast stack, outside React. The hook below and the tests share it. */
export function currentToasts(): AppNotification[] {
  return state.toasts
}

export function useLocalToasts(): AppNotification[] {
  return useSyncExternalStore(
    subscribe,
    () => state.toasts,
    () => state.toasts
  )
}

export function useCelebrations(): { paid: State['paid']; unlocked: string[] } {
  return useSyncExternalStore(
    subscribe,
    () => celebrations(),
    () => celebrations()
  )
}

/**
 * Cached, because `useSyncExternalStore` compares snapshots by identity and a
 * fresh object every call is an infinite render loop.
 */
let snapshot: { paid: State['paid']; unlocked: string[] } = { paid: null, unlocked: [] }

function celebrations(): { paid: State['paid']; unlocked: string[] } {
  if (snapshot.paid !== state.paid || snapshot.unlocked !== state.unlocked) {
    snapshot = { paid: state.paid, unlocked: state.unlocked }
  }
  return snapshot
}

/** Whole pounds, matching how the toast reads aloud. */
function formatMoney(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

/** Test seam: nothing in the app calls this. */
export function resetCelebrations(): void {
  state = { toasts: [], paid: null, unlocked: [] }
  nextId = -1
  snapshot = { paid: null, unlocked: [] }
  for (const listener of listeners) listener()
}

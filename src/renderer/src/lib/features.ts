import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { AuthState } from '@shared/types'

/**
 * What this licence unlocks, in the renderer.
 *
 * The real gate is in the main process — `guard()` in `main/ipc/index.ts` —
 * because a disabled button is a suggestion and an unregistered IPC handler is
 * a rule. This is only so the UI can be honest about it: show a lock instead of
 * a page that throws, and skip a query whose answer the user is not allowed to
 * see rather than firing it and catching the refusal.
 *
 * Shares the `['auth', 'state']` cache key with Settings, so a licence check
 * from there updates the sidebar too, and listens for `auth:changed` — pushed
 * by the six-hourly background check — so an upgrade appears without a restart.
 */
const KEY = ['auth', 'state'] as const

export function useAuthState(): AuthState | undefined {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => window.solo.invoke('auth:state'),
    // The licence rarely changes, and `auth:changed` covers it when it does.
    staleTime: 5 * 60 * 1000
  })

  useEffect(() => {
    return window.solo.on('auth:changed', (next) => {
      queryClient.setQueryData(KEY, next)
    })
  }, [queryClient])

  return data
}

/**
 * Whether a paid feature is available.
 *
 * Returns `true` while the answer is still loading, and `true` when no account
 * server is configured. Both are deliberate: the failure direction for the UI
 * is to show the feature and let the main process refuse the call, because
 * flashing a paywall at a paying customer for the half-second before their
 * licence loads is worse than briefly showing a button that then explains
 * itself.
 */
export function useFeature(name: string): boolean {
  const auth = useAuthState()

  if (!auth) return true
  if (!auth.configured) return true

  return auth.account?.features.includes(name) ?? false
}
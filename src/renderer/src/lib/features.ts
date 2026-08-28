import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { AuthState } from '@shared/types'
import {
  TIER_ADDS,
  TIER_NAMES,
  can,
  rank,
  requires,
  type Feature,
  type Tier
} from '@shared/entitlements'
import { celebrateUnlock } from './celebrate'

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
 *
 * Everything here answers from `auth.tier` through the shared entitlement map.
 * It used to read a list of feature names the server sent, which meant the
 * server and the app each held an opinion about what a tier included, and the
 * two could disagree silently. Now the server issues a tier and the map does
 * the rest.
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
      /**
       * An upgrade is a *difference*, never a whole feature set.
       *
       * The previous state is read out of the cache rather than tracked in a
       * ref, so the first load — where there is no previous state — raises
       * nothing. Throwing confetti at somebody who has been paying for a year
       * every time the app starts would be worse than never celebrating.
       */
      const before = queryClient.getQueryData<AuthState>(KEY)
      queryClient.setQueryData(KEY, next)

      if (!before) return
      if (rank(next.tier) <= rank(before.tier)) return

      // Only what the new tier adds over the old one, so upgrading from
      // Basic+ to Pro does not re-announce everything Basic+ already had.
      celebrateUnlock(featuresGained(before.tier, next.tier))
    })
  }, [queryClient])

  return data
}

/** What moving between two tiers actually unlocks. Empty for a downgrade. */
export function featuresGained(from: Tier, to: Tier): Feature[] {
  if (rank(to) <= rank(from)) return []
  return TIER_ADDS[to].filter((feature) => !can(from, feature))
}

/**
 * Whether a paid feature is available.
 *
 * Returns `true` while the answer is still loading. That is deliberate: the
 * failure direction for the UI is to show the feature and let the main process
 * refuse the call, because flashing a paywall at a paying customer for the
 * half-second before their licence loads is worse than briefly showing a button
 * that then explains itself.
 *
 * It no longer returns true when there is no account server. That used to mean
 * "ungated", which was right while no licence backend existed and is now the
 * difference between a paywall and a giveaway — an unlicensed install is Free,
 * and Free is a real tier with real limits.
 */
export function useFeature(name: Feature): boolean {
  const auth = useAuthState()

  if (!auth) return true

  return can(auth.tier, name)
}

/** The tier in force, for anything that needs to name it. */
export function useTier(): Tier | undefined {
  return useAuthState()?.tier
}

/**
 * What to call the tier on screen.
 *
 * A trial says "Trial" rather than "Pro", because somebody fourteen days in
 * needs to know which of those they are on far more than they need the feature
 * list — and being told they are on Pro right up to the moment they are not is
 * how a trial ends in a complaint.
 */
export function useTierLabel(): string {
  const auth = useAuthState()
  if (!auth) return ''
  if (auth.trial.active) return 'Trial'
  return TIER_NAMES[auth.tier]
}

/** The tier a locked feature needs, for the upgrade prompt to name it. */
export function tierNameFor(feature: Feature): string {
  return TIER_NAMES[requires(feature)]
}
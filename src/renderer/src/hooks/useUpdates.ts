import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

const INITIAL: UpdateState = {
  status: 'idle',
  version: '',
  notes: '',
  percent: 0,
  error: ''
}

/**
 * The current update state, kept live.
 *
 * Read once on mount and then pushed from the main process, rather than
 * polled — a download reports progress several times a second and an interval
 * fast enough to follow it would be wasteful the rest of the time.
 */
export function useUpdates(): UpdateState & { check: () => void; install: () => void } {
  const [state, setState] = useState<UpdateState>(INITIAL)

  useEffect(() => {
    void window.solo
      .invoke('updates:get')
      .then(setState)
      .catch(() => {
        // Nothing to show is the right answer if the channel is unavailable.
      })

    return window.solo.on('updates:state', setState)
  }, [])

  return {
    ...state,
    check: () => {
      void window.solo.invoke('updates:check').then(setState).catch(() => {})
    },
    install: () => {
      void window.solo.invoke('updates:install').catch(() => {})
    }
  }
}

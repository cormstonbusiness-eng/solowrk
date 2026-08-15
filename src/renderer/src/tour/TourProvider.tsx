import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Tour } from './Tour'

const TOUR_KEY = 'tour.completed'

interface TourContextValue {
  /** Replay the tour on demand — wired to a button in Settings. */
  start: () => void
  isActive: boolean
}

const TourContext = createContext<TourContextValue>({ start: () => {}, isActive: false })

export function useTour(): TourContextValue {
  return useContext(TourContext)
}

/**
 * Shows the tour once per workspace. The flag lives in the workspace database
 * rather than in browser storage, so it travels with the workspace: moving your
 * folder to a new machine does not re-run the tour.
 */
export function TourProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.solo
      .invoke('state:get', { key: TOUR_KEY })
      .then((value) => {
        // Let the dashboard finish its entrance before the overlay lands on it.
        if (!cancelled && value !== '1') setTimeout(() => setIsActive(true), 550)
      })
      .catch(() => {
        // A tour that fails to start should never block the app.
      })

    return () => {
      cancelled = true
    }
  }, [])

  const finish = useCallback(() => {
    setIsActive(false)
    void window.solo.invoke('state:set', { key: TOUR_KEY, value: '1' })
  }, [])

  const start = useCallback(() => setIsActive(true), [])

  const value = useMemo(() => ({ start, isActive }), [start, isActive])

  return (
    <TourContext.Provider value={value}>
      {children}
      {isActive && <Tour onFinish={finish} />}
    </TourContext.Provider>
  )
}
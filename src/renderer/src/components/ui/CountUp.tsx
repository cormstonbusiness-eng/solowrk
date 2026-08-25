import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * A figure that counts up to its value when it first appears.
 *
 * The point is not decoration: a stat card that fades in at its final number
 * reads as static text, while one that arrives at it reads as a live figure
 * somebody is tracking. It runs once per mount, not on every re-render, or the
 * dashboard would re-count every time a query settled.
 *
 * Formatting is applied on every frame rather than at the end, so a currency
 * value never briefly renders as a bare number and then jumps.
 */
export function CountUp({
  value,
  format,
  duration = 600,
  className
}: {
  value: number
  format: (value: number) => string
  /** Milliseconds. 600 is the house figure; nothing here should exceed it. */
  duration?: number
  className?: string
}): React.JSX.Element {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(() => (reduced ? value : 0))

  // Counting from wherever it currently is, so a value that changes while the
  // page is open animates the difference rather than restarting from zero.
  const from = useRef(shown)

  useEffect(() => {
    if (reduced) {
      setShown(value)
      return
    }

    const start = performance.now()
    const origin = from.current
    let frame = 0

    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration)
      // Ease-out, matching the house curve closely enough that the figure and
      // the card it sits in feel like one movement.
      const eased = 1 - (1 - progress) ** 3

      const next = origin + (value - origin) * eased
      setShown(next)
      from.current = next

      if (progress < 1) frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, reduced])

  return <span className={className}>{format(shown)}</span>
}

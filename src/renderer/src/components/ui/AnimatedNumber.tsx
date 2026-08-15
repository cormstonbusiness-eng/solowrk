import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'
import { DURATION, EASE } from '@/lib/motion'

/**
 * Counts up on mount. Used for the money and metric tiles — it draws the eye to
 * figures that changed without needing a colour or a badge. Honours reduced
 * motion by jumping straight to the value.
 */
export function AnimatedNumber({
  value,
  format,
  className
}: {
  value: number
  format?: (n: number) => string
  className?: string
}): React.JSX.Element {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    const controls = animate(0, value, {
      duration: DURATION.page * 3,
      ease: EASE,
      onUpdate: setDisplay
    })
    return () => controls.stop()
  }, [value, reduced])

  return <span className={className}>{format ? format(display) : Math.round(display)}</span>
}

/** GBP with no pence — the default for headline figures. */
export function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}
import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'
import { DEFAULT_CURRENCY, formatMoney } from '@shared/currency'
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

/**
 * Whole units, no minor unit — the default for headline figures.
 *
 * Takes a *major* unit value, because that is what `AnimatedNumber` counts in
 * while it animates. It was called `gbp`, which said the quiet part out loud.
 */
export function wholeMoney(value: number, currency: string = DEFAULT_CURRENCY): string {
  return formatMoney(Math.round(value) * 100, currency)
}
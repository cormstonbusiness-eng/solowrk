import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { tickerSlots } from '@/lib/ticker'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * A figure that changes while you are looking at it — the running timer, and
 * anything else that ticks.
 *
 * Only the characters that actually change move. A clock re-rendering every
 * second changes one digit nine times out of ten, and the whole thing on the
 * tenth; animating all six every second would be a fidget, not feedback.
 *
 * Everything moves the same way, upwards: the digit leaving goes up and out,
 * the one replacing it comes up from below. Time runs one way, and a counter
 * whose digits rose on the way in and fell on the way out would read as undoing
 * itself.
 *
 * The slot keying — which is what stops the whole figure animating when it
 * grows a digit — lives in `@/lib/ticker`, where it can be tested.
 */
export function Ticker({
  value,
  className
}: {
  value: string
  className?: string
}): React.JSX.Element {
  const reduced = useReducedMotion()

  // Reduced motion is not the same thing done faster. A digit that has to be
  // read every second is the last place to put movement somebody has asked the
  // operating system to stop making.
  if (reduced) return <span className={cn('numeric', className)}>{value}</span>

  return (
    <span className={cn('numeric inline-flex items-baseline', className)}>
      {tickerSlots(value).map((slot) =>
        slot.animated ? (
          <span key={slot.key} className="relative inline-block w-[1ch] text-center">
            {/*
              An invisible copy of the digit, purely to give the slot its height
              and hold the baseline. Both animating digits are taken out of flow
              so they can pass each other, and something has to stay behind to
              say how tall the line is.
            */}
            <span className="invisible" aria-hidden>
              {slot.character}
            </span>

            <AnimatePresence initial={false}>
              <motion.span
                key={slot.character}
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -6, opacity: 0 }}
                transition={transition.flip}
                className="absolute inset-0"
              >
                {slot.character}
              </motion.span>
            </AnimatePresence>
          </span>
        ) : (
          <span key={slot.key}>{slot.character}</span>
        )
      )}
    </span>
  )
}

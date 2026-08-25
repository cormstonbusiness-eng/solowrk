import { AnimatePresence, motion } from 'motion/react'
import { swapVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * A panel that shows its empty state instead of its content, and swaps between
 * the two without a jump cut.
 *
 * The case that matters is the last item leaving: you archive the final
 * notification, and where there was a list there is suddenly an instructional
 * panel, arriving with no warning in the space your eye was already resting on.
 * The swap gives that a beat, which is enough for it to read as a consequence
 * of what you just did rather than as the screen changing under you.
 *
 * `mode="wait"` because these two never overlap: the list, and the message
 * saying there is no list, cannot both be true.
 *
 * The wrapper is a plain block. Where a list needs its own scrolling or flex
 * behaviour, pass it through `className` — the wrapper now sits between the
 * page and its content, so a layout the page was applying to the list has to
 * apply here instead.
 */
export function Swap({
  empty,
  fallback,
  children,
  className
}: {
  /** True when there is nothing to show. */
  empty: boolean
  /** Usually an <Empty />. */
  fallback: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        // The key is what makes this a swap rather than a re-render: React
        // keeps the same element across a content change, and motion only
        // animates between two things it can tell apart.
        key={empty ? 'empty' : 'content'}
        variants={swapVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className={cn(className)}
      >
        {empty ? fallback : children}
      </motion.div>
    </AnimatePresence>
  )
}

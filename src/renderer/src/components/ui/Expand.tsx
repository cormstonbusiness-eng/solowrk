import { motion } from 'motion/react'
import { expandContentVariants, expandVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * A row that opens and closes.
 *
 * Render it inside an <AnimatePresence> and mount it conditionally — it has no
 * `open` prop of its own, because a component that renders nothing when closed
 * still runs every hook in its children, and the panels this wraps do real
 * work.
 *
 * `overflow-hidden` is not optional, and is applied here rather than left to
 * the caller. Six places in the app animated a height without it, and the
 * result is content that stands still and sticks out of a box shrinking behind
 * it — the most common way this animation goes wrong.
 *
 * Padding belongs on `contentClassName`, never on the outer element. Height
 * animates to zero; padding does not, so a padded outer box collapses to a
 * visible stub and then disappears with a snap.
 */
export function Expand({
  children,
  className,
  contentClassName
}: {
  children: React.ReactNode
  /** The collapsing box. Margins go here; padding does not. */
  className?: string
  /** The content that fades in. Padding goes here. */
  contentClassName?: string
}): React.JSX.Element {
  return (
    <motion.div
      variants={expandVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn('overflow-hidden', className)}
    >
      <motion.div variants={expandContentVariants} className={contentClassName}>
        {children}
      </motion.div>
    </motion.div>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { transition } from '@/lib/motion'

/**
 * A panel that slides in from the right over whatever is already on screen.
 *
 * Deliberately not a modal. A modal says "deal with this before anything
 * else"; this says "here is more about the row you clicked", and the list
 * behind it stays visible and readable — which is the point, because the next
 * thing you usually want is the row underneath.
 *
 * So: no blur, and a much lighter scrim than `Modal` uses. The scrim is there
 * to catch a click, not to hide the page.
 */
export function Drawer({
  open,
  onClose,
  width = 460,
  children
}: {
  open: boolean
  onClose: () => void
  width?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
            onClick={onClose}
            className="absolute inset-0 bg-[rgba(6,6,8,0.28)]"
          />

          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={transition.page}
            style={{ width }}
            role="dialog"
            aria-modal="false"
            className="absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-line-strong bg-surface shadow-modal"
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

/** The drawer's own close button, for the header a caller supplies. */
export function DrawerClose({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="rounded-control p-1 text-faint transition-colors duration-150 hover:bg-raised hover:text-ink"
    >
      <X size={15} strokeWidth={1.75} />
    </button>
  )
}

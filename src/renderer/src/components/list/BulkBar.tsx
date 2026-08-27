import { AnimatePresence, motion } from 'motion/react'
import { Archive, Tag, Trash2, X } from 'lucide-react'
import { transition } from '@/lib/motion'

/**
 * What you can do to the rows you have picked.
 *
 * Slides up from the bottom and exists only while something is selected — the
 * list gains no permanent furniture for a thing that is usually not happening.
 *
 * It says the count first and in words. "3 tasks" before "Delete" is the
 * difference between confirming an action and discovering one: the number is
 * the part somebody needs to check, and putting it after the verb makes it
 * something they read afterwards.
 */
export function BulkBar({
  count,
  noun,
  onArchive,
  onTag,
  onDelete,
  onClear
}: {
  count: number
  /** Singular. "task" becomes "3 tasks" here. */
  noun: string
  /** Omit any of these and its button is not drawn. */
  onArchive?: () => void
  onTag?: () => void
  onDelete?: () => void
  onClear: () => void
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={transition.page}
          role="toolbar"
          aria-label={`${count} selected`}
          className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-card border border-line-strong bg-surface px-2 py-1.5 shadow-xl"
        >
          <span className="numeric px-2 text-[12.5px] text-ink">
            {count} {noun}
            {count === 1 ? '' : 's'}
          </span>

          <span aria-hidden className="mx-1 h-4 w-px bg-line" />

          {onTag && (
            <BulkAction onClick={onTag} label="Tag">
              <Tag size={13} strokeWidth={1.75} />
            </BulkAction>
          )}
          {onArchive && (
            <BulkAction onClick={onArchive} label="Archive">
              <Archive size={13} strokeWidth={1.75} />
            </BulkAction>
          )}
          {onDelete && (
            <BulkAction onClick={onDelete} label="Delete" danger>
              <Trash2 size={13} strokeWidth={1.75} />
            </BulkAction>
          )}

          <span aria-hidden className="mx-1 h-4 w-px bg-line" />

          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClear}
            className="rounded-control p-1.5 text-faint transition-colors hover:text-ink"
          >
            <X size={13} strokeWidth={1.75} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function BulkAction({
  onClick,
  label,
  danger = false,
  children
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        danger
          ? 'flex items-center gap-1.5 rounded-control px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-danger/10 hover:text-danger'
          : 'flex items-center gap-1.5 rounded-control px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink'
      }
    >
      {children}
      {label}
    </button>
  )
}

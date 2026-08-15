import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Backdrop plus panel. The panel scales from 98% rather than sliding, which
 * reads as "this belongs to the page underneath" instead of "a new screen".
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  width = 480,
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  footer?: React.ReactNode
  width?: number
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 grid place-items-center px-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
            onClick={onClose}
            className="absolute inset-0 bg-[rgba(6,6,8,0.6)]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={transition.modal}
            style={{ width }}
            className="relative max-h-[82vh] overflow-hidden rounded-panel border border-line-strong bg-surface shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
                {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-control p-1 text-faint transition-colors duration-150 hover:bg-raised hover:text-ink"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>

            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** Confirmation for destructive actions, with the consequence spelled out. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Delete',
  className
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body: string
  confirmLabel?: string
  className?: string
}): React.JSX.Element {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="rounded-control bg-danger px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:brightness-110"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className={cn('text-[13px] leading-relaxed text-muted', className)}>{body}</p>
    </Modal>
  )
}
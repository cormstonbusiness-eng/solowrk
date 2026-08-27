import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Clock, PoundSterling, Sparkles, TriangleAlert, X } from 'lucide-react'
import type { AppNotification, NotificationKind } from '@shared/types'
import { dismissToast, useLocalToasts } from '@/lib/celebrate'
import { EASE, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * How long a toast sits there before retreating on its own.
 *
 * Four seconds, with a bar draining along the bottom so the dwell is visible
 * rather than a surprise — a toast that vanishes mid-read is worse than one
 * that never appeared, and the bar is what turns "it went" into "it is going".
 * Hovering holds it indefinitely.
 */
const DWELL_MS = 4000

/** More than this on screen at once stops being information and starts being noise. */
const MAX_VISIBLE = 3

const ICONS: Record<NotificationKind, typeof Bell> = {
  info: Bell,
  due: Clock,
  late: TriangleAlert,
  money: PoundSterling,
  assistant: Sparkles
}

const TONES: Record<NotificationKind, string> = {
  info: 'text-muted',
  due: 'text-info',
  late: 'text-warning',
  money: 'text-success',
  assistant: 'text-accent'
}

/**
 * Notifications sliding up in the corner of the window.
 *
 * In-app rather than an OS toast because a Windows notification that appears
 * while you are in another window is gone forever, and the notification centre
 * needs the same thing on screen anyway. Dismissing a toast only takes it off
 * the screen — it stays unread in the centre until you actually deal with it.
 */
export function Toasts(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [visible, setVisible] = useState<AppNotification[]>([])

  /**
   * Toasts the renderer raised itself — an invoice paid, a licence unlocked.
   *
   * One stack, not two. Two systems in the same corner of the window overlap
   * the moment both fire, and the moment both fire is exactly the moment
   * something worth reading has happened.
   */
  const local = useLocalToasts()

  useEffect(() => {
    return window.solo.on('notifications:new', (notification) => {
      // Newest at the end: they stack upward, so the latest belongs closest to
      // where the eye already is.
      setVisible((current) => [...current, notification].slice(-MAX_VISIBLE))
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })
  }, [queryClient])

  const dismiss = (id: number): void => {
    if (id < 0) dismissToast(id)
    else setVisible((current) => current.filter((entry) => entry.id !== id))
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[320px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {[...local, ...visible].map((notification) => (
          <Toast
            key={notification.id}
            notification={notification}
            onDismiss={() => dismiss(notification.id)}
            onOpen={() => {
              // Local toasts carry negative ids and have no row to mark read.
              if (notification.id > 0) {
                void window.solo.invoke('notifications:read', { id: notification.id })
                void queryClient.invalidateQueries({ queryKey: ['notifications'] })
              }
              if (notification.link) navigate(notification.link)
              dismiss(notification.id)
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

function Toast({
  notification,
  onDismiss,
  onOpen
}: {
  notification: AppNotification
  onDismiss: () => void
  onOpen: () => void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const Icon = ICONS[notification.kind]

  // Hovering holds it: reaching for a toast that then leaves is maddening.
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(onDismiss, DWELL_MS)
    return () => clearTimeout(timer)
  }, [paused, onDismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 8, transition: { duration: 0.15, ease: EASE } }}
      transition={transition.page}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto relative overflow-hidden rounded-card border border-line-strong bg-overlay shadow-modal"
    >
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-2.5 p-3 text-left">
        <Icon
          size={14}
          strokeWidth={1.75}
          className={cn('mt-0.5 shrink-0', TONES[notification.kind])}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">{notification.title}</p>
          {notification.body && (
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{notification.body}</p>
          )}
        </div>
      </button>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute top-2 right-2 text-faint transition-colors duration-press ease-solo hover:text-ink"
      >
        <X size={12} strokeWidth={2} />
      </button>

      {/* Keyed on `paused` so hovering restarts the drain from full rather
          than resuming a bar that has already run most of its length — the
          timer above restarts too, and the two must agree. */}
      <motion.span
        key={String(paused)}
        aria-hidden
        className="absolute bottom-0 left-0 h-[2px] bg-accent"
        initial={{ width: paused ? '100%' : '100%' }}
        animate={{ width: paused ? '100%' : '0%' }}
        transition={{ duration: paused ? 0 : DWELL_MS / 1000, ease: 'linear' }}
      />

      {/* A quiet countdown, so the toast leaving is expected rather than sudden. */}
      {!paused && (
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: DWELL_MS / 1000, ease: 'linear' }}
          style={{ transformOrigin: 'left' }}
          className="h-[2px] bg-line-strong"
        />
      )}
    </motion.div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, Clock, PoundSterling, Sparkles, TriangleAlert, X } from 'lucide-react'
import type { AppNotification, NotificationKind } from '@shared/types'
import { EASE, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** How long a toast sits there before retreating on its own. */
const DWELL_MS = 8000

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

  useEffect(() => {
    return window.solo.on('notifications:new', (notification) => {
      // Newest at the end: they stack upward, so the latest belongs closest to
      // where the eye already is.
      setVisible((current) => [...current, notification].slice(-MAX_VISIBLE))
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })
  }, [queryClient])

  const dismiss = (id: number): void =>
    setVisible((current) => current.filter((entry) => entry.id !== id))

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[320px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {visible.map((notification) => (
          <Toast
            key={notification.id}
            notification={notification}
            onDismiss={() => dismiss(notification.id)}
            onOpen={() => {
              void window.solo.invoke('notifications:read', { id: notification.id })
              void queryClient.invalidateQueries({ queryKey: ['notifications'] })
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
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18, ease: EASE } }}
      transition={transition.modal}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto overflow-hidden rounded-card border border-line-strong bg-overlay shadow-2xl"
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
        className="absolute top-2 right-2 text-faint transition-colors hover:text-ink"
      >
        <X size={12} strokeWidth={2} />
      </button>

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

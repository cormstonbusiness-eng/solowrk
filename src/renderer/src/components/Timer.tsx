import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Square } from 'lucide-react'
import { useInvalidate } from '@/lib/api'
import { useWorkspace } from '@/hooks/useWorkspace'
import { formatElapsed } from '@/lib/format'
import { transition } from '@/lib/motion'

/**
 * Running timer in the titlebar — visible from every screen, because a timer
 * you cannot see is a timer you forget to stop.
 *
 * The elapsed count is derived from the start time each second rather than
 * incremented, so it stays correct if the app is suspended, the machine sleeps,
 * or a render is skipped.
 */
export function Timer(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [now, setNow] = useState(() => Date.now())

  // The titlebar renders during first-run setup too, before any database
  // exists, so the query must wait for a workspace rather than throwing.
  const workspace = useWorkspace()
  const ready = workspace.status?.state === 'ready'

  const { data: running } = useQuery({
    queryKey: ['time', 'running'],
    queryFn: () => window.solo.invoke('time:running'),
    enabled: ready,
    // Cheap poll so a timer started elsewhere in the app shows up here.
    refetchInterval: 5000
  })

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const stop = useMutation({
    mutationFn: (id: number) => window.solo.invoke('time:stop', { id }),
    onSuccess: () => invalidate(['time', 'projects', 'finance'])
  })

  const elapsed = running
    ? Math.max(0, Math.floor((now - new Date(running.entry.startedAt).getTime()) / 1000))
    : 0

  return (
    <AnimatePresence>
      {running && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={transition.press}
          className="no-drag flex items-center gap-2 rounded-full bg-raised py-0.5 pr-0.5 pl-2.5"
        >
          {/* A quiet pulse: enough to notice, not enough to nag. */}
          <motion.span
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="h-1.5 w-1.5 rounded-full bg-success"
          />
          <span className="max-w-[150px] truncate text-[11px] text-muted">
            {running.entry.projectName ?? 'No project'}
          </span>
          <span className="numeric text-[11.5px] text-ink">{formatElapsed(elapsed)}</span>
          <button
            type="button"
            aria-label="Stop timer"
            onClick={() => stop.mutate(running.entry.id)}
            className="grid h-5 w-5 place-items-center rounded-full text-faint transition-colors hover:bg-danger hover:text-white"
          >
            <Square size={9} strokeWidth={3} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

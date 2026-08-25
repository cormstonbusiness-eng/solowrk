import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Square } from 'lucide-react'
import { useInvalidate } from '@/lib/api'
import { useWorkspace } from '@/hooks/useWorkspace'
import { formatElapsed } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

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
  const [open, setOpen] = useState(false)

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

  // A timer that stops while its own popover is open would leave the popover
  // hanging over nothing.
  useEffect(() => {
    if (!running) setOpen(false)
  }, [running])

  const stop = useMutation({
    mutationFn: (id: number) => window.solo.invoke('time:stop', { id }),
    onSuccess: () => {
      setOpen(false)
      invalidate(['time', 'projects', 'finance'])
    }
  })

  const elapsed = running
    ? Math.max(0, Math.floor((now - new Date(running.entry.startedAt).getTime()) / 1000))
    : 0

  return (
    <div className="relative">
      <AnimatePresence>
        {running && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={transition.press}
            className="no-drag flex items-center gap-2 rounded-full bg-raised py-0.5 pr-0.5 pl-2.5"
          >
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
              className="flex items-center gap-2 rounded-full"
            >
              {/*
                A quiet pulse: enough to notice, not enough to nag. Two seconds
                and never fully out, because a dot that blinks to nothing reads
                as a warning light rather than as something ticking along.
              */}
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="h-1.5 w-1.5 rounded-full bg-success"
              />
              <span className="max-w-[150px] truncate text-[11px] text-muted">
                {running.entry.projectName ?? 'No project'}
              </span>
              {/* Fixed-width digits, so the seconds changing never reflows the
                  pill or nudges the project name beside it. */}
              <span className="numeric text-[11.5px] text-ink">{formatElapsed(elapsed)}</span>
            </button>

            <button
              type="button"
              aria-label="Stop timer"
              onClick={() => stop.mutate(running.entry.id)}
              className="grid h-5 w-5 place-items-center rounded-full text-faint transition-colors duration-press ease-solo hover:bg-danger hover:text-white"
            >
              <Square size={9} strokeWidth={3} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && running && (
          <TimerPopover
            entryId={running.entry.id}
            projectId={running.entry.projectId}
            notes={running.entry.notes}
            elapsed={elapsed}
            onClose={() => setOpen(false)}
            onStop={() => stop.mutate(running.entry.id)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Switch project, leave a note, or stop.
 *
 * The three things anybody wants from a running timer, and all three were
 * previously only reachable by navigating to the Time page and finding the
 * entry — which is exactly the friction that makes people track badly and then
 * bill from memory.
 *
 * The note saves as you type rather than on a button, because a note that
 * needed confirming is a note that gets lost when the timer is stopped from
 * the pill instead.
 */
function TimerPopover({
  entryId,
  projectId,
  notes,
  elapsed,
  onClose,
  onStop
}: {
  entryId: number
  projectId: number | null
  notes: string
  elapsed: number
  onClose: () => void
  onStop: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState(notes)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const update = useMutation({
    mutationFn: (patch: { projectId?: number | null; notes?: string }) =>
      window.solo.invoke('time:update', { id: entryId, patch }),
    onSuccess: () => invalidate(['time'])
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced, so a sentence typed at speed is one write rather than forty.
  useEffect(() => {
    if (draft === notes) return
    const id = setTimeout(() => update.mutate({ notes: draft }), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mutation is stable
  }, [draft])

  return (
    <>
      {/* Catches the click that closes it, without a backdrop dark enough to
          read as a modal — this is a popover, and the app behind it is not
          blocked. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />

      <motion.div
        role="dialog"
        aria-label="Running timer"
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={transition.press}
        className={cn(
          'no-drag absolute top-[calc(100%+8px)] left-1/2 z-50 w-[264px] -translate-x-1/2',
          'rounded-card border border-line bg-overlay p-3 shadow-modal'
        )}
      >
        <p className="numeric mb-3 text-center text-[20px] font-semibold text-ink">
          {formatElapsed(elapsed)}
        </p>

        <label className="type-label mb-1 block text-faint">Project</label>
        <select
          value={projectId ?? ''}
          onChange={(event) =>
            update.mutate({ projectId: event.target.value ? Number(event.target.value) : null })
          }
          className="mb-3 h-8 w-full rounded-control border border-line bg-raised px-2 text-[12.5px] text-ink"
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <label className="type-label mb-1 block text-faint">Note</label>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What are you working on?"
          className="mb-3 h-8 w-full rounded-control border border-line bg-raised px-2 text-[12.5px] text-ink placeholder:text-faint"
        />

        <button
          type="button"
          onClick={onStop}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-danger/12 text-[12.5px] font-medium text-danger transition-colors duration-press ease-solo hover:bg-danger hover:text-white"
        >
          <Square size={10} strokeWidth={3} />
          Stop timer
        </button>
      </motion.div>
    </>
  )
}

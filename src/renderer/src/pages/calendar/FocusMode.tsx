import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Pause, SkipForward } from 'lucide-react'
import type { CalendarBlockWithContext } from '@shared/types'
import { minutesBetween, nowStamp } from '@shared/calendar'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { durationLabel } from './grid'

/**
 * One block, and nothing else.
 *
 * §17.6. The bridge between planning and doing that most tools never build:
 * a calendar block is a promise about the next two hours, and every other
 * calendar leaves you to keep it on your own. Here the promise starts a timer,
 * fills a ring as it goes, and asks a single question when it is up.
 *
 * Everything else fades rather than disappearing. The week is still there —
 * this is a way of looking at one hour of it, not a different screen.
 */

/** §17.6: how long the fade takes, and how long the ring takes to catch up. */
const FADE_MS = 250

export function FocusMode({
  block,
  startedAt,
  onExtend,
  onStop,
  onNext
}: {
  block: CalendarBlockWithContext
  /** When the session began, as a wall stamp. Null before the timer answers. */
  startedAt: string | null
  onExtend: () => void
  onStop: () => void
  onNext: () => void
}): React.JSX.Element {
  const planned = Math.max(1, minutesBetween(block.startsAt, block.endsAt))
  const [now, setNow] = useState(() => nowStamp())

  // A second, because this is the one place a clock is being watched. Every
  // other timer in the calendar ticks once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(nowStamp()), 1_000)
    return () => clearInterval(id)
  }, [])

  const elapsed = startedAt ? Math.max(0, minutesBetween(startedAt, now)) : 0
  const fraction = Math.min(1, elapsed / planned)
  const done = elapsed >= planned

  // A ring drawn as a stroke rather than a bar, because it traces the block's
  // own edge — the progress belongs to the thing, not to a widget beside it.
  const radius = 120
  const circumference = 2 * Math.PI * radius

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: FADE_MS / 1000 }}
      className="absolute inset-0 z-50 flex items-center justify-center"
    >
      {/* 8%, not 0. The week is still there; you are looking at one hour of
          it, and losing the context would make this a different screen. */}
      <div className="absolute inset-0 bg-ground/92 backdrop-blur-[1px]" onClick={onStop} />

      <motion.div
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        transition={{ duration: FADE_MS / 1000 }}
        className="relative grid place-items-center"
      >
        <svg width={radius * 2 + 16} height={radius * 2 + 16} className="-rotate-90">
          <circle
            cx={radius + 8}
            cy={radius + 8}
            r={radius}
            fill="none"
            strokeWidth={2}
            className="stroke-line"
          />
          <circle
            cx={radius + 8}
            cy={radius + 8}
            r={radius}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className={cn(
              'transition-[stroke-dashoffset] duration-1000 ease-linear',
              done ? 'stroke-danger' : 'stroke-accent'
            )}
          />
        </svg>

        <div className="absolute flex max-w-[220px] flex-col items-center gap-1 text-center">
          <p className="text-[10.5px] tracking-[0.08em] text-faint uppercase">
            {block.projectName ?? 'Focus'}
          </p>
          <p className="text-[19px] leading-tight font-medium text-balance text-ink">
            {block.title}
          </p>
          <p className="numeric mt-1 text-[26px] tabular-nums text-ink">
            {durationLabel(Math.max(0, planned - elapsed))}
          </p>
          <p className="numeric text-[11px] text-faint">of {durationLabel(planned)}</p>
        </div>
      </motion.div>

      {/* The question, and only once the ring is full. Asking earlier would
          be interrupting the thing this exists to protect. */}
      {done && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-10 flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 shadow-xl"
        >
          <p className="mr-1 text-[12.5px] text-muted">That is the hour.</p>
          <Button variant="outline" size="sm" onClick={onExtend}>
            Keep going
          </Button>
          <Button variant="outline" size="sm" onClick={onNext}>
            <SkipForward size={12} strokeWidth={1.75} />
            Next block
          </Button>
          <Button variant="primary" size="sm" onClick={onStop}>
            <Pause size={12} strokeWidth={1.75} />
            Stop
          </Button>
        </motion.div>
      )}

      <p className="absolute bottom-4 text-[11px] text-faint">Esc to stop</p>
    </motion.div>
  )
}

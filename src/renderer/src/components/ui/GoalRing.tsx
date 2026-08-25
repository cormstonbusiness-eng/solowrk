import { motion, useReducedMotion } from 'motion/react'
import type { GoalProgress } from '@shared/types'
import { GOAL_KINDS } from '@shared/types'
import { formatMoney } from '@/lib/format'
import { useTokens } from '@/lib/tokens'
import { cn } from '@/lib/utils'

/**
 * One goal, as a ring.
 *
 * A flat 0% bar is invisible, which made a brand-new goal look like a broken
 * component rather than a new one. A ring always draws its full track, so an
 * untouched goal reads as deliberate and empty rather than as nothing.
 *
 * The pace line is the part that earns its place. "£3,000 of £8,000" is a
 * fact; "£3,000 needed in 6 days — £500 a day" is a decision, and it is the
 * only form of this information anybody acts on.
 */
const SIZE = 64
const STROKE = 6
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function GoalRing({
  goal,
  onOpen
}: {
  goal: GoalProgress
  onOpen: () => void
}): React.JSX.Element {
  const tokens = useTokens()
  const reduced = useReducedMotion()

  const money = GOAL_KINDS.find((entry) => entry.value === goal.kind)?.money ?? false
  const show = (value: number): string => (money ? formatMoney(value) : String(value))

  const met = goal.target > 0 && goal.current >= goal.target
  const behind = !met && goal.projected !== null && goal.target > 0 && goal.projected < goal.target

  // `share` is basis points, as every percentage in this app is. Capped so a
  // goal at 140% does not wind the ring past its own start.
  const fraction = Math.min(1, Math.max(0, goal.share / 10_000))

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3.5 rounded-control p-1 text-left transition-colors duration-press ease-solo hover:bg-surface-hover"
    >
      <span className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90" aria-hidden>
          <defs>
            <linearGradient id={`goal-${goal.id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={met ? tokens.success : tokens['accent-press']} />
              <stop offset="100%" stopColor={met ? tokens.success : tokens['accent-hover']} />
            </linearGradient>
          </defs>

          {/* The track is always drawn, at full circumference. This is what
              stops an empty goal from looking like a rendering failure. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={tokens.raised}
            strokeWidth={STROKE}
          />

          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={`url(#goal-${goal.id})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            initial={reduced ? false : { strokeDashoffset: CIRCUMFERENCE }}
            animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - fraction) }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>

        <span className="numeric absolute inset-0 grid place-items-center text-[12.5px] font-semibold text-ink">
          {Math.round(goal.share / 100)}%
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-ink">{goal.name}</span>
        <span className="numeric mt-0.5 block text-[11.5px] text-faint">
          {show(goal.current)} of {show(goal.target)}
        </span>
        <span
          className={cn(
            'mt-1 block truncate text-[11px]',
            met ? 'text-success' : behind ? 'text-warning' : 'text-muted'
          )}
        >
          {pace(goal, show, met, behind)}
        </span>
      </span>
    </button>
  )
}

/**
 * What the numbers mean, in a sentence.
 *
 * Ordered by what somebody would want told first: whether it is done, then
 * what it would take, then how long is left. A goal with no deadline gets the
 * honest "no deadline" rather than a rate invented from a period that does not
 * exist.
 */
function pace(
  goal: GoalProgress,
  show: (value: number) => string,
  met: boolean,
  behind: boolean
): string {
  if (met) return 'Reached'

  const remaining = Math.max(0, goal.target - goal.current)
  if (goal.daysLeft === null) return `${show(remaining)} to go`
  if (goal.daysLeft <= 0) return `Finished at ${show(goal.current)}`

  const perDay = remaining / goal.daysLeft
  const days = `${goal.daysLeft} day${goal.daysLeft === 1 ? '' : 's'}`

  if (behind) return `${show(remaining)} in ${days} — ${show(Math.ceil(perDay))} a day`
  return `On track — ${show(Math.ceil(perDay))} a day for ${days}`
}

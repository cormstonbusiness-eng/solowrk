import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { CountUp } from '@/components/ui/CountUp'
import { Sparkline } from '@/components/ui/Sparkline'
import { useTokens, type TokenName } from '@/lib/tokens'
import { cn } from '@/lib/utils'

/**
 * One of the four figures at the top of the dashboard.
 *
 * This row is the first thing anybody sees, and as four bare zeroes it said
 * nothing at all — it read as an app that had failed to load rather than one
 * waiting for work. So a card with no history does not render a flat figure
 * and stop: it dims the number, draws a dashed baseline where the line will
 * be, and offers the one action that would put something there.
 *
 * The whole card is a link. A figure that reports a problem without offering
 * the way to deal with it is a nag.
 */
export interface Stat {
  label: string
  value: number
  format: (value: number) => string
  icon: LucideIcon
  /** Which semantic token colours the icon, the line and the delta. */
  tone: TokenName
  /** Six periods, oldest first. Fewer than two draws the dashed baseline. */
  history: number[]
  /** Shown when there is nothing yet — the way to make there be something. */
  empty: string
  to: string
}

/**
 * The change against the period before, as a percentage.
 *
 * Null rather than a number in the two cases where a percentage would lie:
 * nothing to compare against, and growth from zero, which is infinite and
 * renders as a meaningless spike.
 */
function delta(history: number[]): number | null {
  if (history.length < 2) return null

  const current = history[history.length - 1]!
  const previous = history[history.length - 2]!
  if (previous === 0) return null

  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

/**
 * How long the success border sits before fading.
 *
 * Longer than the 250ms interaction cap on purpose: this is a celebration, not
 * a response to a click, and at 250ms it reads as a rendering glitch rather
 * than as the app noticing something good.
 */
const FLASH_MS = 400

export function StatCard({
  stat,
  onOpen,
  flash
}: {
  stat: Stat
  onOpen: () => void
  /** Set once when something worth marking landed in this figure. */
  flash?: boolean
}): React.JSX.Element {
  const tokens = useTokens()

  const reduced = useReducedMotion()
  const [flashing, setFlashing] = useState(false)

  useEffect(() => {
    // Under reduced motion the border would snap green and snap back, which is
    // a flicker rather than a celebration. The count-up still lands the news.
    if (!flash || reduced) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash, reduced])
  const change = delta(stat.history)
  const blank = stat.value === 0 && stat.history.every((value) => value === 0)

  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      aria-label={`${stat.label}: ${stat.format(stat.value)}`}
      className="group flex flex-col overflow-hidden p-5"
      // Border only, and it fades out rather than snapping: the card is
      // acknowledging something, not demanding attention.
      style={
        flashing
          ? { borderColor: tokens.success, transition: 'border-color 120ms ease-out' }
          : { transition: `border-color ${FLASH_MS}ms ease-out` }
      }
    >
      <span
        aria-hidden
        className="mb-3 grid h-8 w-8 place-items-center rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${tokens[stat.tone]} 12%, transparent)` }}
      >
        <stat.icon size={15} strokeWidth={1.75} style={{ color: tokens[stat.tone] }} />
      </span>

      <span className="type-label mb-1.5 text-faint">{stat.label}</span>

      <span className="flex items-baseline gap-2">
        <CountUp
          value={stat.value}
          format={stat.format}
          className={cn('type-figure', blank ? 'text-faint' : 'text-ink')}
        />
        {change !== null && (
          <span
            className="rounded-chip px-1.5 py-0.5 text-[11px] font-semibold"
            style={{
              color: change >= 0 ? tokens.success : tokens.danger,
              backgroundColor: `color-mix(in srgb, ${
                change >= 0 ? tokens.success : tokens.danger
              } 12%, transparent)`
            }}
          >
            {change >= 0 ? '+' : ''}
            {change}%
          </span>
        )}
      </span>

      {change !== null && <span className="type-meta mt-1 text-faint">vs last period</span>}

      {blank ? (
        <span className="mt-3 inline-flex items-center gap-1 text-[12px] text-accent">
          {stat.empty}
          <ArrowRight
            size={12}
            strokeWidth={2}
            className="transition-transform duration-press ease-solo group-hover:translate-x-0.5"
          />
        </span>
      ) : (
        // Bled to the card's edges: a line inset by the padding reads as a
        // chart in a box, and this is meant to read as the card's own floor.
        <Sparkline
          values={stat.history}
          colour={tokens[stat.tone]}
          className="-mx-5 -mb-5 mt-4 h-10 w-[calc(100%+2.5rem)]"
        />
      )}
    </Card>
  )
}

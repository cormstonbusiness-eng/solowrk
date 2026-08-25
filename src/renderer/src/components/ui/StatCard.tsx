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

export function StatCard({ stat, onOpen }: { stat: Stat; onOpen: () => void }): React.JSX.Element {
  const tokens = useTokens()
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

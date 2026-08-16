import { motion } from 'motion/react'
import type { PillarShare } from '@shared/types'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Where your output actually went, against where you meant it to go.
 *
 * A single stacked bar rather than a chart per pillar: the question is "is this
 * balanced", which is a question about proportions, and proportions read better
 * as one bar than as five numbers.
 */
export function PillarMix({ mix }: { mix: PillarShare[] }): React.JSX.Element {
  const total = mix.reduce((sum, row) => sum + row.posts, 0)

  if (total === 0) {
    return (
      <p className="text-[12px] text-faint">
        Nothing planned in this range yet — the mix appears once there is something to weigh.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-2.5 flex h-2 overflow-hidden rounded-full bg-raised">
        {mix
          .filter((row) => row.posts > 0)
          .map((row) => (
            <motion.div
              key={row.pillarId ?? 'none'}
              layout
              transition={transition.layout}
              style={{
                width: `${row.actualShare / 100}%`,
                backgroundColor: row.colour
              }}
              title={`${row.name}: ${row.posts} of ${total}`}
            />
          ))}
      </div>

      <div className="flex flex-col gap-1">
        {mix.map((row) => {
          // Only meaningful when a target was actually set; a pillar with no
          // target is not "under" anything.
          const drift = row.targetShare > 0 ? row.actualShare - row.targetShare : 0
          const off = Math.abs(drift) >= 1000

          return (
            <div key={row.pillarId ?? 'none'} className="flex items-center gap-2 text-[11.5px]">
              <span
                style={{ backgroundColor: row.colour }}
                className="h-2 w-2 shrink-0 rounded-full"
              />
              <span className="min-w-0 flex-1 truncate text-muted">{row.name}</span>
              <span className="numeric text-faint">{row.posts}</span>
              <span className="numeric w-[42px] text-right text-ink">
                {Math.round(row.actualShare / 100)}%
              </span>
              <span
                className={cn(
                  'numeric w-[68px] text-right',
                  row.targetShare === 0 ? 'text-faint' : off ? 'text-warning' : 'text-faint'
                )}
              >
                {row.targetShare === 0
                  ? '—'
                  : `${drift > 0 ? '+' : ''}${Math.round(drift / 100)}%`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
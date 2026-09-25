import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The strip of headline figures above the dashboard grid.
 *
 * Six tall cards, each an icon badge over a figure over a two-line label. It is
 * deliberately *not* a module: these are the numbers somebody opens the app to
 * see, so they should not be something you can remove by accident or have to go
 * and add. Everything below is arrangeable; this is the fixed thing, which is
 * also part of what makes the grid safe to rearrange.
 *
 * The figures are duplicated from the modules below on purpose. A strip that
 * showed different numbers from the cards under it would be worse than no
 * strip, and a strip that showed numbers found nowhere else would be a seventh
 * module pretending not to be one. This is the same information, read first.
 */
export interface QuickStat {
  icon: LucideIcon
  value: string
  label: string
  /**
   * The one card drawn in reverse.
   *
   * Exactly one, and the component does not enforce it because a caller passing
   * two would be making a decision rather than a mistake — but the point of it
   * is to be singular. A strip where three cards shout is a strip where none
   * does, and the eye needs somewhere to land first.
   */
  lead?: boolean
}

export function QuickStats({ items }: { items: QuickStat[] }): React.JSX.Element {
  return (
    <section className="mb-4 flex flex-wrap items-stretch gap-3" aria-label="Quick stats">
      {/*
        The title block sits in the row rather than above it, so the strip reads
        as one object. It has no border of its own: giving it the same card
        treatment as the figures would make it look like a seventh statistic
        with its number missing.
      */}
      <div className="flex min-w-[132px] flex-col justify-center pr-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Quick stats</h2>
        <p className="mt-1 text-[11.5px] leading-[1.4] text-muted">
          Where the business
          <br />
          stands today.
        </p>
      </div>

      {items.map((item) => {
        const Icon = item.icon

        return (
          <div
            key={item.label}
            className={cn(
              'flex min-w-[112px] flex-1 flex-col items-center justify-center gap-2.5',
              'rounded-module px-3 py-5 text-center',
              'border border-line bg-surface'
            )}
          >
            {/*
              A circle rather than the rounded square the modules use. The badge
              is the only round thing in the design, which is what stops six
              small tiles reading as six more cards.
            */}
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                item.lead ? 'bg-invert text-invert-ink' : 'bg-shell text-muted'
              )}
            >
              <Icon size={16} strokeWidth={1.75} />
            </span>

            <span className="block text-[20px] leading-none font-semibold tracking-[-0.02em] text-ink">
              {item.value}
            </span>

            {/*
              Two lines by design. The label wraps rather than truncating,
              because "Awaiting payment" cut to "Awaiting…" is a figure with no
              meaning attached — and a fixed height keeps the six cards level
              whether their label runs to one line or two.
            */}
            <span className="block min-h-[26px] text-[11px] leading-[1.3] text-muted">
              {item.label}
            </span>
          </div>
        )
      })}
    </section>
  )
}

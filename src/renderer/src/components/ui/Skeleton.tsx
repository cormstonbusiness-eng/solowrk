import { cn } from '@/lib/utils'

/**
 * A shimmering block where content is about to be.
 *
 * Skeletons rather than spinners, throughout. A spinner says "something is
 * happening"; a skeleton says "something is happening, here, and it will be
 * roughly this shape" — which stops the layout jumping when it lands, and
 * stops the half-second of loading reading as a blank screen.
 *
 * The shimmer is a background-position animation on a gradient, so it costs
 * the compositor nothing and stops dead under the app's global reduced-motion
 * rule, leaving a plain block that still does the layout-holding job.
 */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('block rounded-chip bg-raised', 'animate-shimmer', className)}
    />
  )
}

/**
 * A card's worth of skeleton: a label, a figure, and a line under it.
 *
 * Matches the real stat card's rhythm closely enough that nothing moves when
 * the data arrives, which is the entire point of drawing one.
 */
export function SkeletonStat(): React.JSX.Element {
  return (
    <div className="lit-card rounded-card border border-line bg-surface p-5 shadow-card">
      <Skeleton className="mb-3 h-8 w-8 rounded-full" />
      <Skeleton className="mb-2 h-2.5 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mt-4 h-10 w-full" />
    </div>
  )
}

/** A row in a list, at the height rows actually are. */
export function SkeletonRow({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex h-10 items-center gap-2.5 px-2', className)}>
      <Skeleton className="h-6 w-6 shrink-0" />
      <Skeleton className="h-2.5 flex-1" />
      <Skeleton className="h-2.5 w-16 shrink-0" />
    </div>
  )
}

import { cn } from '@/lib/utils'

/**
 * A panel, lit from above.
 *
 * The top border is a shade brighter than the other three, which is what makes
 * a flat dark rectangle read as a surface catching light rather than as an
 * outlined box. `interactive` adds the hover treatment for cards that are
 * themselves a button: fill, brighter border and a 2px lift, never a shadow —
 * a shadow appearing on hover reads as the card detaching from the page.
 */
export function Card({
  className,
  interactive,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { interactive?: boolean }): React.JSX.Element {
  return (
    <div
      className={cn(
        'lit-card relative rounded-card border border-line bg-surface p-5 shadow-card',
        interactive &&
          'cursor-pointer transition-[background-color,border-color,transform] duration-press ease-solo hover:-translate-y-[2px] hover:border-line-strong hover:bg-surface-hover',
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  action,
  className
}: {
  title: string
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-[13px] font-medium text-ink">{title}</h2>
      {action}
    </div>
  )
}
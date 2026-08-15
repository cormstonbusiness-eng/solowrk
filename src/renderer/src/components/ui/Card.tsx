import { cn } from '@/lib/utils'

export function Card({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface p-4', className)}
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
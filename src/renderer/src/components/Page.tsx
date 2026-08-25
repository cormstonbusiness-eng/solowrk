import { motion } from 'motion/react'
import { pageVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Every route renders inside this. It owns the entrance/exit animation and the
 * page header, so pages never re-implement either and transitions stay uniform
 * across the app.
 */
export function Page({
  title,
  description,
  actions,
  before,
  children,
  className,
  display
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  /** Rendered above the title — the dashboard puts the business logo here. */
  before?: React.ReactNode
  children?: React.ReactNode
  className?: string
  /**
   * The greeting on the dashboard, at the Display step rather than Heading.
   *
   * One screen in the app is somebody's first screen every morning, and it is
   * the only one that gets to open at 32px. Everywhere else, a page title that
   * shouted would just be competing with the work.
   */
  display?: boolean
}): React.JSX.Element {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      // relative and z-10 keep every page above the seasonal layer, which sits
      // at z-0 inside the same pane. One change here covers the whole app.
      className="relative z-10 flex h-full flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 px-7 pt-6 pb-4">
        <div>
          {before}
          <h1 className={cn(display ? 'type-display' : 'type-heading', 'text-ink')}>{title}</h1>
          {description && <p className="type-body mt-1.5 text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto px-7 pb-7', className)}>{children}</div>
    </motion.div>
  )
}
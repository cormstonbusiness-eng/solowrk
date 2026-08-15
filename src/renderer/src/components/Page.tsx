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
  children,
  className
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex h-full flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 px-7 pt-6 pb-4">
        <div>
          <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h1>
          {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto px-7 pb-7', className)}>{children}</div>
    </motion.div>
  )
}
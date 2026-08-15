import { forwardRef } from 'react'
import { motion } from 'motion/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

const button = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-control font-medium',
    'transition-colors duration-150 whitespace-nowrap',
    'disabled:pointer-events-none disabled:opacity-45'
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
        secondary: 'bg-raised text-ink hover:bg-hover',
        ghost: 'text-muted hover:bg-raised hover:text-ink',
        outline: 'border border-line-strong text-ink hover:bg-raised',
        danger: 'bg-danger/12 text-danger hover:bg-danger hover:text-white'
      },
      size: {
        sm: 'h-7 px-2.5 text-[12px]',
        md: 'h-8.5 px-3.5 text-[13px]',
        lg: 'h-10 px-4 text-sm'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
)

export interface ButtonProps
  extends Omit<React.ComponentPropsWithoutRef<'button'>, 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'>,
    VariantProps<typeof button> {}

/**
 * Press feedback is a scale, not a colour flip — it reads as physical and it
 * survives on every variant without needing a second set of tokens.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref
) {
  return (
    <motion.button
      ref={ref}
      whileTap={props.disabled ? undefined : { scale: 0.97 }}
      transition={transition.press}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  )
})
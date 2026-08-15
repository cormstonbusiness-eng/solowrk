import { forwardRef, useId } from 'react'
import { motion } from 'motion/react'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

const inputStyles = [
  'h-9 w-full rounded-control border border-line bg-raised px-3 text-[13px] text-ink',
  'placeholder:text-faint transition-colors duration-150',
  'hover:border-line-strong focus:border-accent focus:outline-none',
  'disabled:opacity-50'
].join(' ')

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  )
}

export const TextInput = forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputStyles, className)} {...props} />
  }
)

/**
 * Money is stored as integer pence everywhere, so this edits pounds on screen
 * and hands back pence — the conversion lives here rather than in every caller.
 */
export function MoneyInput({
  pence,
  onChangePence,
  ...props
}: {
  pence: number
  onChangePence: (pence: number) => void
} & Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'>): React.JSX.Element {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-faint">
        £
      </span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={pence === 0 ? '' : (pence / 100).toString()}
        onChange={(event) => {
          const pounds = Number.parseFloat(event.target.value)
          onChangePence(Number.isFinite(pounds) ? Math.round(pounds * 100) : 0)
        }}
        className={cn(inputStyles, 'numeric pl-7')}
        {...props}
      />
    </div>
  )
}

export function NumberInput({
  value,
  onChangeValue,
  suffix,
  ...props
}: {
  value: number
  onChangeValue: (value: number) => void
  suffix?: string
} & Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'>): React.JSX.Element {
  return (
    <div className="relative">
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChangeValue(Number.parseInt(event.target.value, 10) || 0)}
        className={cn(inputStyles, 'numeric', suffix && 'pr-14')}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-faint">
          {suffix}
        </span>
      )}
    </div>
  )
}

/** Spring-driven knob — the one place a bit of bounce is welcome. */
export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  const id = useId()

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-[13px] text-ink">
          {label}
        </label>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-[22px] w-[38px] shrink-0 rounded-full p-[3px] transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line-strong'
        )}
      >
        <motion.span
          layout
          transition={transition.layout}
          className="block h-4 w-4 rounded-full bg-white"
          style={{ marginLeft: checked ? 16 : 0 }}
        />
      </button>
    </div>
  )
}
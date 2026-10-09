import { forwardRef, useId } from 'react'
import { motion } from 'motion/react'
import { transition } from '@/lib/motion'
import {
  DEFAULT_CURRENCY,
  currencyInfo,
  moneySymbol,
  symbolLeads
} from '@shared/currency'
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
 * Money is stored as integer minor units everywhere, so this edits major units
 * on screen and hands back minor — the conversion lives here rather than in
 * every caller.
 *
 * One of only two places in the app allowed to divide by a currency's minor
 * unit; the other is `@shared/currency`. A test enforces that.
 */
export function MoneyInput({
  pence,
  onChangePence,
  currency = DEFAULT_CURRENCY,
  ...props
}: {
  pence: number
  onChangePence: (pence: number) => void
  /** Defaults to sterling, which is what the app assumed before it travelled. */
  currency?: string
} & Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'>): React.JSX.Element {
  const info = currencyInfo(currency)
  const divisor = 10 ** info.minorUnits
  const symbol = moneySymbol(currency)
  /*
    Several locales put the symbol after the number. Neither sterling nor the
    euro does, so this is leaning forward rather than solving a problem the app
    has — but the alternative is a euro input with the symbol on the wrong side
    the day a country that suffixes is added.
  */
  const leads = symbolLeads(currency)

  return (
    <div className="relative">
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-[13px] text-faint',
          leads ? 'left-3' : 'right-3'
        )}
      >
        {symbol}
      </span>
      <input
        type="number"
        min={0}
        step={info.minorUnits === 0 ? '1' : '0.01'}
        value={pence === 0 ? '' : (pence / divisor).toString()}
        onChange={(event) => {
          const major = Number.parseFloat(event.target.value)
          onChangePence(Number.isFinite(major) ? Math.round(major * divisor) : 0)
        }}
        className={cn(inputStyles, 'numeric', leads ? 'pl-7' : 'pr-7')}
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
  hint,
  hideLabel
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  /**
   * Hide the label visually but keep it for screen readers.
   *
   * For a switch sitting in a row that already names the thing it belongs to,
   * where repeating the name would be noise on screen. Passing an empty string
   * instead would leave a switch with no accessible name at all, which is the
   * one thing this must not become.
   */
  hideLabel?: boolean
}): React.JSX.Element {
  const id = useId()

  return (
    <div className={cn('flex items-start gap-4', !hideLabel && 'justify-between')}>
      <div className={cn('flex flex-col gap-0.5', hideLabel && 'sr-only')}>
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
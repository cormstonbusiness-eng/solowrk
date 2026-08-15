import { ChevronDown } from 'lucide-react'
import { COLOUR_CHOICES } from '@shared/types'
import { cn } from '@/lib/utils'

/**
 * A styled native select. Native beats a custom listbox here: keyboard support,
 * type-ahead and screen readers come free, and the app never needs a popup
 * layer fighting with modals and the tour overlay.
 */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  className
}: {
  value: T | null
  onChange: (value: T | null) => void
  options: { value: T; label: string }[]
  placeholder?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value === null ? '' : String(value)}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') return onChange(null)
          const match = options.find((option) => String(option.value) === raw)
          onChange(match ? match.value : null)
        }}
        className={cn(
          'h-9 w-full appearance-none rounded-control border border-line bg-raised pr-8 pl-3',
          'text-[13px] text-ink transition-colors duration-150',
          'hover:border-line-strong focus:border-accent focus:outline-none'
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint"
      />
    </div>
  )
}

/** Colour swatches — the colour-coding you set on categories, clients and projects. */
export function ColourPicker({
  value,
  onChange
}: {
  value: string
  onChange: (colour: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOUR_CHOICES.map((colour) => (
        <button
          key={colour}
          type="button"
          aria-label={`Colour ${colour}`}
          onClick={() => onChange(colour)}
          style={{ backgroundColor: colour }}
          className={cn(
            'h-6 w-6 rounded-full transition-transform duration-150 hover:scale-110',
            value === colour && 'ring-2 ring-ink ring-offset-2 ring-offset-surface'
          )}
        />
      ))}
    </div>
  )
}
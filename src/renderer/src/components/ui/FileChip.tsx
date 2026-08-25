import type { TokenName } from '@/lib/tokens'
import { cn } from '@/lib/utils'

/**
 * A file's extension, as a coloured square.
 *
 * Replaces a generic document glyph that was identical for every row, which
 * made a list of files something you had to read rather than scan. The colour
 * carries the type at a glance and the letters carry it exactly — a colour
 * alone would be no use to anybody who cannot separate the greens from the
 * reds.
 */
const TYPES: Record<string, TokenName> = {
  csv: 'success',
  xlsx: 'success',
  xls: 'success',
  pdf: 'danger',
  md: 'info',
  txt: 'info',
  docx: 'info',
  doc: 'info',
  png: 'accent',
  jpg: 'accent',
  jpeg: 'accent',
  webp: 'accent',
  svg: 'accent',
  zip: 'warning'
}

export function FileChip({
  name,
  folder,
  className
}: {
  name: string
  /** Folders have no extension; they get their own mark rather than a blank. */
  folder?: boolean
  className?: string
}): React.JSX.Element {
  const extension = folder ? '' : (name.split('.').pop() ?? '').toLowerCase()
  const tone: TokenName = folder ? 'warning' : (TYPES[extension] ?? 'faint')

  return (
    <span
      aria-hidden
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-chip',
        'text-[9px] leading-none font-bold',
        className
      )}
      style={{
        color: `var(--color-${tone})`,
        backgroundColor: `color-mix(in srgb, var(--color-${tone}) 12%, transparent)`
      }}
    >
      <span className="numeric text-[9px] font-bold">
        {folder ? '' : extension.slice(0, 4).toUpperCase() || '?'}
      </span>
    </span>
  )
}

import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { describeAvailability, gapsAcross } from './gaps'
import { dayLabel } from './grid'

/**
 * "I have the following free."
 *
 * §17.5. Every freelancer writes this message by hand several times a week,
 * reading it off a grid and counting — which is exactly how "Thursday" ends up
 * meaning a Thursday that is already booked. Small feature, disproportionate
 * daily value.
 *
 * The text comes from the same gap arithmetic as the radar and the smart drop,
 * so what this promises a client and what the grid shows can never differ.
 */

type Format = 'plain' | 'markdown'

const FORMATS: { value: Format; label: string }[] = [
  { value: 'plain', label: 'Plain text' },
  { value: 'markdown', label: 'Markdown' }
]

export function Availability({
  open,
  days,
  blocks,
  settings,
  onClose
}: {
  open: boolean
  /** The range being offered — whatever the calendar is showing. */
  days: string[]
  blocks: CalendarBlockWithContext[]
  settings: CalendarSettings
  onClose: () => void
}): React.JSX.Element {
  const [format, setFormat] = useState<Format>('plain')
  const [copied, setCopied] = useState(false)

  const text = useMemo(() => {
    const gaps = gapsAcross(blocks, days, settings)
    const body = describeAvailability(
      gaps,
      (day) => dayLabel(day, { weekday: 'short', day: 'numeric', month: 'short' }),
      settings.workingHoursEnd - settings.workingHoursStart
    )

    if (body === '') return 'I have nothing free in that range.'

    const lines = body.split('\n')
    if (format === 'markdown') {
      return `**I have the following free:**\n\n${lines.map((line) => `- ${line}`).join('\n')}`
    }
    return `I have the following free:\n${lines.join('\n')}`
  }, [blocks, days, settings, format])

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send your availability"
      description="Read off the same gaps the grid shows, so it cannot promise a slot you have filled."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? (
              <Check size={13} strokeWidth={2} />
            ) : (
              <Copy size={13} strokeWidth={1.75} />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5">
          {FORMATS.map((one) => (
            <button
              key={one.value}
              type="button"
              onClick={() => setFormat(one.value)}
              className={cn(
                'rounded-control border px-2.5 py-1 text-[12px] transition-colors',
                format === one.value
                  ? 'border-accent bg-accent-subtle text-ink'
                  : 'border-line text-muted hover:border-line-strong hover:text-ink'
              )}
            >
              {one.label}
            </button>
          ))}
        </div>

        <pre className="max-h-[260px] overflow-auto rounded-control border border-line bg-raised px-3 py-2 text-[12.5px] whitespace-pre-wrap text-ink">
          {text}
        </pre>
      </div>
    </Modal>
  )
}

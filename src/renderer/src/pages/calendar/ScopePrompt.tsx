import { useState } from 'react'
import type { EditScope } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

/**
 * "Which ones?"
 *
 * Asked every time a repeating block changes, and never answered by default.
 * The difference between "move the Tuesday stand-up" and "move this Tuesday's
 * stand-up" is a year of somebody's diary, and an app that guesses is one that
 * silently rewrites next month. Three plain sentences rather than three words,
 * because "This and following" is not something anybody should have to parse
 * with a year of their calendar riding on it.
 */
const CHOICES: { value: EditScope; label: string; hint: string }[] = [
  { value: 'one', label: 'Just this one', hint: 'The rest of the series stays where it is.' },
  {
    value: 'future',
    label: 'This one and the ones after it',
    hint: 'Everything before it is left alone.'
  },
  { value: 'all', label: 'Every one of them', hint: 'Including the ones already past.' }
]

export function ScopePrompt({
  open,
  title,
  action,
  onChoose,
  onCancel
}: {
  open: boolean
  /** What is being changed, so the question names it. */
  title: string
  /** 'Move' or 'Delete' — the verb, for the confirm button. */
  action: string
  onChoose: (scope: EditScope) => void
  onCancel: () => void
}): React.JSX.Element {
  const [scope, setScope] = useState<EditScope>('one')

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`${title} repeats`}
      description="Which of them should this apply to?"
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onChoose(scope)}>
            {action}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            onClick={() => setScope(choice.value)}
            aria-pressed={scope === choice.value}
            className={cn(
              'rounded-control border px-3 py-2 text-left transition-colors',
              scope === choice.value
                ? 'border-accent bg-accent-subtle'
                : 'border-line hover:border-line-strong'
            )}
          >
            <p className="text-[13px] text-ink">{choice.label}</p>
            <p className="mt-0.5 text-[11.5px] text-muted">{choice.hint}</p>
          </button>
        ))}
      </div>
    </Modal>
  )
}

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A value you can click and change, with no edit mode around it.
 *
 * No pencil icon, no Save button, no dialog. The field is the control: click
 * it, type, click away. Everything else is ceremony around a change somebody
 * already decided to make, and a Save button in particular is a promise that
 * something bad happens if you forget it.
 *
 * Saving on blur only works if it is *visible* that it saved — otherwise
 * clicking away feels like abandoning the edit. Hence the brief flash: the
 * field says yes, quietly, and nothing else moves.
 */

/** Long enough to notice, short enough not to be a state you wait out. */
const FLASH_MS = 600

export function InlineEdit({
  value,
  onSave,
  placeholder = 'Empty',
  multiline = false,
  className,
  inputClassName,
  disabled = false,
  label
}: {
  value: string
  /** Called only when the value actually changed. */
  onSave: (next: string) => void | Promise<void>
  placeholder?: string
  multiline?: boolean
  className?: string
  inputClassName?: string
  disabled?: boolean
  /** For the screen reader: "Edit title". */
  label: string
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [flash, setFlash] = useState(false)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  // A value changed elsewhere — a drag, the assistant, an undo — has to show
  // here too, but not while somebody is mid-word in this very field.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (!editing) return
    field.current?.focus()
    field.current?.select()
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next === value) return
    setFlash(true)
    setTimeout(() => setFlash(false), FLASH_MS)
    void onSave(next)
  }

  const cancel = (): void => {
    setDraft(value)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={() => setEditing(true)}
        className={cn(
          'w-full rounded-[3px] px-1 py-0.5 text-left transition-colors',
          // The affordance is on hover only. A permanent box around every
          // value would turn a list into a form.
          !disabled && 'hover:bg-hover',
          disabled && 'cursor-default',
          value === '' && 'text-faint',
          flash && 'bg-success/20',
          className
        )}
      >
        {value === '' ? placeholder : value}
      </button>
    )
  }

  const Tag = multiline ? 'textarea' : 'input'

  return (
    <Tag
      ref={field}
      value={draft}
      rows={multiline ? 3 : undefined}
      aria-label={label}
      onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
        setDraft(event.target.value)
      }
      onBlur={commit}
      onKeyDown={(event: React.KeyboardEvent) => {
        // Stopped here so the page's own shortcuts never see a keystroke meant
        // for this field — otherwise typing a title containing "d" switches
        // the calendar to the day view underneath.
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
        // Enter commits a single line. In a textarea it is a newline, and
        // Ctrl+Enter is how you say you are finished.
        if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          commit()
        }
      }}
      className={cn(
        'w-full resize-none rounded-[3px] bg-raised px-1 py-0.5 text-inherit',
        'ring-1 ring-accent focus:outline-none',
        className,
        inputClassName
      )}
    />
  )
}

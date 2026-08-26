import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import type { BlockInput, BlockType, CalendarBlockWithContext } from '@shared/types'
import { BLOCK_TYPES, REMINDER_CHOICES, blockTypeMeta } from '@shared/types'
import { dayOf, minutesBetween, stampAt, timeOf } from '@shared/calendar'
import { Button } from '@/components/ui/Button'
import { Field, TextInput, Toggle } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { keys, useInvalidate } from '@/lib/api'
import { useEntityActions } from '@/hooks/useEntityActions'
import { cn } from '@/lib/utils'

/** What the modal edits. Split into day + times because that is how people think. */
interface Draft {
  title: string
  blockType: BlockType
  day: string
  startTime: string
  endTime: string
  allDay: boolean
  projectId: number | null
  location: string
  meetingUrl: string
  description: string
  colour: string
  billable: boolean
  reminderMinutes: number | null
}

function toDraft(block: CalendarBlockWithContext | null, defaults: Partial<Draft>): Draft {
  if (!block) {
    const blockType = defaults.blockType ?? 'meeting'
    return {
      title: '',
      blockType,
      day: defaults.day ?? dayOf(new Date().toISOString()),
      startTime: defaults.startTime ?? '09:00',
      endTime: defaults.endTime ?? '10:00',
      allDay: false,
      projectId: defaults.projectId ?? null,
      location: '',
      meetingUrl: '',
      description: '',
      colour: '',
      billable: blockTypeMeta(blockType).billable,
      reminderMinutes: 15
    }
  }

  return {
    title: block.title,
    blockType: block.blockType,
    day: dayOf(block.startsAt),
    startTime: timeOf(block.startsAt),
    endTime: timeOf(block.endsAt),
    allDay: block.allDay,
    projectId: block.projectId,
    location: block.location,
    meetingUrl: block.meetingUrl,
    description: block.description,
    colour: block.colour,
    billable: block.billable,
    reminderMinutes: block.reminderMinutes
  }
}

/**
 * An all-day block still needs a start and an end, so it is stored as the
 * whole day rather than as a null time. Everything downstream — overlap
 * layout, range queries, sync — then has one shape to handle.
 */
function toInput(draft: Draft): BlockInput {
  const startsAt = draft.allDay ? `${draft.day}T00:00` : `${draft.day}T${draft.startTime}`
  let endsAt = draft.allDay ? `${draft.day}T23:59` : `${draft.day}T${draft.endTime}`

  // An end before the start reads as running past midnight, which is what
  // someone typing 22:00–01:00 means.
  if (!draft.allDay && minutesBetween(startsAt, endsAt) < 0) {
    endsAt = stampAt(
      draft.day,
      1440 + Number(draft.endTime.slice(0, 2)) * 60 + Number(draft.endTime.slice(3, 5))
    )
  }

  return {
    title: draft.title.trim() || 'Untitled',
    blockType: draft.blockType,
    startsAt,
    endsAt,
    allDay: draft.allDay,
    projectId: draft.projectId,
    location: draft.location,
    meetingUrl: draft.meetingUrl,
    description: draft.description,
    colour: draft.colour,
    billable: draft.billable,
    reminderMinutes: draft.reminderMinutes
  }
}

export function BlockModal({
  open,
  block,
  defaults,
  onClose
}: {
  open: boolean
  /** null when creating. */
  block: CalendarBlockWithContext | null
  defaults?: Partial<Draft>
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const { remove } = useEntityActions()
  const [draft, setDraft] = useState<Draft>(() => toDraft(block, defaults ?? {}))

  // Reset whenever the modal opens, so an edit does not inherit the last one.
  useEffect(() => {
    if (open) setDraft(toDraft(block, defaults ?? {}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.id])

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {}),
    enabled: open
  })

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  /**
   * Changing the type re-answers the billable question with what that type
   * usually means — but only while the answer is still the old type's default.
   * Somebody who has deliberately said "this focus block is not billable"
   * should not have that undone by reaching for a different type.
   */
  const chooseType = (blockType: BlockType): void =>
    setDraft((current) =>
      current.billable === blockTypeMeta(current.blockType).billable
        ? { ...current, blockType, billable: blockTypeMeta(blockType).billable }
        : { ...current, blockType }
    )

  const save = useMutation({
    mutationFn: () =>
      block
        ? window.solo.invoke('calendar:updateBlock', { id: block.id, patch: toInput(draft) })
        : window.solo.invoke('calendar:createBlock', toInput(draft)),
    onSuccess: () => {
      invalidate(['calendar'])
      onClose()
    }
  })

  // Nothing from a subscribed calendar is editable. The service refuses it too;
  // this is so the modal does not offer something that will fail.
  const locked = block?.locked ?? false

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={block ? 'Edit block' : 'New block'}
      description={
        locked ? 'From a calendar you subscribe to, so it is read-only here.' : undefined
      }
      width={520}
      footer={
        <>
          {block && !locked && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                void remove({ type: 'block', id: block.id }, block.title)
                onClose()
              }}
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {locked ? 'Close' : 'Cancel'}
          </Button>
          {!locked && (
            <Button variant="primary" onClick={() => save.mutate()} disabled={!draft.title.trim()}>
              {block ? 'Save' : 'Add block'}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={locked} className="flex flex-col gap-3.5">
        <Field label="Title">
          <TextInput
            autoFocus
            value={draft.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="Client call, deep work, site visit…"
          />
        </Field>

        {/* Chips rather than a dropdown. The type decides colour, whether the
            hour counts toward capacity and whether it is billable — too much
            to hide behind a closed menu. */}
        <Field label="Type" hint="What kind of hour this is.">
          <div className="flex flex-wrap gap-1.5">
            {BLOCK_TYPES.filter((one) => one.value !== 'external').map((one) => (
              <button
                key={one.value}
                type="button"
                onClick={() => chooseType(one.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-[12px] transition-colors',
                  draft.blockType === one.value
                    ? 'border-accent bg-accent-subtle text-ink'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink'
                )}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: one.colour }}
                />
                {one.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              value={draft.day}
              onChange={(e) => update('day', e.target.value || draft.day)}
            />
          </Field>
          <Field label="From" className={draft.allDay ? 'opacity-40' : undefined}>
            <TextInput
              type="time"
              step={900}
              disabled={draft.allDay}
              value={draft.startTime}
              onChange={(e) => update('startTime', e.target.value)}
            />
          </Field>
          <Field label="To" className={draft.allDay ? 'opacity-40' : undefined}>
            <TextInput
              type="time"
              step={900}
              disabled={draft.allDay}
              value={draft.endTime}
              onChange={(e) => update('endTime', e.target.value)}
            />
          </Field>
        </div>

        <Toggle
          checked={draft.allDay}
          onChange={(value) => update('allDay', value)}
          label="All day"
          hint="Sits in the strip above the grid rather than at a time."
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project" hint="Colours the block and links it to the work.">
            <Select
              value={draft.projectId}
              onChange={(value) => update('projectId', value)}
              placeholder="No project"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
          <Field label="Reminder">
            <Select
              value={draft.reminderMinutes}
              onChange={(value) => update('reminderMinutes', value)}
              placeholder="No reminder"
              options={REMINDER_CHOICES}
            />
          </Field>
        </div>

        <Toggle
          checked={draft.billable}
          onChange={(value) => update('billable', value)}
          label="Billable"
          hint="Counts toward the week's billable target."
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Location">
            <TextInput
              value={draft.location}
              onChange={(e) => update('location', e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Meeting link">
            <TextInput
              value={draft.meetingUrl}
              onChange={(e) => update('meetingUrl', e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => update('description', e.target.value)}
            className="w-full resize-none rounded-control border border-line bg-raised px-3 py-2 text-[13px] text-ink placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none"
            placeholder="Agenda, address, what to bring…"
          />
        </Field>

        <Field label="Colour" hint="Leave unset to follow the project, then the type.">
          <div className="flex items-center gap-3">
            <ColourPicker value={draft.colour} onChange={(colour) => update('colour', colour)} />
            {draft.colour && (
              <button
                type="button"
                onClick={() => update('colour', '')}
                className="text-[11px] text-faint transition-colors hover:text-ink"
              >
                Reset
              </button>
            )}
          </div>
        </Field>
      </fieldset>
    </Modal>
  )
}
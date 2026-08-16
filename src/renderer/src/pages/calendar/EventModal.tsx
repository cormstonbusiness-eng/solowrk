import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import type { CalendarEventWithContext, EventInput } from '@shared/types'
import { REMINDER_CHOICES } from '@shared/types'
import { dayOf, minutesBetween, stampAt, timeOf } from '@shared/calendar'
import { Button } from '@/components/ui/Button'
import { Field, TextInput, Toggle } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { keys, useInvalidate } from '@/lib/api'

/** What the modal edits. Split into day + times because that is how people think. */
interface Draft {
  title: string
  day: string
  startTime: string
  endTime: string
  allDay: boolean
  projectId: number | null
  location: string
  meetingUrl: string
  description: string
  colour: string
  reminderMinutes: number | null
}

function toDraft(event: CalendarEventWithContext | null, defaults: Partial<Draft>): Draft {
  if (!event) {
    return {
      title: '',
      day: defaults.day ?? dayOf(new Date().toISOString()),
      startTime: defaults.startTime ?? '09:00',
      endTime: defaults.endTime ?? '10:00',
      allDay: false,
      projectId: defaults.projectId ?? null,
      location: '',
      meetingUrl: '',
      description: '',
      colour: '',
      reminderMinutes: 15
    }
  }

  return {
    title: event.title,
    day: dayOf(event.startsAt),
    startTime: timeOf(event.startsAt),
    endTime: timeOf(event.endsAt),
    allDay: event.allDay,
    projectId: event.projectId,
    location: event.location,
    meetingUrl: event.meetingUrl,
    description: event.description,
    colour: event.colour,
    reminderMinutes: event.reminderMinutes
  }
}

/**
 * An all-day event still needs a start and an end, so it is stored as the
 * whole day rather than as a null time. Everything downstream — overlap
 * layout, range queries, sync — then has one shape to handle.
 */
function toInput(draft: Draft): EventInput {
  const startsAt = draft.allDay ? `${draft.day}T00:00` : `${draft.day}T${draft.startTime}`
  let endsAt = draft.allDay ? `${draft.day}T23:59` : `${draft.day}T${draft.endTime}`

  // An end before the start reads as running past midnight, which is what
  // someone typing 22:00–01:00 means.
  if (!draft.allDay && minutesBetween(startsAt, endsAt) < 0) {
    endsAt = stampAt(draft.day, 1440 + Number(draft.endTime.slice(0, 2)) * 60 + Number(draft.endTime.slice(3, 5)))
  }

  return {
    title: draft.title.trim() || 'Untitled',
    startsAt,
    endsAt,
    allDay: draft.allDay,
    projectId: draft.projectId,
    location: draft.location,
    meetingUrl: draft.meetingUrl,
    description: draft.description,
    colour: draft.colour,
    reminderMinutes: draft.reminderMinutes
  }
}

export function EventModal({
  open,
  event,
  defaults,
  onClose
}: {
  open: boolean
  /** null when creating. */
  event: CalendarEventWithContext | null
  defaults?: Partial<Draft>
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<Draft>(() => toDraft(event, defaults ?? {}))

  // Reset whenever the modal opens, so an edit does not inherit the last one.
  useEffect(() => {
    if (open) setDraft(toDraft(event, defaults ?? {}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id])

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {}),
    enabled: open
  })

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () =>
      event
        ? window.solo.invoke('events:update', { id: event.id, patch: toInput(draft) })
        : window.solo.invoke('events:create', toInput(draft)),
    onSuccess: () => {
      invalidate(['events'])
      onClose()
    }
  })

  const remove = useMutation({
    mutationFn: () => window.solo.invoke('events:delete', { id: event?.id ?? 0 }),
    onSuccess: () => {
      invalidate(['events'])
      onClose()
    }
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      description={event?.kind === 'local' || !event ? undefined : 'Synced from your calendar.'}
      width={520}
      footer={
        <>
          {event && (
            <Button variant="danger" onClick={() => remove.mutate()} className="mr-auto">
              <Trash2 size={13} strokeWidth={1.75} />
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={!draft.title.trim()}>
            {event ? 'Save' : 'Add event'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Title">
          <TextInput
            autoFocus
            value={draft.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="Client call, deadline, site visit…"
          />
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
          <Field label="Project" hint="Colours the event and links it to the work.">
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

        <Field label="Colour" hint="Leave unset to follow the project's colour.">
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
      </div>
    </Modal>
  )
}
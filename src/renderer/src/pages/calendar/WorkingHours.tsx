import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { CalendarSettings } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Field, TextInput, Toggle } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'
import { durationLabel } from './grid'

/**
 * How this person works.
 *
 * The grid has shaded working hours since it was built, and until now there
 * was no way to say what they were — so everybody got 09:00–17:30, Monday to
 * Friday, whether that was their life or not. A shading nobody can change is
 * not a feature, it is the app being wrong about somebody five days a week.
 *
 * It lives on the calendar rather than in Settings because every field here
 * changes something visible on the grid behind it, and the cost of getting
 * one wrong should be seeing it immediately rather than navigating back.
 */

/** Monday-first, matching the bitmask in `calendar_settings.working_days`. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const SNAPS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' }
]

const LENGTHS = [
  { value: 30, label: '30 minutes' },
  { value: 45, label: '45 minutes' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1½ hours' },
  { value: 120, label: '2 hours' }
]

/** Minutes past midnight ⇄ the `HH:MM` an `<input type="time">` speaks. */
function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function fromClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function WorkingHours({
  open,
  settings,
  onClose
}: {
  open: boolean
  settings: CalendarSettings
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState(settings)

  // Reopening should show what is actually stored, not what somebody typed
  // and then abandoned last time.
  useEffect(() => {
    if (open) setDraft(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof CalendarSettings>(key: K, value: CalendarSettings[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => window.solo.invoke('calendar:updateSettings', draft),
    onSuccess: () => {
      invalidate(['calendar'])
      onClose()
    }
  })

  const toggleDay = (index: number): void =>
    set('workingDays', draft.workingDays ^ (1 << index))

  const dayLength = Math.max(0, draft.workingHoursEnd - draft.workingHoursStart)
  const workingDayCount = DAYS.filter((_, index) => (draft.workingDays & (1 << index)) !== 0).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Working hours"
      description="What the calendar shades, counts and schedules into."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <TextInput
              type="time"
              step={900}
              value={toClock(draft.workingHoursStart)}
              onChange={(event) => {
                const minutes = fromClock(event.target.value)
                if (minutes !== null) set('workingHoursStart', minutes)
              }}
            />
          </Field>
          <Field label="End">
            <TextInput
              type="time"
              step={900}
              value={toClock(draft.workingHoursEnd)}
              onChange={(event) => {
                const minutes = fromClock(event.target.value)
                if (minutes !== null) set('workingHoursEnd', minutes)
              }}
            />
          </Field>
        </div>

        {/* An end before the start is somebody halfway through typing, not an
            error to shout about. Said quietly, and Save is left alone. */}
        {draft.workingHoursEnd <= draft.workingHoursStart && (
          <p className="text-[12px] text-danger">The day has to end after it starts.</p>
        )}

        <Field label="Days" hint="The rest are shaded, and nothing is scheduled into them.">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day, index) => {
              const on = (draft.workingDays & (1 << index)) !== 0
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(index)}
                  className={cn(
                    'w-[52px] rounded-control border py-1 text-[12px] transition-colors',
                    on
                      ? 'border-accent bg-accent-subtle text-ink'
                      : 'border-line text-muted hover:border-line-strong hover:text-ink'
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Daily capacity"
            hint="Hours of real work, not hours at the desk."
          >
            <TextInput
              type="number"
              min={0}
              step={0.5}
              value={draft.dailyCapacityMinutes / 60}
              onChange={(event) =>
                set('dailyCapacityMinutes', Math.round(Number(event.target.value) * 60))
              }
            />
          </Field>
          <Field label="Weekly billable target" hint="Hours.">
            <TextInput
              type="number"
              min={0}
              step={0.5}
              value={draft.weeklyBillableTarget / 60}
              onChange={(event) =>
                set('weeklyBillableTarget', Math.round(Number(event.target.value) * 60))
              }
            />
          </Field>
        </div>

        {/* Capacity is deliberately allowed to be less than the working day,
            and usually should be. Six billable hours out of an eight-hour day
            is a good day; a capacity nobody can hit is a warning nobody
            reads. */}
        <p className="-mt-1 text-[11.5px] text-muted">
          {workingDayCount === 0
            ? 'No working days set, so nothing will be shaded or scheduled.'
            : `${workingDayCount} day${workingDayCount === 1 ? '' : 's'} a week, ${durationLabel(dayLength)} each, with ${durationLabel(draft.dailyCapacityMinutes)} of that spoken for.`}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Default block length">
            <Select
              value={draft.defaultBlockMinutes}
              onChange={(value) => set('defaultBlockMinutes', value ?? 60)}
              options={LENGTHS}
            />
          </Field>
          <Field label="Snap to" hint="Hold Alt while dragging to ignore it.">
            <Select
              value={draft.snapMinutes}
              onChange={(value) => set('snapMinutes', value ?? 15)}
              options={SNAPS}
            />
          </Field>
        </div>

        <Toggle
          checked={draft.showWeekends}
          onChange={(value) => set('showWeekends', value)}
          label="Show weekends"
          hint="Off narrows the week view to your working days."
        />
      </div>
    </Modal>
  )
}

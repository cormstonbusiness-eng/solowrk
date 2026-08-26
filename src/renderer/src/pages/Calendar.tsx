import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarPlus, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import type { CalendarBlockWithContext, CalendarSettings } from '@shared/types'
import { addDays, addMonths, dayFromDate, monthGrid, weekDays } from '@shared/calendar'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { useUndo } from '@/hooks/useUndo'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { AgendaView } from './calendar/AgendaView'
import { BlockModal } from './calendar/BlockModal'
import { MonthView } from './calendar/MonthView'
import { TimeGrid } from './calendar/TimeGrid'
import { ZOOM_LEVELS, dayLabel, monthLabel, nearestZoom, stepZoom } from './calendar/grid'

type View = 'month' | 'week' | 'day' | 'agenda'

const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' }
]

/** How many days ahead the agenda looks. */
const AGENDA_DAYS = 30

/**
 * What the grid uses before the settings query comes back.
 *
 * A fallback rather than a loading state: an empty calendar that then fills in
 * is worse than a calendar drawn at the default height for one frame.
 */
const FALLBACK_SETTINGS: CalendarSettings = {
  workingHoursStart: 540,
  workingHoursEnd: 1050,
  workingDays: 31,
  dailyCapacityMinutes: 360,
  weeklyBillableTarget: 1500,
  defaultBlockMinutes: 60,
  snapMinutes: 15,
  weekStartsOn: 0,
  defaultView: 'week',
  showWeekends: true,
  hourHeight: 56
}

/** The days a view covers — which is also exactly what it queries for. */
function daysInView(view: View, anchor: string): string[] {
  switch (view) {
    case 'month':
      return monthGrid(anchor)
    case 'week':
      return weekDays(anchor)
    case 'day':
      return [anchor]
    case 'agenda':
      return Array.from({ length: AGENDA_DAYS }, (_, index) => addDays(anchor, index))
  }
}

function step(view: View, anchor: string, direction: 1 | -1): string {
  switch (view) {
    case 'month':
      return addMonths(anchor, direction)
    case 'week':
      return addDays(anchor, 7 * direction)
    case 'day':
      return addDays(anchor, direction)
    case 'agenda':
      return addDays(anchor, AGENDA_DAYS * direction)
  }
}

function headingFor(view: View, anchor: string, days: string[]): string {
  if (view === 'day') return dayLabel(anchor, { weekday: 'long', day: 'numeric', month: 'long' })
  if (view === 'month') return monthLabel(anchor)

  const first = days[0] ?? anchor
  const last = days.at(-1) ?? anchor
  const sameMonth = first.slice(0, 7) === last.slice(0, 7)
  return `${dayLabel(first, { day: 'numeric', month: sameMonth ? undefined : 'short' })} – ${dayLabel(
    last,
    { day: 'numeric', month: 'short', year: 'numeric' }
  )}`
}

export function Calendar(): React.JSX.Element {
  const invalidate = useInvalidate()
  const { offer } = useUndo()
  const today = dayFromDate(new Date())

  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(today)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [editing, setEditing] = useState<CalendarBlockWithContext | null>(null)
  const [creating, setCreating] = useState<{
    day: string
    startTime: string
    endTime: string
  } | null>(null)
  const [focusId, setFocusId] = useState<number | null>(null)

  useOpenParam('new', () => setCreating({ day: anchor, startTime: '09:00', endTime: '10:00' }))

  const { data: settings = FALLBACK_SETTINGS } = useQuery({
    queryKey: keys.calendarSettings,
    queryFn: () => window.solo.invoke('calendar:settings', undefined),
    staleTime: 60_000
  })

  const days = daysInView(view, anchor)
  const from = days[0] ?? anchor
  const to = days.at(-1) ?? anchor

  const { data: blocks = [] } = useQuery({
    queryKey: keys.blocks(from, to, projectId),
    queryFn: () =>
      window.solo.invoke('calendar:blocks', {
        from,
        to,
        ...(projectId === null ? {} : { projectId })
      })
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  // Scheduled posts are deliberately NOT here. Marketing has its own content
  // calendar, and this one is for meetings and things you put in it yourself —
  // mixing a month of scheduled posts into the working week buries the two
  // appointments that actually needed your attention.

  /**
   * Moving something, with the offer to put it back.
   *
   * Every drag goes through here, including the ones from the month view. A
   * calendar is a thing people rearrange quickly and occasionally by accident,
   * and a drag with no way back is the reason people stop trusting one.
   */
  const reschedule = async (
    block: CalendarBlockWithContext,
    span: { startsAt: string; endsAt: string }
  ): Promise<void> => {
    const before = { startsAt: block.startsAt, endsAt: block.endsAt }
    await window.solo.invoke('calendar:updateBlock', { id: block.id, patch: span })
    invalidate(['calendar'])

    offer(`Moved ${block.title}`, async () => {
      await window.solo.invoke('calendar:updateBlock', { id: block.id, patch: before })
      invalidate(['calendar'])
    })
  }

  const duplicate = async (
    block: CalendarBlockWithContext,
    span: { startsAt: string; endsAt: string }
  ): Promise<void> => {
    const copy = await window.solo.invoke('calendar:createBlock', {
      title: block.title,
      blockType: block.blockType,
      description: block.description,
      location: block.location,
      meetingUrl: block.meetingUrl,
      projectId: block.projectId,
      clientId: block.clientId,
      colour: block.colour,
      billable: block.billable,
      reminderMinutes: block.reminderMinutes,
      ...span
    })
    invalidate(['calendar'])

    offer(`Copied ${block.title}`, async () => {
      await window.solo.invoke('entity:delete', { type: 'block', id: copy.id })
      invalidate(['calendar'])
    })
  }

  const create = async (
    span: { startsAt: string; endsAt: string },
    title: string
  ): Promise<void> => {
    const block = await window.solo.invoke('calendar:createBlock', { title, ...span })
    invalidate(['calendar'])

    offer(`Added ${title}`, async () => {
      await window.solo.invoke('entity:delete', { type: 'block', id: block.id })
      invalidate(['calendar'])
    })
  }

  // Zoom is stored rather than kept in component state: the height of an hour
  // is a preference about how you read a week, not something to re-choose
  // every time you open the tab.
  const zoom = useMutation({
    mutationFn: (hourHeight: number) =>
      window.solo.invoke('calendar:updateSettings', { hourHeight }),
    onSuccess: () => invalidate(['calendar'])
  })

  // A clicked reminder should land on the block it was reminding you about.
  useEffect(() => {
    return window.solo.on('calendar:focusEvent', ({ id }) => {
      setView('day')
      setAnchor(dayFromDate(new Date()))
      setFocusId(id)
    })
  }, [])

  useEffect(() => {
    if (focusId === null) return
    const match = blocks.find((block) => block.id === focusId)
    if (match) {
      setEditing(match)
      setFocusId(null)
    }
  }, [focusId, blocks])

  const openNew = (day: string, startTime = '09:00', endTime = '10:00'): void =>
    setCreating({ day, startTime, endTime })

  const currentZoom = nearestZoom(settings.hourHeight)
  const showZoom = view === 'week' || view === 'day'

  return (
    <Page
      title="Calendar"
      description={headingFor(view, anchor, days)}
      className="flex min-h-0 flex-col overflow-y-hidden"
      actions={
        <>
          <Select
            value={projectId}
            onChange={setProjectId}
            placeholder="All projects"
            className="w-[170px]"
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
          <Button variant="primary" onClick={() => openNew(anchor)}>
            <CalendarPlus size={14} strokeWidth={1.75} />
            New block
          </Button>
        </>
      }
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous"
            onClick={() => setAnchor(step(view, anchor, -1))}
          >
            <ChevronLeft size={15} strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next"
            onClick={() => setAnchor(step(view, anchor, 1))}
          >
            <ChevronRight size={15} strokeWidth={1.75} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(today)} className="ml-1.5">
            Today
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {showZoom && (
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Shorter hours"
                disabled={currentZoom === ZOOM_LEVELS[0]}
                onClick={() => zoom.mutate(stepZoom(currentZoom, -1))}
              >
                <Minus size={13} strokeWidth={2} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Taller hours"
                disabled={currentZoom === ZOOM_LEVELS.at(-1)}
                onClick={() => zoom.mutate(stepZoom(currentZoom, 1))}
              >
                <Plus size={13} strokeWidth={2} />
              </Button>
            </div>
          )}

          {/* Segmented control. The active pill is one element that slides between
              positions, rather than four that fade — it reads as a single state. */}
          <div className="flex items-center gap-0.5 rounded-control bg-raised p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                className={cn(
                  'relative rounded-[6px] px-3 py-1 text-[12px] transition-colors',
                  view === option.value ? 'text-ink' : 'text-muted hover:text-ink'
                )}
              >
                {view === option.value && (
                  <motion.span
                    layoutId="calendar-view-pill"
                    transition={transition.layout}
                    className="absolute inset-0 rounded-[6px] bg-overlay"
                  />
                )}
                <span className="relative">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={transition.page}
          className="flex min-h-0 flex-1 flex-col"
        >
          {view === 'month' && (
            <MonthView
              month={anchor}
              today={today}
              blocks={blocks}
              settings={settings}
              onOpenBlock={setEditing}
              onCreateAt={(day) => openNew(day)}
              onMoveBlock={(block, dayDelta) =>
                void reschedule(block, {
                  startsAt: shiftDays(block.startsAt, dayDelta),
                  endsAt: shiftDays(block.endsAt, dayDelta)
                })
              }
            />
          )}

          {(view === 'week' || view === 'day') && (
            <TimeGrid
              days={view === 'day' ? [anchor] : weekDays(anchor)}
              today={today}
              blocks={blocks}
              settings={settings}
              onOpenBlock={setEditing}
              onCreate={(span, title) => void create(span, title)}
              onReschedule={(block, span) => void reschedule(block, span)}
              onDuplicate={(block, span) => void duplicate(block, span)}
              onAdvance={(direction) => setAnchor(step(view, anchor, direction))}
            />
          )}

          {view === 'agenda' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AgendaView days={days} today={today} blocks={blocks} onOpenBlock={setEditing} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <BlockModal
        open={editing !== null || creating !== null}
        block={editing}
        defaults={creating ?? { day: anchor }}
        onClose={() => {
          setEditing(null)
          setCreating(null)
        }}
      />
    </Page>
  )
}

/** Shift the day half of a stamp, leaving the time untouched. */
function shiftDays(stamp: string, days: number): string {
  return `${addDays(stamp.slice(0, 10), days)}${stamp.slice(10)}`
}
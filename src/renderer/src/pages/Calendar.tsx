import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Link2,
  Minus,
  PanelRightClose,
  Plus
} from 'lucide-react'
import type {
  CalendarBlockWithContext,
  CalendarSettings,
  EditScope,
  TaskWithContext
} from '@shared/types'
import { addDays, addMonths, dayFromDate, dayOf, monthGrid, weekDays } from '@shared/calendar'
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
import { ScopePrompt } from './calendar/ScopePrompt'
import { Subscriptions } from './calendar/Subscriptions'
import { TimeGrid } from './calendar/TimeGrid'
import { UnscheduledRail } from './calendar/UnscheduledRail'
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
  const [railOpen, setRailOpen] = useState(true)
  const [calendarsOpen, setCalendarsOpen] = useState(false)

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

  /**
   * The running timer, polled rather than pushed.
   *
   * Half a minute is plenty: the block it draws is measured in minutes, and
   * the grid redraws it on its own clock anyway.
   */
  const { data: running = null } = useQuery({
    queryKey: ['time', 'running'],
    queryFn: () => window.solo.invoke('time:running', undefined),
    refetchInterval: 30_000
  })

  const startTimer = async (block: CalendarBlockWithContext): Promise<void> => {
    await window.solo.invoke('time:start', {
      projectId: block.projectId,
      taskId: block.taskId,
      notes: block.title
    })
    invalidate(['time'])
  }

  // Deadlines, read from where they actually live. Nothing here is a block,
  // so nothing here can drift from the record or be dragged by accident.
  const { data: markers = [] } = useQuery({
    queryKey: ['calendar', 'markers', from, to],
    queryFn: () => window.solo.invoke('calendar:markers', { from, to })
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
  /**
   * A move waiting on "which of them?".
   *
   * Held rather than applied, because a repeating block cannot be moved until
   * the question is answered, and the answer is not something to guess at.
   */
  const [pendingMove, setPendingMove] = useState<{
    block: CalendarBlockWithContext
    span: { startsAt: string; endsAt: string }
  } | null>(null)

  /** True when this block is one of many, and so needs the question asked. */
  const repeats = (block: CalendarBlockWithContext): boolean =>
    block.occurrenceOf !== null || block.recurrenceRule !== null

  const reschedule = async (
    block: CalendarBlockWithContext,
    span: { startsAt: string; endsAt: string }
  ): Promise<void> => {
    if (repeats(block)) {
      setPendingMove({ block, span })
      return
    }

    const before = { startsAt: block.startsAt, endsAt: block.endsAt }
    await window.solo.invoke('calendar:updateBlock', { id: block.id, patch: span })
    invalidate(['calendar'])

    offer(`Moved ${block.title}`, async () => {
      await window.solo.invoke('calendar:updateBlock', { id: block.id, patch: before })
      invalidate(['calendar'])
    })
  }

  /**
   * The answer, applied.
   *
   * No undo offered here, deliberately. "This and every one after it" splits a
   * series in two and re-points the exceptions; putting that back is not a
   * single reverse operation, and an undo that half-worked on a year of
   * somebody's diary would be worse than none. The question itself is the
   * safeguard — it is asked before anything is written.
   */
  const applyScope = async (scope: EditScope): Promise<void> => {
    if (!pendingMove) return
    const { block, span } = pendingMove
    setPendingMove(null)

    await window.solo.invoke('calendar:editOccurrence', {
      // The series master, which for a generated occurrence is not this row.
      id: block.occurrenceOf ?? block.id,
      day: dayOf(block.startsAt),
      scope,
      patch: span
    })
    invalidate(['calendar'])
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

  /**
   * A task picked up from the rail.
   *
   * Held here rather than in either component, because the gesture starts in
   * the rail and finishes on the grid, and neither can own something the
   * other half of which belongs to its sibling.
   */
  const [pendingTask, setPendingTask] = useState<TaskWithContext | null>(null)

  const scheduleTask = async (task: TaskWithContext, startsAt: string): Promise<void> => {
    setPendingTask(null)
    const block = await window.solo.invoke('calendar:scheduleTask', { taskId: task.id, startsAt })
    invalidate(['calendar', 'tasks'])

    offer(`Scheduled ${task.title}`, async () => {
      // Deleting the block is all it takes: a trigger puts the task back on
      // the rail, whole, because the task never lost anything to begin with.
      await window.solo.invoke('entity:delete', { type: 'block', id: block.id })
      invalidate(['calendar', 'tasks'])
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

  /**
   * `U` shows and hides the rail.
   *
   * Guarded on the event target rather than on a modal flag: the calendar has
   * a title input on the grid itself now, and a shortcut that fired while
   * somebody was typing "Update the deck" would hide the rail three times.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'u' && event.key !== 'U') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      setRailOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
          <Button
            variant="ghost"
            onClick={() => setCalendarsOpen(true)}
            title="Subscribed calendars, import and export"
          >
            <Link2 size={14} strokeWidth={1.75} />
            Calendars
          </Button>
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
            <Button
              variant={railOpen ? 'outline' : 'ghost'}
              size="sm"
              aria-pressed={railOpen}
              onClick={() => setRailOpen((open) => !open)}
              title="Unscheduled tasks (U)"
            >
              <PanelRightClose size={13} strokeWidth={1.75} />
              Unscheduled
            </Button>
          )}

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
              markers={markers}
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
            <div className="flex min-h-0 flex-1 gap-3">
              <TimeGrid
                days={view === 'day' ? [anchor] : weekDays(anchor)}
                today={today}
                blocks={blocks}
                markers={markers}
                settings={settings}
                pendingTask={pendingTask}
                running={running}
                onOpenBlock={setEditing}
                onCreate={(span, title) => void create(span, title)}
                onReschedule={(block, span) => void reschedule(block, span)}
                onDuplicate={(block, span) => void duplicate(block, span)}
                onAdvance={(direction) => setAnchor(step(view, anchor, direction))}
                onScheduleTask={(task, startsAt) => void scheduleTask(task, startsAt)}
                onCancelTaskDrag={() => setPendingTask(null)}
                onStartTimer={(block) => void startTimer(block)}
              />

              {railOpen && (
                <UnscheduledRail today={today} onDragTask={(task) => setPendingTask(task)} />
              )}
            </div>
          )}

          {view === 'agenda' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AgendaView days={days} today={today} blocks={blocks} onOpenBlock={setEditing} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <Subscriptions
        open={calendarsOpen}
        range={{ from, to }}
        onClose={() => setCalendarsOpen(false)}
      />

      <ScopePrompt
        open={pendingMove !== null}
        title={pendingMove?.block.title ?? ''}
        action="Move"
        onChoose={(scope) => void applyScope(scope)}
        onCancel={() => setPendingMove(null)}
      />

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
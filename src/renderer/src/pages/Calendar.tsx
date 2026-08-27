import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Link2,
  Minus,
  Plane,
  PanelRightClose,
  Plus
} from 'lucide-react'
import type {
  CalendarBlockWithContext,
  CalendarSettings,
  EditScope,
  TaskWithContext
} from '@shared/types'
import {
  addDays,
  addMinutes,
  addMonths,
  dayFromDate,
  dayOf,
  isWorkingDay,
  monthGrid,
  stampAt,
  stampFromDate,
  weekDays
} from '@shared/calendar'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { useUndo } from '@/hooks/useUndo'
import { useEntityActions } from '@/hooks/useEntityActions'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { AgendaView } from './calendar/AgendaView'
import { BlockModal } from './calendar/BlockModal'
import { Availability } from './calendar/Availability'
import { WorkingHours } from './calendar/WorkingHours'
import { FocusMode } from './calendar/FocusMode'
import { Horizon } from './calendar/Horizon'
import { MonthView } from './calendar/MonthView'
import { ScopePrompt } from './calendar/ScopePrompt'
import { Subscriptions } from './calendar/Subscriptions'
import { TimeGrid } from './calendar/TimeGrid'
import { UnscheduledRail } from './calendar/UnscheduledRail'
import {
  ZOOM_LEVELS,
  dayLabel,
  durationLabel,
  monthLabel,
  nearestZoom,
  stepZoom
} from './calendar/grid'
import { LENSES } from './calendar/lens'
import { autoSchedule, gapsAcross } from './calendar/gaps'
import {
  applyScenario,
  emptyScenario,
  scenarioDelta,
  type Scenario,
  type ScenarioEdit
} from './calendar/scenario'
import { claimsKey, interpret, type Lens } from './calendar/keys'

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
  hourHeight: 56,
  timezone: 'Europe/London',
  pinTimezone: false
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
  const { remove } = useEntityActions()
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
  const [lens, setLens] = useState<Lens>('time')
  const [focusClientId, setFocusClientId] = useState<number | null>(null)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [ghostWeek, setGhostWeek] = useState(false)
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [focusBlock, setFocusBlock] = useState<CalendarBlockWithContext | null>(null)
  /** Null when the calendar is showing reality, which is almost always. */
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [tzDismissed, setTzDismissed] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)

  useOpenParam('new', () => setCreating({ day: anchor, startTime: '09:00', endTime: '10:00' }))

  const { data: settings = FALLBACK_SETTINGS } = useQuery({
    queryKey: keys.calendarSettings,
    queryFn: () => window.solo.invoke('calendar:settings', undefined),
    staleTime: 60_000
  })

  /**
   * The days on screen.
   *
   * A week view drops the weekend when somebody has said not to show it —
   * but only days they do not work, so a Saturday worker keeps their Saturday.
   * Hiding a day somebody works would hide the work on it.
   */
  const days = useMemo(() => {
    const all = daysInView(view, anchor)
    if (settings.showWeekends || view === 'month' || view === 'agenda') return all
    return all.filter((day) => isWorkingDay(settings.workingDays, day))
  }, [view, anchor, settings.showWeekends, settings.workingDays])
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

  /**
   * What the grid draws.
   *
   * Reality, unless a scenario is open — in which case it is reality plus a
   * pile of edits held in memory. Nothing about a scenario is written, which
   * is not a shortcut but the feature: one that wrote as it went would be
   * indistinguishable from editing your calendar badly, and the reason to
   * trust it is precisely that it cannot.
   */
  const shown = useMemo(
    () => (scenario ? applyScenario(blocks, scenario) : blocks),
    [blocks, scenario]
  )

  const delta = useMemo(
    () =>
      scenario
        ? scenarioDelta(blocks, shown, days, settings.dailyCapacityMinutes)
        : null,
    [scenario, blocks, shown, days, settings.dailyCapacityMinutes]
  )

  /** An edit while a scenario is open goes to the scenario, never to the row. */
  const stage = (edit: ScenarioEdit): void =>
    setScenario((current) =>
      current ? { ...current, edits: [...current.edits, edit] } : current
    )

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', undefined),
    enabled: lens === 'client'
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
    // Focus mode starts a session on whatever is already going, rather than
    // stacking a second one — two running timers is not a state anybody means
    // to be in.
    if (running) return
    await window.solo.invoke('time:start', {
      projectId: block.projectId,
      taskId: block.taskId,
      notes: block.title
    })
    invalidate(['time'])
  }

  const stopTimer = async (): Promise<void> => {
    if (!running) return
    await window.solo.invoke('time:stop', { id: running.entry.id })
    invalidate(['time'])
  }

  /**
   * Last week, for the ghost overlay.
   *
   * Fetched only while it is on. A permanently loaded second week would be a
   * query nobody asked for on every navigation, for a feature most people use
   * occasionally.
   */
  const { data: lastWeek = [] } = useQuery({
    queryKey: ['calendar', 'ghost', from, to],
    queryFn: () =>
      window.solo.invoke('calendar:blocks', { from: addDays(from, -7), to: addDays(to, -7) }),
    enabled: ghostWeek && (view === 'week' || view === 'day')
  })

  // Shifted forward so they sit under this week rather than beside it.
  const ghosts = useMemo(
    () =>
      lastWeek.map((block) => ({
        ...block,
        key: `ghost-${block.key}`,
        startsAt: shiftDays(block.startsAt, 7),
        endsAt: shiftDays(block.endsAt, 7)
      })),
    [lastWeek]
  )

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
    if (scenario) {
      stage({ kind: 'move', key: block.key, ...span })
      return
    }
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

  /**
   * Delete what has keyboard focus.
   *
   * A repeat asks which ones first, exactly as the modal does — the keyboard
   * is not a back door around the question that stops a year of somebody's
   * diary disappearing.
   */
  const removeBlock = async (block: CalendarBlockWithContext): Promise<void> => {
    if (scenario) {
      stage({ kind: 'remove', key: block.key })
      return
    }
    if (repeats(block)) {
      setEditing(block)
      return
    }
    await remove({ type: 'block', id: block.id }, block.title)
    invalidate(['calendar'])
  }

  /**
   * Commit a scenario.
   *
   * Everything in one go, with one undo offer covering the lot — a scenario
   * is a single decision ("take the Marsh job") however many drags it took to
   * think through, and offering to undo the drags one at a time would miss
   * the point of having asked the question.
   */
  const applyScenarioForReal = async (): Promise<void> => {
    if (!scenario) return
    const edits = scenario.edits
    setScenario(null)

    // The reverse of each edit, captured before anything is written.
    const undoSteps: (() => Promise<void>)[] = []

    for (const edit of edits) {
      if (edit.kind === 'move') {
        const block = blocks.find((one) => one.key === edit.key)
        if (!block) continue
        const before = { startsAt: block.startsAt, endsAt: block.endsAt }
        await window.solo.invoke('calendar:updateBlock', {
          id: block.occurrenceOf ?? block.id,
          patch: { startsAt: edit.startsAt, endsAt: edit.endsAt }
        })
        undoSteps.push(async () => {
          await window.solo.invoke('calendar:updateBlock', {
            id: block.occurrenceOf ?? block.id,
            patch: before
          })
        })
      } else if (edit.kind === 'remove') {
        const block = blocks.find((one) => one.key === edit.key)
        if (!block) continue
        await window.solo.invoke('entity:delete', {
          type: 'block',
          id: block.occurrenceOf ?? block.id
        })
      } else {
        const made = await window.solo.invoke('calendar:createBlock', {
          title: edit.block.title,
          blockType: edit.block.blockType,
          startsAt: edit.block.startsAt,
          endsAt: edit.block.endsAt,
          projectId: edit.block.projectId,
          clientId: edit.block.clientId,
          billable: edit.block.billable
        })
        undoSteps.push(async () => {
          await window.solo.invoke('entity:delete', { type: 'block', id: made.id })
        })
      }
    }

    invalidate(['calendar'])

    offer(`Applied ${scenario.name}`, async () => {
      // In reverse, so a move undone after an add does not look for something
      // that is no longer there.
      for (const step of undoSteps.reverse()) await step()
      invalidate(['calendar'])
    })
  }

  /**
   * What auto-schedule would do, worked out before anybody presses anything.
   *
   * Computed rather than promised: the button says how many it can actually
   * place, because one that silently did a different amount of work each time
   * is one nobody presses twice.
   */
  const { data: unscheduled = [] } = useQuery({
    queryKey: ['calendar', 'unscheduled', ''],
    queryFn: () => window.solo.invoke('calendar:unscheduled', undefined),
    enabled: railOpen
  })

  const placements = useMemo(
    () =>
      autoSchedule(
        unscheduled,
        gapsAcross(shown, days, settings),
        settings.defaultBlockMinutes
      ),
    [unscheduled, shown, days, settings]
  )

  const fillGaps = async (): Promise<void> => {
    const made: number[] = []
    for (const placement of placements) {
      const block = await window.solo.invoke('calendar:scheduleTask', {
        taskId: placement.taskId,
        startsAt: stampAt(placement.day, placement.start),
        endsAt: stampAt(placement.day, placement.start + placement.minutes)
      })
      made.push(block.id)
    }
    invalidate(['calendar', 'tasks'])

    offer(`Scheduled ${made.length} task${made.length === 1 ? '' : 's'}`, async () => {
      // All of them, because filling the gaps was one decision.
      for (const id of made) await window.solo.invoke('entity:delete', { type: 'block', id })
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

  const zoomSettings = useMutation({
    mutationFn: (patch: Partial<CalendarSettings>) =>
      window.solo.invoke('calendar:updateSettings', patch),
    onSuccess: () => invalidate(['calendar'])
  })

  /** Where this machine thinks it is, which is not where the calendar was written. */
  const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  /**
   * The keyboard model.
   *
   * What a key *means* lives in `keys.ts` and is tested there; this only acts
   * on the answer. Splitting it that way is what makes "fully operable
   * without a mouse" checkable — forty combinations and their interactions
   * are a table, and a table is worth testing rather than clicking.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = interpret(event, { hasFocus: focusedKey !== null })
      if (!action) return
      if (claimsKey(action)) event.preventDefault()

      const focused = focusedKey ? blocks.find((one) => one.key === focusedKey) : null

      switch (action.kind) {
        case 'step':
          setAnchor(step(view, anchor, action.direction))
          break
        case 'today':
          setAnchor(today)
          break
        case 'view':
          setView(action.view)
          break
        case 'lens':
          setLens(action.lens)
          break
        case 'new':
          openNew(anchor)
          break
        case 'toggleRail':
          setRailOpen((open) => !open)
          break
        case 'zoom':
          zoom.mutate(stepZoom(settings.hourHeight, action.direction))
          break
        case 'open':
          if (focused) setEditing(focused)
          break
        case 'nudge':
          if (focused) {
            void reschedule(focused, {
              startsAt: shiftMinutes(focused.startsAt, action.minutes * settings.snapMinutes),
              endsAt: shiftMinutes(focused.endsAt, action.minutes * settings.snapMinutes)
            })
          }
          break
        case 'resize':
          if (focused) {
            void reschedule(focused, {
              startsAt: focused.startsAt,
              endsAt: shiftMinutes(focused.endsAt, action.minutes * settings.snapMinutes)
            })
          }
          break
        case 'shiftDays':
          if (focused) {
            void reschedule(focused, {
              startsAt: shiftDays(focused.startsAt, action.days),
              endsAt: shiftDays(focused.endsAt, action.days)
            })
          }
          break
        case 'duplicate':
          if (focused) void duplicate(focused, { startsAt: focused.startsAt, endsAt: focused.endsAt })
          break
        case 'delete':
          if (focused) void removeBlock(focused)
          break
        case 'scenario':
          setScenario((current) => (current ? null : emptyScenario()))
          break
        case 'ghostWeek':
          setGhostWeek((on) => !on)
          break
        case 'availability':
          setAvailabilityOpen(true)
          break
        case 'focusMode':
          if (focused) {
            setFocusBlock(focused)
            void startTimer(focused)
          }
          break
        case 'escape':
          if (focusBlock) {
            void stopTimer()
            setFocusBlock(null)
            break
          }
          setFocusedKey(null)
          setPendingTask(null)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
          <Button
            variant="ghost"
            onClick={() => setHoursOpen(true)}
            title="Working hours, capacity and snapping"
          >
            <Clock size={14} strokeWidth={1.75} />
            Hours
          </Button>
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
          {/* §17.1: the active lens is one small word, and that word is the
              entire permanent cost of the whole feature. The grid stays
              minimal at rest — power through disclosure, not density. */}
          {scenario && (
            <span className="rounded-control border border-accent bg-accent-subtle px-2 py-0.5 text-[11px] text-accent">
              Scenario
            </span>
          )}

          {showZoom && lens !== 'time' && (
            <button
              type="button"
              onClick={() => setLens('time')}
              title="Back to the Time lens (1)"
              className="text-[11.5px] tracking-[0.04em] text-accent lowercase transition-opacity hover:opacity-70"
            >
              {LENSES.find((one) => one.value === lens)?.label}
            </button>
          )}

          {/* The Client lens needs to know whose week it is, and there is
              nowhere else to ask. Shown only while that lens is on. */}
          {showZoom && lens === 'client' && (
            <Select
              value={focusClientId}
              onChange={setFocusClientId}
              placeholder="Which client"
              className="w-[150px]"
              options={clients.map((one) => ({ value: one.id, label: one.name }))}
            />
          )}

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

      {/* §13: the machine has moved and the calendar has not.
          Blocks are wall time, so a week planned in London is 09:00 London
          wherever it is read. Saying so is the honest option; silently
          reinterpreting somebody's diary an hour sideways is not. */}
      {machineZone !== settings.timezone && !tzDismissed && (
        <div className="mb-2 flex shrink-0 items-center gap-2 rounded-control border border-line bg-raised px-3 py-1.5">
          <Plane size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
          <p className="min-w-0 flex-1 text-[12px] text-muted">
            This machine is on {machineZone}; your calendar is written in{' '}
            {settings.timezone}. Times are shown as you wrote them.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => zoomSettings.mutate({ timezone: machineZone })}
          >
            Use {machineZone}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTzDismissed(true)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* §17.2. Twenty-four pixels buys permanent three-month awareness, and
          dragging it scrubs the grid below in real time. Every other calendar
          makes you navigate to see the future. */}
      <Horizon today={today} days={days} settings={settings} onJump={setAnchor} />

      {/* §17.4. A 1px border and a chip, and nothing else changes — a
          scenario is the same calendar with the safety on, not a mode with
          its own furniture. */}
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
              blocks={shown}
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
                days={view === 'day' ? [anchor] : days}
                today={today}
                blocks={shown}
                markers={markers}
                settings={settings}
                lens={lens}
                focusClientId={focusClientId}
                focusedKey={focusedKey}
                pendingTask={pendingTask}
                running={running}
                onFocusBlock={setFocusedKey}
                onOpenBlock={setEditing}
                onCreate={(span, title) => void create(span, title)}
                onReschedule={(block, span) => void reschedule(block, span)}
                onDuplicate={(block, span) => void duplicate(block, span)}
                onAdvance={(direction) => setAnchor(step(view, anchor, direction))}
                onScheduleTask={(task, startsAt) => void scheduleTask(task, startsAt)}
                onCancelTaskDrag={() => setPendingTask(null)}
                onStartTimer={(block) => void startTimer(block)}
                ghosts={ghostWeek ? ghosts : []}
                onCrowdedDay={(day) => {
                  setAnchor(day)
                  setView('day')
                }}
              />

              {railOpen && (
                <UnscheduledRail
                  today={today}
                  fillable={placements.length}
                  onDragTask={(task) => setPendingTask(task)}
                  onFillGaps={() => void fillGaps()}
                />
              )}
            </div>
          )}

          {view === 'agenda' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AgendaView days={days} today={today} blocks={shown} onOpenBlock={setEditing} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* The difference, in the three terms that decide the answer. Hours,
          money, and which day breaks — a sentence somebody can act on, where
          two grids side by side would be a puzzle to solve first. */}
      <AnimatePresence>
        {scenario && delta && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={transition.page}
            className="pointer-events-auto fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-card border border-accent bg-surface px-3 py-2 shadow-xl"
          >
            <span className="numeric text-[12.5px] text-ink">
              {delta.minutes === 0
                ? 'No change yet'
                : `${delta.minutes > 0 ? '+' : '−'}${durationLabel(Math.abs(delta.minutes))} committed`}
            </span>

            {delta.pence !== 0 && (
              <span className="numeric text-[12.5px] text-muted">
                {delta.pence > 0 ? '+' : '−'}£
                {Math.abs(Math.round(delta.pence / 100)).toLocaleString('en-GB')}
              </span>
            )}

            {delta.newlyOver.map((one) => (
              <span key={one.day} className="numeric text-[12.5px] text-danger">
                {dayLabel(one.day, { weekday: 'short' })} now{' '}
                {durationLabel(one.overBy)} over
              </span>
            ))}

            <span aria-hidden className="h-4 w-px bg-line" />

            <Button variant="ghost" size="sm" onClick={() => setScenario(null)}>
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={scenario.edits.length === 0}
              onClick={() => void applyScenarioForReal()}
            >
              Apply
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* §17.6. Everything else fades rather than disappearing: the week is
          still there, and you are looking at one hour of it. */}
      <AnimatePresence>
        {focusBlock && (
          <FocusMode
            block={focusBlock}
            startedAt={running ? stampFromDate(new Date(running.entry.startedAt)) : null}
            onExtend={() => setFocusBlock(null)}
            onNext={() => {
              const next = blocks
                .filter((one) => one.startsAt > focusBlock.startsAt)
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
              void stopTimer()
              setFocusBlock(next ?? null)
              if (next) void startTimer(next)
            }}
            onStop={() => {
              void stopTimer()
              setFocusBlock(null)
            }}
          />
        )}
      </AnimatePresence>

      <Availability
        open={availabilityOpen}
        days={days}
        blocks={blocks}
        settings={settings}
        onClose={() => setAvailabilityOpen(false)}
      />

      <WorkingHours open={hoursOpen} settings={settings} onClose={() => setHoursOpen(false)} />

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

/** Shift a stamp by minutes, rolling into the next day if it has to. */
function shiftMinutes(stamp: string, minutes: number): string {
  return addMinutes(stamp, minutes)
}
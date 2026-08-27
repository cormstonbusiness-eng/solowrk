import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  ArrowUpRight,
  BanknoteArrowDown,
  CalendarDays,
  CalendarPlus,
  CircleCheckBig,
  Clock,
  FolderOpen,
  Hourglass,
  Megaphone,
  Plus,
  ReceiptText,
  Search,
  ShieldAlert,
  Wallet,
  X
} from 'lucide-react'
import { addDays, dayFromDate, describeSpan, occursOn } from '@shared/calendar'
import { rangeFor } from '@shared/taxYear'
import type { GoalProgress } from '@shared/types'
import { Page } from '@/components/Page'
import { WeeklyReview } from './dashboard/WeeklyReview'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Dot } from '@/components/ui/Empty'
import { gbp } from '@/components/ui/AnimatedNumber'
import { GoalRing } from '@/components/ui/GoalRing'
import { StatCard, type Stat } from '@/components/ui/StatCard'
import { FileChip } from '@/components/ui/FileChip'
import { SkeletonStat } from '@/components/ui/Skeleton'
import { keys } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { daysUntil, describeDue, formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * How many due tasks the Today card shows before handing over to the Tasks page.
 *
 * A dashboard that lists thirty tasks is not a dashboard, it is the Tasks page
 * with worse filtering — past a point the useful information is the count.
 */
const TODAY_TASK_LIMIT = 10

/** Four fits the row without the rings becoming decorative. */
const DASHBOARD_GOAL_LIMIT = 4

/** Four, then a link. A list of twelve worries is not a list anybody works. */
const ATTENTION_LIMIT = 4

/**
 * Days worth naming, as `mm-dd`.
 *
 * Driven by the real date rather than the theme, unlike the decorations — a
 * warm word on the day itself is welcome whether or not you ever touched a
 * theme, and "Merry Christmas" in June with the Christmas palette on would be
 * silly.
 */
const OCCASIONS: Record<string, string> = {
  '10-31': 'Happy Halloween',
  '12-24': 'Merry Christmas Eve',
  '12-25': 'Merry Christmas',
  '12-31': "Happy New Year's Eve",
  '01-01': 'Happy New Year'
}

function greeting(): string {
  const now = new Date()
  const occasion =
    OCCASIONS[
      `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    ]
  if (occasion) return occasion

  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The HQ screen. Everything here is live, and everything is a link to the
 * place that fixes it — a dashboard that reports a problem without offering
 * the way to deal with it is just a nag.
 */
export function Dashboard(): React.JSX.Element {
  const navigate = useNavigate()
  const today = dayFromDate(new Date())
  const week = rangeFor('week')

  /**
   * Dismissed for this session only, deliberately.
   *
   * Persisting would mean an overdue invoice could be hidden permanently with
   * one click, and the whole point of the panel is that money problems stay in
   * front of you. Clearing it for the afternoon is a reasonable thing to want;
   * clearing it for ever is not something the app should help with.
   */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary', 'month'],
    queryFn: () => window.solo.invoke('finance:summary', { period: 'month' })
  })

  const { data: history } = useQuery({
    queryKey: ['dashboard', 'trends'],
    queryFn: () => window.solo.invoke('dashboard:trends'),
    // Six periods of history do not move minute to minute, and this is the one
    // query on the page that touches every invoice ever raised.
    staleTime: 5 * 60_000
  })

  const { data: entries = [] } = useQuery({
    queryKey: ['time', 'week', week.from],
    queryFn: () => window.solo.invoke('time:list', { from: week.from, to: week.to })
  })

  // The whole week rather than just today, so the strip can show which days
  // have something on them without a second round trip per day.
  const { data: events = [] } = useQuery({
    queryKey: keys.blocks(week.from, week.to, null),
    queryFn: () => window.solo.invoke('calendar:blocks', { from: week.from, to: week.to })
  })

  const { data: dueTasks = [] } = useQuery({
    queryKey: keys.tasks({ dueBefore: today }),
    queryFn: () => window.solo.invoke('tasks:list', { dueBefore: today }),
    select: (tasks) => tasks.filter((task) => task.status !== 'done')
  })

  const { data: overdue = [] } = useQuery({
    queryKey: ['invoices', 'overdue'],
    queryFn: () => window.solo.invoke('invoices:overdue')
  })

  const { data: expiring = [] } = useQuery({
    queryKey: ['documents', 'expiring'],
    queryFn: () => window.solo.invoke('documents:expiring', { days: 45 })
  })

  /**
   * Marketing is Pro, so Basic does not ask.
   *
   * `enabled` rather than hiding the panel afterwards: the main process would
   * refuse these two calls anyway, and a dashboard that fires rejected requests
   * every time it mounts is a console full of noise for a section the user
   * cannot see.
   */
  const marketing = useFeature('marketing')

  const { data: duePosts = [] } = useQuery({
    queryKey: ['marketing', 'posts', 'dashboard', today],
    queryFn: () => window.solo.invoke('marketing:posts', { from: today, to: today }),
    enabled: marketing
  })

  const { data: stuckPosts = [] } = useQuery({
    queryKey: ['marketing', 'posts', 'needs_attention'],
    queryFn: () => window.solo.invoke('marketing:posts', { status: 'needs_attention' }),
    enabled: marketing
  })

  const { data: logo } = useQuery({
    queryKey: ['settings', 'logo'],
    queryFn: () => window.solo.invoke('settings:logo'),
    staleTime: 5 * 60_000
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.solo.invoke('settings:get')
  })

  const { data: goals = [] } = useQuery({
    queryKey: keys.goals,
    queryFn: () => window.solo.invoke('goals:list', {}),
    // Behind on it first, then closest to done: the one that needs attention
    // should not be the one scrolled off the end.
    select: (all) =>
      [...all]
        .filter((goal) => goal.status === 'active')
        .sort((a, b) => {
          const behind = (goal: GoalProgress): number =>
            goal.projected !== null && goal.target > 0 && goal.projected < goal.target ? 0 : 1
          return behind(a) - behind(b) || b.share - a.share
        })
  })

  const { data: recent = [] } = useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () => window.solo.invoke('files:recent', { limit: 5 }),
    // A filesystem walk is the one thing here worth not repeating on every
    // return to the dashboard.
    staleTime: 60_000
  })

  const trackedSeconds = entries.reduce((total, entry) => total + entry.duration, 0)

  const stats: Stat[] = [
    {
      label: 'Paid this month',
      value: summary?.income ?? 0,
      format: gbp,
      icon: Wallet,
      tone: 'success',
      history: history?.paid.map((point) => point.value) ?? [],
      empty: 'Send your first invoice',
      to: '/invoices'
    },
    {
      label: 'Awaiting payment',
      value: summary?.outstanding ?? 0,
      format: gbp,
      icon: Hourglass,
      tone: 'warning',
      history: history?.outstanding.map((point) => point.value) ?? [],
      empty: 'Raise an invoice',
      to: '/invoices'
    },
    {
      label: 'Overdue',
      value: summary?.overdue ?? 0,
      format: gbp,
      icon: BanknoteArrowDown,
      tone: 'danger',
      history: history?.overdue.map((point) => point.value) ?? [],
      empty: 'Nothing is late',
      to: '/invoices'
    },
    {
      label: 'Tracked this week',
      value: trackedSeconds / 3600,
      format: (hours: number) => `${hours.toFixed(1)}h`,
      icon: Clock,
      tone: 'info',
      history: history?.tracked.map((point) => point.value) ?? [],
      empty: 'Start your first timer',
      to: '/time'
    }
  ]

  const attention = [
    ...overdue.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      icon: ReceiptText,
      tone: 'danger' as const,
      text: `${invoice.number} overdue — ${describeDue(invoice.dueDate).label.toLowerCase()}`,
      to: '/invoices'
    })),
    ...expiring.map((document) => ({
      id: `document-${document.id}`,
      icon: ShieldAlert,
      tone: daysUntil(document.expiryAt ?? today) < 14 ? ('warning' as const) : ('info' as const),
      text: `${document.title} expires ${formatDate(document.expiryAt)}`,
      to: '/documents'
    })),
    ...stuckPosts.slice(0, 3).map((post) => ({
      id: `post-${post.id}`,
      icon: Megaphone,
      tone: 'warning' as const,
      text: `“${post.title || 'Untitled'}” missed its slot`,
      to: '/marketing'
    })),
    ...dueTasks
      .filter((task) => (task.dueAt ?? '') < today)
      .slice(0, 3)
      .map((task) => ({
        id: `task-${task.id}`,
        icon: CircleCheckBig,
        tone: 'warning' as const,
        text: `${task.title} — ${describeDue(task.dueAt).label.toLowerCase()}`,
        to: '/tasks'
      }))
  ].filter((item) => !dismissed.has(item.id))

  const todayEvents = events.filter((event) => occursOn(event, today))
  const dueToday = dueTasks.filter((task) => task.dueAt?.slice(0, 10) === today)
  const nothingToday =
    todayEvents.length === 0 && dueToday.length === 0 && duePosts.length === 0

  return (
    <Page
      display
      title={`${greeting()}${settings?.contactName ? `, ${settings.contactName.split(' ')[0]}` : ''}`}
      description={statusLine({
        date: new Date().toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        }),
        dueToday: dueToday.length,
        outstanding: summary?.outstanding ?? 0,
        trackedSeconds
      })}
      before={
        (logo || settings?.businessName) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.page}
            className="mb-2.5 flex items-center gap-2.5"
          >
            {logo && <img src={logo} alt="" className="h-10 w-10 rounded-chip object-contain" />}
            {settings?.businessName && (
              <span className="type-meta tracking-[0.04em] text-faint">
                {settings.businessName}
              </span>
            )}
          </motion.div>
        )
      }
      actions={
        <div data-tour="dashboard-actions" className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate('/time')}>
            <Clock size={14} strokeWidth={1.5} />
            Track time
          </Button>
          <Button variant="primary" onClick={() => navigate('/projects?new=1')}>
            <Plus size={14} strokeWidth={1.75} />
            New project
          </Button>
        </div>
      }
    >
      <motion.div
        data-tour="dashboard-stats"
        variants={listVariants}
        initial="initial"
        animate="animate"
        className="grid grid-cols-4 gap-4"
      >
        {/* Skeletons rather than four zeroes that then jump to real figures —
            a number is worse than a placeholder when it is about to be wrong. */}
        {summary === undefined
          ? stats.map((stat) => <SkeletonStat key={stat.label} />)
          : stats.map((stat) => (
              <motion.div key={stat.label} variants={listItemVariants}>
                <StatCard stat={stat} onOpen={() => navigate(stat.to)} />
              </motion.div>
            ))}
      </motion.div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="col-span-2 flex flex-col">
          <CardHeader
            title="Today"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/calendar')}>
                Calendar
                <ArrowUpRight size={13} strokeWidth={1.5} />
              </Button>
            }
          />

          <WeekStrip
            today={today}
            from={week.from}
            busy={new Set(events.map((event) => event.startsAt.slice(0, 10)))}
            onPick={() => navigate('/calendar')}
          />

          {nothingToday ? (
            // Capped rather than filling the column: an empty panel that takes
            // a quarter of the screen is the loudest thing on a quiet day.
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
              <ClearDayMark />
              <p className="type-body text-muted">Your day is clear.</p>
              <Button variant="secondary" size="sm" onClick={() => navigate('/calendar?new=1')}>
                <CalendarPlus size={13} strokeWidth={1.5} />
                Block out focus time
              </Button>
            </div>
          ) : (
            <motion.div
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="mt-3 flex flex-col gap-1"
            >
              {todayEvents.map((event) => (
                <motion.button
                  key={event.id}
                  variants={listItemVariants}
                  type="button"
                  onClick={() => navigate('/calendar')}
                  style={{ borderLeftColor: event.displayColour }}
                  className="flex items-center gap-3 rounded-control border-l-2 bg-raised px-3 py-2 text-left transition-colors duration-press ease-solo hover:bg-hover"
                >
                  <span className="numeric w-[92px] shrink-0 text-[11.5px] text-faint">
                    {event.allDay ? 'All day' : describeSpan(event)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {event.title}
                  </span>
                  {event.projectName && (
                    <span className="type-meta shrink-0 text-faint">{event.projectName}</span>
                  )}
                </motion.button>
              ))}

              {duePosts.map((post) => (
                <motion.button
                  key={`post-${post.id}`}
                  variants={listItemVariants}
                  type="button"
                  onClick={() => navigate('/marketing')}
                  className="flex items-center gap-3 rounded-control border border-dashed border-accent/40 px-3 py-2 text-left transition-colors duration-press ease-solo hover:bg-raised"
                >
                  <span className="numeric w-[92px] shrink-0 text-[11.5px] text-faint">
                    {post.scheduledAt ? post.scheduledAt.slice(11, 16) : 'Post'}
                  </span>
                  <Megaphone size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {post.title || post.body.slice(0, 50) || 'Untitled post'}
                  </span>
                </motion.button>
              ))}

              {dueToday.slice(0, TODAY_TASK_LIMIT).map((task) => (
                <motion.button
                  key={`task-${task.id}`}
                  variants={listItemVariants}
                  type="button"
                  onClick={() => navigate('/tasks')}
                  className="flex items-center gap-3 rounded-control border border-dashed border-line px-3 py-2 text-left transition-colors duration-press ease-solo hover:bg-raised"
                >
                  <span className="w-[92px] shrink-0 text-[11.5px] text-faint">Due today</span>
                  <Dot colour={task.projectColour ?? 'currentColor'} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                    {task.title}
                  </span>
                </motion.button>
              ))}

              {dueToday.length > TODAY_TASK_LIMIT && (
                <motion.button
                  variants={listItemVariants}
                  type="button"
                  onClick={() => navigate('/tasks')}
                  className="mt-0.5 flex items-center justify-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12px] text-muted transition-colors duration-press ease-solo hover:border-line-strong hover:text-ink"
                >
                  See all {dueToday.length} tasks due today
                  <ArrowUpRight size={12} strokeWidth={1.5} />
                </motion.button>
              )}
            </motion.div>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Needs attention"
            action={
              attention.length > ATTENTION_LIMIT && (
                <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')}>
                  View all ({attention.length})
                </Button>
              )
            }
          />
          {attention.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <CircleCheckBig size={18} strokeWidth={1.5} className="text-success" />
              <p className="type-body text-muted">Nothing overdue, nothing expiring.</p>
            </div>
          ) : (
            <motion.ul
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col gap-1.5"
            >
              {attention.slice(0, ATTENTION_LIMIT).map((item) => (
                <motion.li key={item.id} variants={listItemVariants} className="group relative">
                  <button
                    type="button"
                    onClick={() => navigate(item.to)}
                    style={{ borderLeftColor: `var(--color-${item.tone})` }}
                    className="flex w-full items-start gap-2 rounded-control border-l-2 bg-raised py-2 pr-7 pl-2.5 text-left text-[12px] text-muted transition-colors duration-press ease-solo hover:bg-hover"
                  >
                    <item.icon
                      size={13}
                      strokeWidth={1.5}
                      className="mt-0.5 shrink-0"
                      style={{ color: `var(--color-${item.tone})` }}
                    />
                    <span className="min-w-0 flex-1">{item.text}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    title="Hide until next launch"
                    onClick={() => setDismissed((current) => new Set(current).add(item.id))}
                    className="absolute top-1.5 right-1.5 rounded-chip p-1 text-faint opacity-0 transition-opacity duration-press ease-solo group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Card>
      </div>

      {goals.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition.page}
          className="mt-4"
        >
          <Card>
            <CardHeader
              title="Goals"
              action={
                <Button variant="ghost" size="sm" onClick={() => navigate('/goals')}>
                  All goals
                  <ArrowUpRight size={13} strokeWidth={1.5} />
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-4">
              {goals.slice(0, DASHBOARD_GOAL_LIMIT).map((goal) => (
                <GoalRing key={goal.id} goal={goal} onOpen={() => navigate('/goals')} />
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.page, delay: 0.15 }}
        className="mt-4 grid grid-cols-3 gap-4"
      >
        <Card className="col-span-2">
          <CardHeader
            title="Recent files"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/files')}>
                Files
                <ArrowUpRight size={13} strokeWidth={1.5} />
              </Button>
            }
          />
          {recent.length === 0 ? (
            <div className="grid h-[92px] place-items-center rounded-control border border-dashed border-line">
              <p className="type-body text-faint">Nothing in your workspace yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recent.map((file) => (
                <div
                  key={file.path}
                  className="group flex h-10 items-center gap-2.5 rounded-chip px-2 transition-colors duration-press ease-solo hover:bg-surface-hover"
                >
                  <FileChip name={file.name} />
                  <button
                    type="button"
                    onClick={() => void window.solo.invoke('files:open', { path: file.path })}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink"
                  >
                    {file.name}
                  </button>
                  <span className="type-meta max-w-[200px] shrink-0 truncate text-faint">
                    {file.path.split('\\').slice(0, -1).join(' / ')}
                  </span>
                  <span className="numeric shrink-0 text-[11px] text-faint group-hover:hidden">
                    {formatDate(file.modifiedAt)}
                  </span>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <RowAction
                      label="Open"
                      onClick={() => void window.solo.invoke('files:open', { path: file.path })}
                    >
                      <ArrowUpRight size={13} strokeWidth={1.5} />
                    </RowAction>
                    <RowAction
                      label="Show in Explorer"
                      onClick={() => void window.solo.invoke('files:reveal', { path: file.path })}
                    >
                      <FolderOpen size={13} strokeWidth={1.5} />
                    </RowAction>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <WeeklyReview />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.page, delay: 0.2 }}
        className="mt-4 grid grid-cols-3 gap-4"
      >
        {/* The one place the palette advertises itself: a shortcut nobody has
            been told about is a shortcut nobody uses. */}
        <Card>
          <CardHeader title="Jump to anything" />
          <p className="type-body mb-3 leading-relaxed text-muted">
            Search every project, client, invoice and document, or start a timer, from one
            keystroke.
          </p>
          <div className="flex items-center gap-2 rounded-control border border-line bg-raised px-3 py-2">
            <Search size={13} strokeWidth={1.5} className="text-faint" />
            <span className="flex-1 text-[12px] text-faint">Search or run a command</span>
            <kbd className="rounded-chip border border-line-strong px-1.5 py-0.5 text-[10px] text-muted">
              Ctrl K
            </kbd>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <QuickLink icon={CalendarDays} label="Calendar" onClick={() => navigate('/calendar')} />
            <QuickLink icon={ReceiptText} label="Invoices" onClick={() => navigate('/invoices')} />
            <QuickLink
              icon={FolderOpen}
              label="Workspace"
              onClick={() => void window.solo.invoke('workspace:reveal')}
            />
          </div>
        </Card>
      </motion.div>
    </Page>
  )
}

/**
 * The line under the greeting.
 *
 * Three facts at most, and only the ones that are true — a summary padded with
 * "0 tasks due" and "£0 outstanding" says less than the date alone. When
 * everything is genuinely clear it says so warmly rather than going blank,
 * because a blank line reads as something that failed to load.
 */
function statusLine({
  date,
  dueToday,
  outstanding,
  trackedSeconds
}: {
  date: string
  dueToday: number
  outstanding: number
  trackedSeconds: number
}): string {
  const parts: string[] = []

  if (dueToday > 0) parts.push(`${dueToday} task${dueToday === 1 ? '' : 's'} due today`)
  if (outstanding > 0) parts.push(`${formatMoney(outstanding)} outstanding`)
  if (trackedSeconds > 0) parts.push(`${(trackedSeconds / 3600).toFixed(1)}h tracked this week`)

  if (parts.length === 0) return `${date} · nothing due, nothing owed. A good place to start.`
  return `${date} · ${parts.join(' · ')}`
}

/**
 * Seven days across the top of the Today panel.
 *
 * Small enough to be glanceable and big enough to answer the question the
 * panel raises but cannot: "is tomorrow busy too?"
 */
function WeekStrip({
  today,
  from,
  busy,
  onPick
}: {
  today: string
  from: string
  busy: Set<string>
  onPick: () => void
}): React.JSX.Element {
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index))

  return (
    <div className="flex items-center gap-1 border-b border-line pb-3">
      {days.map((day) => {
        const isToday = day === today
        const letter = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
          weekday: 'narrow',
          timeZone: 'UTC'
        })

        return (
          <button
            key={day}
            type="button"
            onClick={onPick}
            aria-label={day}
            aria-current={isToday ? 'date' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 rounded-chip py-1.5',
              'transition-colors duration-press ease-solo hover:bg-surface-hover',
              isToday ? 'text-accent' : 'text-faint'
            )}
          >
            <span className="text-[10.5px] font-semibold">{letter}</span>
            <span
              className={cn(
                'h-1 w-1 rounded-full',
                busy.has(day) ? (isToday ? 'bg-accent' : 'bg-muted') : 'bg-transparent'
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

/**
 * A single-stroke mark for the clear-day state.
 *
 * Drawn rather than imported: one shape, no asset pipeline, and it takes the
 * theme's colours for free. It reads as a calendar with nothing in it, which
 * is the whole message.
 */
function ClearDayMark(): React.JSX.Element {
  return (
    <svg
      width="56"
      height="48"
      viewBox="0 0 56 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      aria-hidden
      className="text-disabled"
    >
      <rect x="8" y="10" width="40" height="32" rx="4" />
      <path d="M8 20h40M18 6v8M38 6v8" />
      <path d="M20 31h16" strokeDasharray="2 4" />
    </svg>
  )
}

function RowAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-chip p-1.5 text-faint transition-colors duration-press ease-solo hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  )
}

function QuickLink({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof CalendarDays
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors duration-press ease-solo hover:border-line-strong hover:text-ink"
    >
      <Icon size={12} strokeWidth={1.5} />
      {label}
    </button>
  )
}

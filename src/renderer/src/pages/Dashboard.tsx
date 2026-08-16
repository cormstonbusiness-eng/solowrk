import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  ArrowUpRight,
  CalendarDays,
  CircleCheckBig,
  Clock,
  FileText,
  FolderOpen,
  Megaphone,
  Plus,
  ReceiptText,
  Search,
  ShieldAlert
} from 'lucide-react'
import { dayFromDate, describeSpan, occursOn } from '@shared/calendar'
import { rangeFor } from '@shared/taxYear'
import type { GoalProgress } from '@shared/types'
import { GOAL_KINDS } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Dot } from '@/components/ui/Empty'
import { AnimatedNumber, gbp } from '@/components/ui/AnimatedNumber'
import { keys } from '@/lib/api'
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

/** Four fits the row without the bars becoming decorative slivers. */
const DASHBOARD_GOAL_LIMIT = 4

function greeting(): string {
  const hour = new Date().getHours()
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

  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary', 'month'],
    queryFn: () => window.solo.invoke('finance:summary', { period: 'month' })
  })

  const { data: entries = [] } = useQuery({
    queryKey: ['time', 'week', week.from],
    queryFn: () => window.solo.invoke('time:list', { from: week.from, to: week.to })
  })

  const { data: events = [] } = useQuery({
    queryKey: keys.events(today, today, null),
    queryFn: () => window.solo.invoke('events:list', { from: today, to: today })
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

  const { data: duePosts = [] } = useQuery({
    queryKey: ['marketing', 'posts', 'dashboard', today],
    queryFn: () => window.solo.invoke('marketing:posts', { from: today, to: today })
  })

  const { data: stuckPosts = [] } = useQuery({
    queryKey: ['marketing', 'posts', 'needs_attention'],
    queryFn: () => window.solo.invoke('marketing:posts', { status: 'needs_attention' })
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

  const stats = [
    {
      label: 'Paid this month',
      value: summary?.income ?? 0,
      format: gbp,
      tone: 'text-ink',
      to: '/finance'
    },
    {
      label: 'Awaiting payment',
      value: summary?.outstanding ?? 0,
      format: gbp,
      tone: 'text-warning',
      to: '/invoices'
    },
    {
      label: 'Overdue',
      value: summary?.overdue ?? 0,
      format: gbp,
      tone: summary?.overdue ? 'text-danger' : 'text-muted',
      to: '/invoices'
    },
    {
      label: 'Tracked this week',
      value: trackedSeconds / 3600,
      format: (hours: number) => `${hours.toFixed(1)}h`,
      tone: 'text-ink',
      to: '/time'
    }
  ]

  const attention = [
    ...overdue.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      icon: ReceiptText,
      tone: 'text-danger',
      text: `${invoice.number} overdue — ${describeDue(invoice.dueDate).label.toLowerCase()}`,
      to: '/invoices'
    })),
    ...expiring.map((document) => ({
      id: `document-${document.id}`,
      icon: ShieldAlert,
      tone: daysUntil(document.expiryAt ?? today) < 14 ? 'text-warning' : 'text-muted',
      text: `${document.title} expires ${formatDate(document.expiryAt)}`,
      to: '/documents'
    })),
    ...stuckPosts.slice(0, 3).map((post) => ({
      id: `post-${post.id}`,
      icon: Megaphone,
      tone: 'text-warning',
      text: `“${post.title || 'Untitled'}” missed its slot`,
      to: '/marketing'
    })),
    ...dueTasks
      .filter((task) => (task.dueAt ?? '') < today)
      .slice(0, 3)
      .map((task) => ({
        id: `task-${task.id}`,
        icon: CircleCheckBig,
        tone: 'text-warning',
        text: `${task.title} — ${describeDue(task.dueAt).label.toLowerCase()}`,
        to: '/tasks'
      }))
  ]

  const todayEvents = events.filter((event) => occursOn(event, today))
  const dueToday = dueTasks.filter((task) => task.dueAt?.slice(0, 10) === today)

  return (
    <Page
      title={greeting()}
      description={new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      })}
      before={
        (logo || settings?.businessName) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.page}
            className="mb-2.5 flex items-center gap-2.5"
          >
            {logo && (
              <img
                src={logo}
                alt=""
                className="h-7 w-7 rounded-[6px] object-contain"
              />
            )}
            {settings?.businessName && (
              <span className="text-[12px] tracking-[0.04em] text-muted">
                {settings.businessName}
              </span>
            )}
          </motion.div>
        )
      }
      actions={
        <div data-tour="dashboard-actions" className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate('/time')}>
            <Clock size={14} strokeWidth={1.75} />
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
        className="grid grid-cols-4 gap-3"
      >
        {stats.map((stat) => (
          <motion.button
            key={stat.label}
            variants={listItemVariants}
            type="button"
            onClick={() => navigate(stat.to)}
            className="text-left"
          >
            <Card className="p-3.5 transition-colors hover:border-line-strong">
              <p className="mb-2 text-[11px] text-muted">{stat.label}</p>
              <AnimatedNumber
                value={stat.value}
                format={stat.format}
                className={`numeric text-[22px] font-medium tracking-tight ${stat.tone}`}
              />
            </Card>
          </motion.button>
        ))}
      </motion.div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Card className="col-span-2 min-h-[240px]">
          <CardHeader
            title="Today"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/calendar')}>
                Calendar
                <ArrowUpRight size={13} strokeWidth={1.75} />
              </Button>
            }
          />

          {todayEvents.length === 0 && dueToday.length === 0 && duePosts.length === 0 ? (
            <div className="grid h-[168px] place-items-center rounded-control border border-dashed border-line">
              <p className="text-[12px] text-faint">Nothing scheduled today.</p>
            </div>
          ) : (
            <motion.div
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col gap-1"
            >
              {todayEvents.map((event) => (
                <motion.button
                  key={event.id}
                  variants={listItemVariants}
                  type="button"
                  onClick={() => navigate('/calendar')}
                  style={{ borderLeftColor: event.displayColour }}
                  className="flex items-center gap-3 rounded-control border-l-2 bg-raised px-3 py-2 text-left transition-colors hover:bg-hover"
                >
                  <span className="numeric w-[92px] shrink-0 text-[11.5px] text-muted">
                    {event.allDay ? 'All day' : describeSpan(event)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {event.title}
                  </span>
                  {event.projectName && (
                    <span className="shrink-0 text-[11px] text-faint">{event.projectName}</span>
                  )}
                </motion.button>
              ))}

              {duePosts.map((post) => (
                <motion.button
                  key={`post-${post.id}`}
                  variants={listItemVariants}
                  type="button"
                  onClick={() => navigate('/marketing')}
                  className="flex items-center gap-3 rounded-control border border-dashed border-accent/40 px-3 py-2 text-left transition-colors hover:bg-raised"
                >
                  <span className="numeric w-[92px] shrink-0 text-[11.5px] text-muted">
                    {post.scheduledAt ? post.scheduledAt.slice(11, 16) : 'Post'}
                  </span>
                  <Megaphone size={12} strokeWidth={1.75} className="shrink-0 text-accent" />
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
                  className="flex items-center gap-3 rounded-control border border-dashed border-line px-3 py-2 text-left transition-colors hover:bg-raised"
                >
                  <span className="w-[92px] shrink-0 text-[11.5px] text-faint">Due today</span>
                  <Dot colour={task.projectColour ?? '#5a5a63'} />
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
                  className="mt-0.5 flex items-center justify-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  See all {dueToday.length} tasks due today
                  <ArrowUpRight size={12} strokeWidth={1.75} />
                </motion.button>
              )}
            </motion.div>
          )}
        </Card>

        <Card className="min-h-[240px]">
          <CardHeader title="Needs attention" />
          {attention.length === 0 ? (
            <div className="grid h-[168px] place-items-center rounded-control border border-dashed border-line px-4 text-center">
              <p className="text-[12px] text-faint">
                Nothing overdue and nothing expiring. Enjoy it.
              </p>
            </div>
          ) : (
            <motion.ul
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col gap-1.5"
            >
              {attention.slice(0, 6).map((item) => (
                <motion.li key={item.id} variants={listItemVariants}>
                  <button
                    type="button"
                    onClick={() => navigate(item.to)}
                    className="flex w-full items-start gap-2 rounded-control bg-raised px-2.5 py-2 text-left text-[12px] text-muted transition-colors hover:bg-hover"
                  >
                    <item.icon
                      size={13}
                      strokeWidth={1.75}
                      className={cn('mt-0.5 shrink-0', item.tone)}
                    />
                    <span className="min-w-0 flex-1">{item.text}</span>
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Card>
      </div>

      {goals.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition.page}
          className="mt-3"
        >
          <Card>
            <CardHeader
              title="Goals"
              action={
                <Button variant="ghost" size="sm" onClick={() => navigate('/goals')}>
                  All goals
                  <ArrowUpRight size={13} strokeWidth={1.75} />
                </Button>
              }
            />
            <div className="grid grid-cols-4 gap-3">
              {goals.slice(0, DASHBOARD_GOAL_LIMIT).map((goal) => (
                <GoalBar key={goal.id} goal={goal} onOpen={() => navigate('/goals')} />
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.page, delay: 0.15 }}
        className="mt-3 grid grid-cols-3 gap-3"
      >
        <Card className="col-span-2">
          <CardHeader
            title="Recent files"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/files')}>
                Files
                <ArrowUpRight size={13} strokeWidth={1.75} />
              </Button>
            }
          />
          {recent.length === 0 ? (
            <div className="grid h-[92px] place-items-center rounded-control border border-dashed border-line">
              <p className="text-[12px] text-faint">Nothing in your workspace yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recent.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => void window.solo.invoke('files:open', { path: file.path })}
                  className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-raised"
                >
                  <FileText size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {file.name}
                  </span>
                  <span className="max-w-[220px] shrink-0 truncate text-[11px] text-faint">
                    {file.path.split('\\').slice(0, -1).join(' / ')}
                  </span>
                  <span className="numeric shrink-0 text-[11px] text-muted">
                    {formatDate(file.modifiedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* The one place the palette advertises itself: a shortcut nobody has
            been told about is a shortcut nobody uses. */}
        <Card>
          <CardHeader title="Jump to anything" />
          <p className="mb-3 text-[12px] leading-relaxed text-muted">
            Search every project, client, invoice and document, or start a timer, from one
            keystroke.
          </p>
          <div className="flex items-center gap-2 rounded-control border border-line bg-raised px-3 py-2">
            <Search size={13} strokeWidth={1.75} className="text-faint" />
            <span className="flex-1 text-[12px] text-faint">Search or run a command</span>
            <kbd className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-muted">
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
      className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      <Icon size={12} strokeWidth={1.75} />
      {label}
    </button>
  )
}
/**
 * One goal, small enough for four to share a row.
 *
 * Shows where you are against the target and, once there is enough of the
 * period elapsed to say so honestly, whether the current rate gets you there.
 */
function GoalBar({
  goal,
  onOpen
}: {
  goal: GoalProgress
  onOpen: () => void
}): React.JSX.Element {
  const money = GOAL_KINDS.find((entry) => entry.value === goal.kind)?.money ?? false
  const show = (value: number): string => (money ? formatMoney(value) : String(value))

  const met = goal.target > 0 && goal.current >= goal.target
  const behind = !met && goal.projected !== null && goal.target > 0 && goal.projected < goal.target

  return (
    <button type="button" onClick={onOpen} className="rounded-control text-left">
      <p className="mb-1 truncate text-[11px] text-muted">{goal.name}</p>

      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className={cn('numeric text-[16px] font-medium', met ? 'text-success' : 'text-ink')}>
          {show(goal.current)}
        </span>
        <span className="numeric text-[10.5px] text-faint">of {show(goal.target)}</span>
      </div>

      <div className="mb-1 h-1 overflow-hidden rounded-full bg-raised">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${goal.share / 100}%` }}
          transition={transition.page}
          style={{ backgroundColor: met ? '#30A46C' : goal.colour }}
          className="h-full rounded-full"
        />
      </div>

      <p className={cn('truncate text-[10.5px]', behind ? 'text-warning' : 'text-faint')}>
        {met
          ? 'Reached'
          : behind
            ? `Tracking ${show(goal.projected!)}`
            : goal.daysLeft !== null
              ? `${goal.daysLeft} day${goal.daysLeft === 1 ? '' : 's'} left`
              : `${Math.round(goal.share / 100)}%`}
      </p>
    </button>
  )
}

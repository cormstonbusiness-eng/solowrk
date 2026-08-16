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
  Plus,
  ReceiptText,
  Search,
  ShieldAlert
} from 'lucide-react'
import { dayFromDate, describeSpan, occursOn } from '@shared/calendar'
import { rangeFor } from '@shared/taxYear'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Dot } from '@/components/ui/Empty'
import { AnimatedNumber, gbp } from '@/components/ui/AnimatedNumber'
import { keys } from '@/lib/api'
import { daysUntil, describeDue, formatDate } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

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

          {todayEvents.length === 0 && dueToday.length === 0 ? (
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

              {dueToday.map((task) => (
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
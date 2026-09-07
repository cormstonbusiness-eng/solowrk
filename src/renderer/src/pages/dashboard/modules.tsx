import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  CircleCheckBig,
  Clock,
  FileText,
  FolderKanban,
  Megaphone,
  NotebookPen,
  PoundSterling,
  ReceiptText,
  Target,
  TriangleAlert,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { Feature } from '@shared/entitlements'
import { secondsToHours, timeValue } from '@shared/money'
import { dayFromDate } from '@shared/calendar'
import { rangeFor } from '@shared/taxYear'
import { keys, useInvalidate } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { useFeature } from '@/lib/features'
import { cn } from '@/lib/utils'

/**
 * The dashboard's modules.
 *
 * Each one owns its own query rather than being handed data by the page. That
 * is the whole reason this is modular: a module somebody has removed should
 * cost nothing, and it cannot cost nothing if the page fetches for it anyway.
 * React Query de-duplicates, so two modules reading the same figure still make
 * one request.
 *
 * **Two sizes, not a resize handle.** `compact` is one column and answers a
 * single question — a number, or three lines. `detailed` is two columns and
 * shows the working. Free resizing would mean every module coping with any
 * dimension, which is a lot of layout code to make most dashboards look worse.
 *
 * Every module links somewhere. A dashboard that reports a problem it cannot
 * take you to is a dashboard people stop reading.
 */

export type ModuleSize = 'compact' | 'detailed'

export interface DashboardModule {
  name: string
  /** One line, shown in the add menu. */
  description: string
  icon: LucideIcon
  /** Gated modules are offered but locked, never hidden — see the add menu. */
  feature?: Feature
  Render: (props: { size: ModuleSize }) => React.JSX.Element
}

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

/** A number with its label, the shape most compact modules take. */
function Stat({
  label,
  value,
  tone,
  hint
}: {
  label: string
  value: string
  tone?: 'ink' | 'warning' | 'success'
  hint?: string
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1.5 text-[11px] tracking-[0.06em] text-faint uppercase">{label}</p>
      <p
        className={cn(
          'numeric text-[24px] leading-none font-medium',
          tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink'
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] text-muted">{hint}</p>}
    </div>
  )
}

/** One line in a module's list, with the thing it opens. */
function Line({
  label,
  meta,
  onClick,
  tone
}: {
  label: string
  meta?: string
  onClick: () => void
  tone?: 'warning'
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-baseline gap-2 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-raised"
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px]',
          tone === 'warning' ? 'text-warning' : 'text-ink'
        )}
      >
        {label}
      </span>
      {meta && <span className="numeric shrink-0 text-[11px] text-faint">{meta}</span>}
    </button>
  )
}

/** What a module shows when there is genuinely nothing to report. */
function Quiet({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="py-2 text-[12px] text-faint">{children}</p>
}

/* ------------------------------------------------------------------ *
 * The modules
 * ------------------------------------------------------------------ */

function Money({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary', 'month'],
    queryFn: () => window.solo.invoke('finance:summary', { period: 'month' })
  })

  if (size === 'compact') {
    return (
      <Stat
        label="Paid this month"
        value={formatMoney(summary?.income ?? 0)}
        tone="success"
        hint={`${formatMoney(summary?.outstanding ?? 0)} still owed`}
      />
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <Stat label="Paid this month" value={formatMoney(summary?.income ?? 0)} tone="success" />
      <Stat label="Awaiting payment" value={formatMoney(summary?.outstanding ?? 0)} />
      <Stat
        label="Overdue"
        value={formatMoney(summary?.overdue ?? 0)}
        tone={(summary?.overdue ?? 0) > 0 ? 'warning' : 'ink'}
      />
      <div className="col-span-3 border-t border-line pt-3">
        <Line
          label="Open Finance"
          meta={`Expenses ${formatMoney(summary?.expenses ?? 0)}`}
          onClick={() => navigate('/finance')}
        />
      </div>
    </div>
  )
}

function Overdue({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: overdue = [] } = useQuery({
    queryKey: ['invoices', 'overdue'],
    queryFn: () => window.solo.invoke('invoices:overdue')
  })

  const total = overdue.reduce((sum, invoice) => sum + invoice.gross, 0)

  if (size === 'compact') {
    return (
      <Stat
        label="Overdue invoices"
        value={String(overdue.length)}
        tone={overdue.length > 0 ? 'warning' : 'ink'}
        hint={overdue.length > 0 ? `${formatMoney(total)} outstanding` : 'Nothing is late'}
      />
    )
  }

  return (
    <div>
      <Stat
        label="Overdue"
        value={formatMoney(total)}
        tone={total > 0 ? 'warning' : 'ink'}
        hint={`${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`}
      />
      <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-2">
        {overdue.length === 0 ? (
          <Quiet>Nothing is late. </Quiet>
        ) : (
          overdue.slice(0, 5).map((invoice) => (
            <Line
              key={invoice.id}
              tone="warning"
              label={`${invoice.number} · ${invoice.clientName ?? 'No client'}`}
              meta={formatMoney(invoice.gross)}
              onClick={() => navigate('/invoices')}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Today({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const day = dayFromDate(new Date())

  const { data: blocks = [] } = useQuery({
    queryKey: keys.blocks(day, day, null),
    queryFn: () => window.solo.invoke('calendar:blocks', { from: day, to: day })
  })

  const { data: due = [] } = useQuery({
    queryKey: keys.tasks({ dueBefore: day }),
    queryFn: () => window.solo.invoke('tasks:list', { dueBefore: day })
  })

  const open = due.filter((task) => task.status !== 'done')

  if (size === 'compact') {
    return (
      <Stat
        label="Today"
        value={`${blocks.length + open.length}`}
        hint={`${blocks.length} booked · ${open.length} due`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {blocks.length === 0 && open.length === 0 ? (
        <Quiet>Your day is clear.</Quiet>
      ) : (
        <>
          {blocks.slice(0, 4).map((block) => (
            <Line
              key={`block-${block.id}`}
              label={block.title}
              meta={block.startsAt.slice(11, 16)}
              onClick={() => navigate('/calendar')}
            />
          ))}
          {open.slice(0, 4).map((task) => (
            <Line
              key={`task-${task.id}`}
              label={task.title}
              meta="due"
              tone="warning"
              onClick={() => navigate('/tasks')}
            />
          ))}
        </>
      )}
    </div>
  )
}

function TimeWeek({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const week = rangeFor('week')

  const { data: entries = [] } = useQuery({
    queryKey: ['time', 'week', week.from],
    queryFn: () => window.solo.invoke('time:list', { from: week.from, to: week.to })
  })

  const seconds = entries.reduce((sum, entry) => sum + entry.duration, 0)

  // Billable and not yet on an invoice — the same pair of conditions the Time
  // page uses, and both matter: without the second, an hour already invoiced
  // would be counted as owed twice.
  const unbilled = entries
    .filter((entry) => entry.billable && entry.invoiceLineId === null)
    .reduce((sum, entry) => sum + timeValue(entry.duration, entry.rate), 0)

  if (size === 'compact') {
    return (
      <Stat
        label="Tracked this week"
        value={`${secondsToHours(seconds)}h`}
        hint={`${formatMoney(unbilled)} unbilled`}
      />
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <Stat label="Tracked this week" value={`${secondsToHours(seconds)}h`} />
      <Stat label="Unbilled value" value={formatMoney(unbilled)} tone="warning" />
      <div className="col-span-2 border-t border-line pt-2">
        <Line
          label="Open Time"
          meta={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
          onClick={() => navigate('/time')}
        />
      </div>
    </div>
  )
}

function Projects({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const active = projects.filter((project) => project.status === 'active')

  if (size === 'compact') {
    return (
      <Stat
        label="Active projects"
        value={String(active.length)}
        hint={`${active.reduce((sum, project) => sum + project.openTaskCount, 0)} tasks open`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {active.length === 0 ? (
        <Quiet>No active projects.</Quiet>
      ) : (
        active
          .slice(0, 6)
          .map((project) => (
            <Line
              key={project.id}
              label={project.name}
              meta={`${project.openTaskCount} open`}
              onClick={() => navigate(`/projects/${project.id}`)}
            />
          ))
      )}
    </div>
  )
}

function Clients({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  const counts = {
    lead: clients.filter((client) => client.relationshipStage === 'lead').length,
    prospect: clients.filter((client) => client.relationshipStage === 'prospect').length,
    active: clients.filter((client) => client.relationshipStage === 'active').length
  }

  if (size === 'compact') {
    return (
      <Stat
        label="Active clients"
        value={String(counts.active)}
        hint={`${counts.lead + counts.prospect} in the pipeline`}
      />
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <Stat label="Leads" value={String(counts.lead)} />
      <Stat label="Prospects" value={String(counts.prospect)} />
      <Stat label="Active" value={String(counts.active)} tone="success" />
      <div className="col-span-3 border-t border-line pt-2">
        <Line label="Open Clients" onClick={() => navigate('/clients')} />
      </div>
    </div>
  )
}

function Goals({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: goals = [] } = useQuery({
    queryKey: keys.goals,
    queryFn: () => window.solo.invoke('goals:list', {})
  })

  const met = goals.filter((goal) => goal.target > 0 && goal.current >= goal.target).length

  if (size === 'compact') {
    return (
      <Stat
        label="Goals met"
        value={`${met}/${goals.length}`}
        tone={goals.length > 0 && met === goals.length ? 'success' : 'ink'}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {goals.length === 0 ? (
        <Quiet>No goals set.</Quiet>
      ) : (
        goals.slice(0, 4).map((goal) => (
          <button
            key={goal.id}
            type="button"
            onClick={() => navigate('/goals')}
            className="rounded-control px-1.5 py-1 text-left transition-colors hover:bg-raised"
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[12.5px] text-ink">{goal.name}</span>
              {/* `share` is basis points — 2000 is 20% — as everywhere else. */}
              <span className="numeric shrink-0 text-[11px] text-faint">
                {Math.round(goal.share / 100)}%
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-raised">
              <div
                style={{ width: `${goal.share / 100}%`, backgroundColor: goal.colour }}
                className="h-full rounded-full"
              />
            </div>
          </button>
        ))
      )}
    </div>
  )
}

function Attention({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()

  const { data: overdue = [] } = useQuery({
    queryKey: ['invoices', 'overdue'],
    queryFn: () => window.solo.invoke('invoices:overdue')
  })

  const { data: expiring = [] } = useQuery({
    queryKey: ['documents', 'expiring'],
    queryFn: () => window.solo.invoke('documents:expiring', { days: 45 })
  })

  const count = overdue.length + expiring.length

  if (size === 'compact') {
    return (
      <Stat
        label="Needs attention"
        value={String(count)}
        tone={count > 0 ? 'warning' : 'success'}
        hint={count === 0 ? 'Nothing overdue or expiring' : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {count === 0 ? (
        <Quiet>Nothing overdue, nothing expiring.</Quiet>
      ) : (
        <>
          {overdue.slice(0, 3).map((invoice) => (
            <Line
              key={`inv-${invoice.id}`}
              tone="warning"
              label={`${invoice.number} is overdue`}
              meta={formatMoney(invoice.gross)}
              onClick={() => navigate('/invoices')}
            />
          ))}
          {expiring.slice(0, 3).map((document) => (
            <Line
              key={`doc-${document.id}`}
              tone="warning"
              label={`${document.title} expires`}
              meta={formatDate(document.expiryAt)}
              onClick={() => navigate('/documents')}
            />
          ))}
        </>
      )}
    </div>
  )
}

function RecentFiles({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: files = [] } = useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () => window.solo.invoke('files:recent', { limit: 8 })
  })

  if (size === 'compact') {
    return <Stat label="Recent files" value={String(files.length)} hint="In your workspace" />
  }

  return (
    <div className="flex flex-col gap-0.5">
      {files.length === 0 ? (
        <Quiet>Nothing recent.</Quiet>
      ) : (
        files
          .slice(0, 6)
          .map((file) => (
            <Line
              key={file.path}
              label={file.name}
              meta={formatDate(file.modifiedAt)}
              onClick={() => navigate('/files')}
            />
          ))
      )}
    </div>
  )
}

function Marketing({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const day = dayFromDate(new Date())

  const { data: due = [] } = useQuery({
    queryKey: ['marketing', 'posts', 'dashboard', day],
    queryFn: () => window.solo.invoke('marketing:posts', { from: day, to: day })
  })

  if (size === 'compact') {
    return <Stat label="Posts due today" value={String(due.length)} />
  }

  return (
    <div className="flex flex-col gap-0.5">
      {due.length === 0 ? (
        <Quiet>Nothing scheduled today.</Quiet>
      ) : (
        due
          .slice(0, 6)
          .map((post) => (
            <Line
              key={post.id}
              label={post.title || 'Untitled post'}
              onClick={() => navigate('/marketing')}
            />
          ))
      )}
    </div>
  )
}

function Tasks({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: tasks = [] } = useQuery({
    queryKey: keys.tasks({}),
    queryFn: () => window.solo.invoke('tasks:list', {})
  })

  const open = tasks.filter((task) => task.status !== 'done')

  if (size === 'compact') {
    return (
      <Stat
        label="Open tasks"
        value={String(open.length)}
        hint={`${tasks.length - open.length} done`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {open.length === 0 ? (
        <Quiet>Nothing outstanding.</Quiet>
      ) : (
        open
          .slice(0, 6)
          .map((task) => (
            <Line
              key={task.id}
              label={task.title}
              meta={task.dueAt ? formatDate(task.dueAt) : undefined}
              onClick={() => navigate('/tasks')}
            />
          ))
      )}
    </div>
  )
}

/**
 * The assistant's weekly review, as a module.
 *
 * The dashboard was this feature's only entry point, so making the dashboard
 * modular nearly deleted it by accident: nothing else in the app renders it.
 * It is a module now, which is the honest version — somebody who does not want
 * it can remove it, and somebody who does can find it in the add menu.
 *
 * Every figure in it is computed from the workspace rather than written by a
 * model. That is the reason it is trusted without checking, and it is worth not
 * forgetting when this card is edited.
 */
function Review({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const invalidate = useInvalidate()

  /*
    Not fired at all when the tier does not include it: the main process would
    refuse, and a query that only ever returns a refusal is a query worth not
    making. The card's own lock message covers the gated case.
  */
  const entitled = useFeature('aireview')

  const { data: review } = useQuery({
    queryKey: ['review', 'week'],
    queryFn: () => window.solo.invoke('review:week'),
    enabled: entitled,
    // The week does not change while somebody is looking at it.
    staleTime: 10 * 60_000
  })

  const file = useMutation({
    mutationFn: () => window.solo.invoke('review:file'),
    onSuccess: () => {
      invalidate(['notes'])
      navigate('/notes')
    }
  })

  if (!review) return <Quiet>Nothing to review yet.</Quiet>

  const focus = size === 'compact' ? review.focus.slice(0, 1) : review.focus

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col gap-2">
        {focus.map((one, index) => (
          <li key={index} className="flex gap-2.5">
            <span className="numeric mt-px shrink-0 text-[11px] text-faint">{index + 1}</span>
            <span className="text-[12.5px] leading-relaxed text-muted">{one}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => file.mutate()}
        disabled={file.isPending}
        className="mt-3 flex items-center gap-1 self-start text-[11.5px] text-faint transition-colors hover:text-ink"
      >
        Save the whole review as a note
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

/**
 * Keyed by the id stored in the layout, so a rename here is invisible to
 * anybody's saved dashboard and a deletion is handled by `parse` in `layout.ts`.
 */
export const MODULES = {
  money: {
    name: 'Money',
    description: 'Paid, owed and overdue this month.',
    icon: PoundSterling,
    Render: Money
  },
  attention: {
    name: 'Needs attention',
    description: 'Overdue invoices and documents about to expire.',
    icon: TriangleAlert,
    Render: Attention
  },
  today: {
    name: 'Today',
    description: 'What is booked and what is due.',
    icon: CalendarDays,
    Render: Today
  },
  time: {
    name: 'Time',
    description: 'Hours tracked this week and what they are worth.',
    icon: Clock,
    Render: TimeWeek
  },
  tasks: {
    name: 'Tasks',
    description: 'What is still open.',
    icon: CircleCheckBig,
    Render: Tasks
  },
  projects: {
    name: 'Projects',
    description: 'Active jobs and their open tasks.',
    icon: FolderKanban,
    Render: Projects
  },
  clients: {
    name: 'Clients',
    description: 'Your pipeline, by stage.',
    icon: Users,
    Render: Clients
  },
  overdue: {
    name: 'Overdue invoices',
    description: 'What is late, and how much.',
    icon: ReceiptText,
    Render: Overdue
  },
  goals: {
    name: 'Goals',
    description: 'Progress, measured from your real numbers.',
    icon: Target,
    Render: Goals
  },
  files: {
    name: 'Recent files',
    description: 'What changed in your workspace folder.',
    icon: FileText,
    Render: RecentFiles
  },
  review: {
    name: 'Weekly review',
    description: 'Three things to do this week, computed from your workspace.',
    icon: NotebookPen,
    feature: 'aireview',
    Render: Review
  },
  marketing: {
    name: 'Marketing',
    description: 'Posts due today.',
    icon: Megaphone,
    feature: 'marketing',
    Render: Marketing
  }
} satisfies Record<string, DashboardModule>

export type ModuleId = keyof typeof MODULES

/**
 * The registry, widened to the interface.
 *
 * `satisfies` above keeps the keys literal so `ModuleId` is a union of the
 * real ids rather than `string` — but it also keeps each value's *narrow*
 * type, and a module that declares no `feature` then has no such property for
 * anything reading the registry generically to check. This alias is the same
 * object seen as what it is.
 */
export const REGISTRY: Record<ModuleId, DashboardModule> = MODULES

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[]

/**
 * What a dashboard looks like before anybody has arranged one.
 *
 * The money first, because it is the question the app exists to answer, and
 * detailed because a single number is not enough to act on. Everything else is
 * compact: a new dashboard should fit on one screen, and somebody who wants
 * more can say so.
 */
export const DEFAULT_LAYOUT: { id: ModuleId; size: ModuleSize }[] = [
  { id: 'money', size: 'detailed' },
  { id: 'attention', size: 'compact' },
  { id: 'today', size: 'detailed' },
  { id: 'time', size: 'compact' },
  { id: 'tasks', size: 'compact' },
  { id: 'projects', size: 'compact' }
]

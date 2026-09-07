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
 * **Compact is the same information, smaller.** It is not a summary and it is
 * not a subset. Compact first shipped as one headline number per module, which
 * meant shrinking a card silently threw away the other figures and the whole
 * list — so a smaller dashboard was a less informative one, and the only way to
 * find out what had gone was to make everything detailed again.
 *
 * Every module therefore computes its figures and its rows once and hands the
 * same values to both sizes. `size` reaches `Figures`, `Row` and `List`, which
 * change the density: one column instead of three, label beside the figure
 * rather than above it, tighter type and padding. Nothing decides *what* to
 * show from it.
 *
 * Every module links somewhere. A dashboard that reports a problem it cannot
 * take you to is a dashboard people stop reading.
 */

export type ModuleSize = 'compact' | 'detailed'

export interface DashboardModule {
  name: string
  /**
   * What the module actually puts on screen, for the add menu.
   *
   * A sentence or two, and specific: the figures it shows, the list underneath
   * them, and where its rows go when clicked. These were one-liners naming the
   * topic — "What is still open" — which is a label rather than a description
   * and leaves somebody choosing between twelve cards they have never seen.
   */
  description: string
  icon: LucideIcon
  /**
   * The module's hue, from the theme's semantic colours.
   *
   * Twelve cards in one grid, each a header and a figure and a list, all in the
   * same greys, is a screen where nothing is findable — you read every title
   * every time because nothing else tells them apart. A colour on the icon
   * gives each one a mark the eye learns.
   *
   * Semantic tokens rather than a new palette, so the colour means what it
   * means everywhere else in the app: money is `success`, lateness is `danger`,
   * things needing a look are `warning`. Only the icon chip and a faint corner
   * wash are tinted — the design keeps orange under a tenth of any screen, and
   * twelve saturated cards would be a different app.
   */
  accent: Accent
  /** Gated modules are offered but locked, never hidden — see the add menu. */
  feature?: Feature
  Render: (props: { size: ModuleSize }) => React.JSX.Element
}

export type Accent = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** The CSS variable behind each, so a module names a meaning and not a hex. */
export const ACCENT_VAR: Record<Accent, string> = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  neutral: 'var(--color-muted)'
}

/* ------------------------------------------------------------------ *
 * Density
 * ------------------------------------------------------------------ */

interface Figure {
  label: string
  value: string
  tone?: 'ink' | 'warning' | 'success'
}

const TONE: Record<'ink' | 'warning' | 'success', string> = {
  ink: 'text-ink',
  warning: 'text-warning',
  success: 'text-success'
}

/**
 * A module's headline numbers, at either density.
 *
 * Detailed stacks a label above a large figure, across as many columns as
 * there are figures. Compact turns each one into a single row — label left,
 * figure right — which fits three or four numbers into about the height one of
 * them took, and keeps every one of them.
 */
function Figures({ size, items }: { size: ModuleSize; items: Figure[] }): React.JSX.Element {
  if (size === 'compact') {
    return (
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11.5px] text-muted">{item.label}</span>
            <span
              className={cn('numeric shrink-0 text-[13px] font-medium', TONE[item.tone ?? 'ink'])}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label}>
          <p className="mb-1.5 text-[11px] tracking-[0.06em] text-faint uppercase">{item.label}</p>
          <p className={cn('numeric text-[24px] leading-none font-medium', TONE[item.tone ?? 'ink'])}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * One line in a module's list, and the thing it opens.
 *
 * Compact keeps the row and its meta — the same items, not fewer — and buys the
 * space back from type size and padding rather than by dropping anything.
 */
function Row({
  size,
  label,
  meta,
  onClick,
  tone
}: {
  size: ModuleSize
  label: string
  meta?: string
  onClick: () => void
  tone?: 'warning'
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-baseline gap-2 rounded-control text-left transition-colors hover:bg-raised',
        size === 'compact' ? 'px-1 py-px' : 'px-1.5 py-1'
      )}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          size === 'compact' ? 'text-[11.5px]' : 'text-[12.5px]',
          tone === 'warning' ? 'text-warning' : 'text-ink'
        )}
      >
        {label}
      </span>
      {meta && (
        <span
          className={cn(
            'numeric shrink-0 text-faint',
            size === 'compact' ? 'text-[10.5px]' : 'text-[11px]'
          )}
        >
          {meta}
        </span>
      )}
    </button>
  )
}

/** A module's list, spaced for its density. */
function List({
  size,
  children
}: {
  size: ModuleSize
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col', size === 'compact' ? 'gap-0' : 'gap-0.5')}>{children}</div>
  )
}

/** The thin rule between a module's figures and its list. */
function Divide({ size }: { size: ModuleSize }): React.JSX.Element {
  return <div className={cn('border-t border-line', size === 'compact' ? 'my-2' : 'my-3')} />
}

/** What a module shows when there is genuinely nothing to report. */
function Quiet({
  size,
  children
}: {
  size: ModuleSize
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <p className={cn('text-faint', size === 'compact' ? 'py-1 text-[11.5px]' : 'py-2 text-[12px]')}>
      {children}
    </p>
  )
}

/**
 * Six periods of history, as bars.
 *
 * The point is the shape, not the values — whether the last six months went up
 * or fell off a cliff, answered without reading a number. So there are no axes,
 * no labels and no tooltip: anything that invites study belongs on the Finance
 * page, which is one click away and built for it.
 *
 * Heights are a share of the largest bar, with a floor of 2% so an empty period
 * is still a visible tick rather than a gap that reads as missing data. The
 * newest period is the brightest, because the eye should land on the right-hand
 * end where the present is.
 */
function Spark({
  points,
  colour,
  size
}: {
  points: { label: string; value: number }[]
  colour: string
  size: ModuleSize
}): React.JSX.Element | null {
  if (points.length === 0) return null

  const peak = Math.max(...points.map((point) => point.value), 1)

  return (
    <div
      className={cn('flex items-end gap-[3px]', size === 'compact' ? 'h-6' : 'h-10')}
      aria-hidden
    >
      {points.map((point, index) => (
        <div
          key={point.label}
          title={point.label}
          className="flex-1 rounded-[2px]"
          style={{
            height: `${Math.max(2, (point.value / peak) * 100)}%`,
            backgroundColor: colour,
            // Older periods recede. The last bar is the one being asked about.
            opacity: 0.25 + (index / Math.max(points.length - 1, 1)) * 0.75
          }}
        />
      ))}
    </div>
  )
}

/**
 * A proportion, as one bar in segments.
 *
 * Where `Spark` shows change over time, this shows a split at one moment — how
 * a pipeline divides, how much of a list is done. Segments below 2% still draw,
 * for the same reason the bars have a floor: a stage with one client in it
 * should be visible, not rounded away.
 */
function Split({
  parts,
  size
}: {
  parts: { value: number; colour: string; label: string }[]
  size: ModuleSize
}): React.JSX.Element | null {
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  if (total === 0) return null

  return (
    <div
      className={cn(
        'flex w-full overflow-hidden rounded-full bg-raised',
        size === 'compact' ? 'h-1.5' : 'h-2'
      )}
      aria-hidden
    >
      {parts.map((part) => (
        <div
          key={part.label}
          title={`${part.label}: ${part.value}`}
          style={{
            width: `${Math.max(part.value === 0 ? 0 : 2, (part.value / total) * 100)}%`,
            backgroundColor: part.colour
          }}
        />
      ))}
    </div>
  )
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

  /*
    Six periods of history behind the headline. Cached hard — it walks every
    invoice ever raised, and the past does not change minute to minute.
  */
  const { data: trends } = useQuery({
    queryKey: ['dashboard', 'trends'],
    queryFn: () => window.solo.invoke('dashboard:trends'),
    staleTime: 5 * 60_000
  })

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Paid this month', value: formatMoney(summary?.income ?? 0), tone: 'success' },
          { label: 'Awaiting payment', value: formatMoney(summary?.outstanding ?? 0) },
          {
            label: 'Overdue',
            value: formatMoney(summary?.overdue ?? 0),
            tone: (summary?.overdue ?? 0) > 0 ? 'warning' : 'ink'
          }
        ]}
      />
      {trends?.paid && trends.paid.length > 0 && (
        <div className="mt-3.5">
          <Spark points={trends.paid} colour={ACCENT_VAR.success} size={size} />
        </div>
      )}
      <Divide size={size} />
      <Row
        size={size}
        label="Open Finance"
        meta={`Expenses ${formatMoney(summary?.expenses ?? 0)}`}
        onClick={() => navigate('/finance')}
      />
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

  const { data: trends } = useQuery({
    queryKey: ['dashboard', 'trends'],
    queryFn: () => window.solo.invoke('dashboard:trends'),
    staleTime: 5 * 60_000
  })

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Overdue', value: formatMoney(total), tone: total > 0 ? 'warning' : 'ink' },
          { label: 'Invoices', value: String(overdue.length) }
        ]}
      />
      {trends?.overdue && trends.overdue.length > 0 && (
        <div className="mt-3.5">
          <Spark points={trends.overdue} colour={ACCENT_VAR.danger} size={size} />
        </div>
      )}
      <Divide size={size} />
      <List size={size}>
        {overdue.length === 0 ? (
          <Quiet size={size}>Nothing is late.</Quiet>
        ) : (
          overdue.slice(0, 5).map((invoice) => (
            <Row
              key={invoice.id}
              size={size}
              tone="warning"
              label={`${invoice.number} · ${invoice.clientName ?? 'No client'}`}
              meta={formatMoney(invoice.gross)}
              onClick={() => navigate('/invoices')}
            />
          ))
        )}
      </List>
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

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Booked', value: String(blocks.length) },
          { label: 'Due', value: String(open.length), tone: open.length > 0 ? 'warning' : 'ink' }
        ]}
      />
      <Divide size={size} />
      <List size={size}>
        {blocks.length === 0 && open.length === 0 ? (
          <Quiet size={size}>Your day is clear.</Quiet>
        ) : (
          <>
            {blocks.slice(0, 4).map((block) => (
              <Row
                key={`block-${block.id}`}
                size={size}
                label={block.title}
                meta={block.startsAt.slice(11, 16)}
                onClick={() => navigate('/calendar')}
              />
            ))}
            {open.slice(0, 4).map((task) => (
              <Row
                key={`task-${task.id}`}
                size={size}
                label={task.title}
                meta="due"
                tone="warning"
                onClick={() => navigate('/tasks')}
              />
            ))}
          </>
        )}
      </List>
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

  /*
    Monday to Sunday, in hours. Built from the entries already fetched rather
    than asked for separately, and always seven bars — a day with nothing on it
    is a gap worth seeing, so it has to be drawn rather than skipped.
  */
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${week.from}T00:00:00`)
    date.setDate(date.getDate() + index)
    const key = dayFromDate(date)
    return {
      label: date.toLocaleDateString('en-GB', { weekday: 'short' }),
      value: entries
        .filter((entry) => entry.startedAt.slice(0, 10) === key)
        .reduce((sum, entry) => sum + entry.duration, 0)
    }
  })

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Tracked this week', value: `${secondsToHours(seconds)}h` },
          { label: 'Unbilled value', value: formatMoney(unbilled), tone: 'warning' }
        ]}
      />
      <div className="mt-3.5">
        <Spark points={days} colour={ACCENT_VAR.accent} size={size} />
      </div>
      <Divide size={size} />
      <Row
        size={size}
        label="Open Time"
        meta={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
        onClick={() => navigate('/time')}
      />
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

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Active projects', value: String(active.length) },
          {
            label: 'Open tasks',
            value: String(active.reduce((sum, project) => sum + project.openTaskCount, 0))
          }
        ]}
      />
      <Divide size={size} />
      <List size={size}>
        {active.length === 0 ? (
          <Quiet size={size}>No active projects.</Quiet>
        ) : (
          active
            .slice(0, 6)
            .map((project) => (
              <Row
                key={project.id}
                size={size}
                label={project.name}
                meta={`${project.openTaskCount} open`}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
            ))
        )}
      </List>
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

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Leads', value: String(counts.lead) },
          { label: 'Prospects', value: String(counts.prospect) },
          { label: 'Active', value: String(counts.active), tone: 'success' }
        ]}
      />
      <div className="mt-3.5">
        <Split
          size={size}
          parts={[
            { label: 'Leads', value: counts.lead, colour: ACCENT_VAR.info },
            { label: 'Prospects', value: counts.prospect, colour: ACCENT_VAR.warning },
            { label: 'Active', value: counts.active, colour: ACCENT_VAR.success }
          ]}
        />
      </div>
      <Divide size={size} />
      <Row size={size} label="Open Clients" onClick={() => navigate('/clients')} />
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

  return (
    <div>
      <Figures
        size={size}
        items={[
          {
            label: 'Goals met',
            value: `${met}/${goals.length}`,
            tone: goals.length > 0 && met === goals.length ? 'success' : 'ink'
          }
        ]}
      />
      <Divide size={size} />
      <div className={cn('flex flex-col', size === 'compact' ? 'gap-1.5' : 'gap-2')}>
        {goals.length === 0 ? (
          <Quiet size={size}>No goals set.</Quiet>
        ) : (
          goals.slice(0, 4).map((goal) => (
            <button
              key={goal.id}
              type="button"
              onClick={() => navigate('/goals')}
              className={cn(
                'rounded-control text-left transition-colors hover:bg-raised',
                size === 'compact' ? 'px-1 py-px' : 'px-1.5 py-1'
              )}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    'truncate text-ink',
                    size === 'compact' ? 'text-[11.5px]' : 'text-[12.5px]'
                  )}
                >
                  {goal.name}
                </span>
                {/* `share` is basis points — 2000 is 20% — as everywhere else. */}
                <span className="numeric shrink-0 text-[10.5px] text-faint">
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

  return (
    <div>
      <Figures
        size={size}
        items={[
          {
            label: 'Overdue invoices',
            value: String(overdue.length),
            tone: overdue.length > 0 ? 'warning' : 'ink'
          },
          {
            label: 'Expiring documents',
            value: String(expiring.length),
            tone: expiring.length > 0 ? 'warning' : 'ink'
          }
        ]}
      />
      <Divide size={size} />
      <List size={size}>
        {count === 0 ? (
          <Quiet size={size}>Nothing overdue, nothing expiring.</Quiet>
        ) : (
          <>
            {overdue.slice(0, 3).map((invoice) => (
              <Row
                key={`inv-${invoice.id}`}
                size={size}
                tone="warning"
                label={`${invoice.number} is overdue`}
                meta={formatMoney(invoice.gross)}
                onClick={() => navigate('/invoices')}
              />
            ))}
            {expiring.slice(0, 3).map((document) => (
              <Row
                key={`doc-${document.id}`}
                size={size}
                tone="warning"
                label={`${document.title} expires`}
                meta={formatDate(document.expiryAt)}
                onClick={() => navigate('/documents')}
              />
            ))}
          </>
        )}
      </List>
    </div>
  )
}

function RecentFiles({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const { data: files = [] } = useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () => window.solo.invoke('files:recent', { limit: 8 })
  })

  return (
    <List size={size}>
      {files.length === 0 ? (
        <Quiet size={size}>Nothing recent.</Quiet>
      ) : (
        files
          .slice(0, 6)
          .map((file) => (
            <Row
              key={file.path}
              size={size}
              label={file.name}
              meta={formatDate(file.modifiedAt)}
              onClick={() => navigate('/files')}
            />
          ))
      )}
    </List>
  )
}

function Marketing({ size }: { size: ModuleSize }): React.JSX.Element {
  const navigate = useNavigate()
  const day = dayFromDate(new Date())

  const { data: due = [] } = useQuery({
    queryKey: ['marketing', 'posts', 'dashboard', day],
    queryFn: () => window.solo.invoke('marketing:posts', { from: day, to: day })
  })

  return (
    <div>
      <Figures size={size} items={[{ label: 'Posts due today', value: String(due.length) }]} />
      <Divide size={size} />
      <List size={size}>
        {due.length === 0 ? (
          <Quiet size={size}>Nothing scheduled today.</Quiet>
        ) : (
          due
            .slice(0, 6)
            .map((post) => (
              <Row
                key={post.id}
                size={size}
                label={post.title || 'Untitled post'}
                onClick={() => navigate('/marketing')}
              />
            ))
        )}
      </List>
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

  return (
    <div>
      <Figures
        size={size}
        items={[
          { label: 'Open tasks', value: String(open.length) },
          { label: 'Done', value: String(tasks.length - open.length), tone: 'success' }
        ]}
      />
      <div className="mt-3.5">
        <Split
          size={size}
          parts={[
            { label: 'Done', value: tasks.length - open.length, colour: ACCENT_VAR.success },
            { label: 'Open', value: open.length, colour: ACCENT_VAR.info }
          ]}
        />
      </div>
      <Divide size={size} />
      <List size={size}>
        {open.length === 0 ? (
          <Quiet size={size}>Nothing outstanding.</Quiet>
        ) : (
          open
            .slice(0, 6)
            .map((task) => (
              <Row
                key={task.id}
                size={size}
                label={task.title}
                meta={task.dueAt ? formatDate(task.dueAt) : undefined}
                onClick={() => navigate('/tasks')}
              />
            ))
        )}
      </List>
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

  if (!review) return <Quiet size={size}>Nothing to review yet.</Quiet>

  return (
    <div className="flex flex-col">
      {/* All three either way — the three are the point of the review. */}
      <ol className={cn('flex flex-col', size === 'compact' ? 'gap-1' : 'gap-2')}>
        {review.focus.map((one, index) => (
          <li key={index} className="flex gap-2">
            <span className="numeric mt-px shrink-0 text-[10.5px] text-faint">{index + 1}</span>
            <span
              className={cn(
                'leading-relaxed text-muted',
                size === 'compact' ? 'text-[11.5px]' : 'text-[12.5px]'
              )}
            >
              {one}
            </span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => file.mutate()}
        disabled={file.isPending}
        className={cn(
          'mt-3 flex items-center gap-1 self-start text-faint transition-colors hover:text-ink',
          size === 'compact' ? 'text-[11px]' : 'text-[11.5px]'
        )}
      >
        Save the whole review as a note
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

export const MODULES = {
  money: {
    name: 'Money',
    description:
      'What you have been paid this month, what is still owed and what is overdue, with your expenses. Opens Finance.',
    icon: PoundSterling,
    accent: 'success',
    Render: Money
  },
  attention: {
    name: 'Needs attention',
    description:
      'How many invoices are late and how many documents expire within 45 days, then lists both. Each one opens where it is dealt with.',
    icon: TriangleAlert,
    accent: 'warning',
    Render: Attention
  },
  today: {
    name: 'Today',
    description:
      'How many hours are booked today and how many tasks are due, then both lists with their times. Opens the calendar or the task.',
    icon: CalendarDays,
    accent: 'info',
    Render: Today
  },
  time: {
    name: 'Time',
    description:
      'Hours tracked since Monday and the value of the billable ones not yet on an invoice. Opens Time.',
    icon: Clock,
    accent: 'accent',
    Render: TimeWeek
  },
  tasks: {
    name: 'Tasks',
    description:
      'How many tasks are open and how many are done, then the open ones with their due dates. Opens Tasks.',
    icon: CircleCheckBig,
    accent: 'info',
    Render: Tasks
  },
  projects: {
    name: 'Projects',
    description:
      'How many projects are active and how many tasks they hold between them, then each project. Opens that project.',
    icon: FolderKanban,
    accent: 'accent',
    Render: Projects
  },
  clients: {
    name: 'Clients',
    description:
      'How many clients are leads, prospects and active — the shape of your pipeline in three numbers. Opens Clients.',
    icon: Users,
    accent: 'success',
    Render: Clients
  },
  overdue: {
    name: 'Overdue invoices',
    description:
      'The total owed on late invoices and how many there are, then each one with its client and amount. Opens Invoices.',
    icon: ReceiptText,
    accent: 'danger',
    Render: Overdue
  },
  goals: {
    name: 'Goals',
    description:
      'How many goals you have met, then each one with a progress bar. Progress is counted from your records, never typed in. Opens Goals.',
    icon: Target,
    accent: 'accent',
    Render: Goals
  },
  files: {
    name: 'Recent files',
    description:
      'The files most recently changed in your workspace folder, with the date each was touched. Opens Files.',
    icon: FileText,
    accent: 'neutral',
    Render: RecentFiles
  },
  review: {
    name: 'Weekly review',
    description:
      'Three things worth doing this week, worked out from your own records rather than written by a model. Files the full review as a note.',
    icon: NotebookPen,
    accent: 'accent',
    feature: 'aireview',
    Render: Review
  },
  marketing: {
    name: 'Marketing',
    description:
      'How many posts are scheduled for today, and which. Opens Marketing.',
    icon: Megaphone,
    accent: 'warning',
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
 * detailed because a figure that size is worth the room. Everything else is
 * compact — which now costs no information, only height.
 */
export const DEFAULT_LAYOUT: { id: ModuleId; size: ModuleSize }[] = [
  { id: 'money', size: 'detailed' },
  { id: 'attention', size: 'compact' },
  { id: 'today', size: 'detailed' },
  { id: 'time', size: 'compact' },
  { id: 'tasks', size: 'compact' },
  { id: 'projects', size: 'compact' }
]

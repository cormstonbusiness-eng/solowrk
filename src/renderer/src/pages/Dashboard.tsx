import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Clock, Plus } from 'lucide-react'
import { dayFromDate } from '@shared/calendar'
import { rangeFor } from '@shared/taxYear'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { keys } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { transition } from '@/lib/motion'
import { Grid } from './dashboard/Grid'
import { useDashboardLayout } from './dashboard/layout'

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
 * The HQ screen, and the one page in the app the user arranges themselves.
 *
 * What is on it, in what order and at what size is a layout stored per
 * workspace — see `dashboard/layout.ts`. This file owns only the two things
 * that are not modular: the greeting, and the two actions that belong to the
 * whole page rather than to any one panel.
 *
 * The modules live in `dashboard/modules.tsx` and each fetches its own data, so
 * removing one genuinely removes its cost rather than only hiding it.
 *
 * The three queries below stay here because the line under the greeting reads
 * across all of them. React Query de-duplicates, so the modules asking the same
 * questions do not ask them twice.
 */
export function Dashboard(): React.JSX.Element {
  const navigate = useNavigate()
  const today = dayFromDate(new Date())
  const week = rangeFor('week')

  const { slots, ready, setSlots } = useDashboardLayout()

  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary', 'month'],
    queryFn: () => window.solo.invoke('finance:summary', { period: 'month' })
  })

  const { data: entries = [] } = useQuery({
    queryKey: ['time', 'week', week.from],
    queryFn: () => window.solo.invoke('time:list', { from: week.from, to: week.to })
  })

  const { data: dueTasks = [] } = useQuery({
    queryKey: keys.tasks({ dueBefore: today }),
    queryFn: () => window.solo.invoke('tasks:list', { dueBefore: today })
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.solo.invoke('settings:get')
  })

  const { data: logo } = useQuery({
    queryKey: ['settings', 'logo'],
    queryFn: () => window.solo.invoke('settings:logo')
  })

  const trackedSeconds = entries.reduce((sum, entry) => sum + entry.duration, 0)
  const dueToday = dueTasks.filter(
    (task) => task.status !== 'done' && task.dueAt?.slice(0, 10) === today
  )

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
      {/*
        Nothing until the stored layout has been read. The wait is a database
        read on the same machine, so it is a frame or two — and rendering the
        default first would show somebody else's dashboard sliding into theirs
        every time they opened the app.

        `data-tour` stays on the grid: the tour points at the dashboard's
        contents, and its contents are now this.
      */}
      <div data-tour="dashboard-stats">
        {ready && <Grid slots={slots} onChange={setSlots} />}
      </div>
    </Page>
  )
}

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

import { motion } from 'motion/react'
import { ArrowUpRight, Clock, Plus, ReceiptText, TriangleAlert } from 'lucide-react'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AnimatedNumber, gbp } from '@/components/ui/AnimatedNumber'
import { listItemVariants, listVariants, transition } from '@/lib/motion'

/**
 * Phase 0 renders the HQ layout with sample figures so the composition, rhythm
 * and motion can be judged now. Phase 6 replaces every number here with live
 * queries — nothing on this page reads real data yet.
 */
const sampleStats = [
  { label: 'Invoiced this month', value: 4820, format: gbp, tone: 'text-ink' },
  { label: 'Awaiting payment', value: 2150, format: gbp, tone: 'text-warning' },
  { label: 'Overdue', value: 450, format: gbp, tone: 'text-danger' },
  { label: 'Tracked this week', value: 27, format: (n: number) => `${n.toFixed(1)}h`, tone: 'text-ink' }
] as const

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function Dashboard(): React.JSX.Element {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  return (
    <Page
      title={greeting()}
      description={today}
      actions={
        <div data-tour="dashboard-actions" className="flex items-center gap-2">
          <Button variant="secondary" size="md">
            <Clock size={14} strokeWidth={1.75} />
            Start timer
          </Button>
          <Button variant="primary" size="md">
            <Plus size={14} strokeWidth={1.75} />
            New project
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2">
        <TriangleAlert size={14} strokeWidth={1.75} className="shrink-0 text-warning" />
        <p className="text-[12px] text-muted">
          Sample figures — the dashboard is wired to live data in phase 6.
        </p>
      </div>

      <motion.div
        data-tour="dashboard-stats"
        variants={listVariants}
        initial="initial"
        animate="animate"
        className="grid grid-cols-4 gap-3"
      >
        {sampleStats.map((stat) => (
          <motion.div key={stat.label} variants={listItemVariants}>
            <Card className="p-3.5">
              <p className="mb-2 text-[11px] text-muted">{stat.label}</p>
              <AnimatedNumber
                value={stat.value}
                format={stat.format}
                className={`numeric text-[22px] font-medium tracking-tight ${stat.tone}`}
              />
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Card className="col-span-2 min-h-[240px]">
          <CardHeader
            title="Today"
            action={
              <Button variant="ghost" size="sm">
                Calendar
                <ArrowUpRight size={13} strokeWidth={1.75} />
              </Button>
            }
          />
          <div className="grid h-[168px] place-items-center rounded-control border border-dashed border-line">
            <p className="text-[12px] text-faint">Schedule and due tasks — phase 5</p>
          </div>
        </Card>

        <Card className="min-h-[240px]">
          <CardHeader title="Needs attention" />
          <motion.ul
            variants={listVariants}
            initial="initial"
            animate="animate"
            className="flex flex-col gap-1.5"
          >
            {['Invoice #0038 overdue 12 days', 'Insurance renews in 3 weeks'].map((line) => (
              <motion.li
                key={line}
                variants={listItemVariants}
                className="flex items-start gap-2 rounded-control bg-raised px-2.5 py-2 text-[12px] text-muted"
              >
                <ReceiptText size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
                {line}
              </motion.li>
            ))}
          </motion.ul>
        </Card>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.page, delay: 0.15 }}
        className="mt-3"
      >
        <Card className="min-h-[160px]">
          <CardHeader title="Recent files" />
          <div className="grid h-[92px] place-items-center rounded-control border border-dashed border-line">
            <p className="text-[12px] text-faint">Workspace activity — phase 3</p>
          </div>
        </Card>
      </motion.div>
    </Page>
  )
}
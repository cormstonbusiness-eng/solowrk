import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { ChannelConsistency, ChannelReturn } from '@shared/types'
import { addMonths, dayFromDate, startOfMonth } from '@shared/calendar'
import { today } from '@shared/taxYear'
import { Card, CardHeader } from '@/components/ui/Card'
import { ProPanel } from '@/components/ProPanel'
import { formatMoney } from '@/lib/format'
import { keys } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { listItemVariants, listVariants } from '@/lib/motion'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * What actually worked (§8).
 *
 * Deliberately sparse: four things in one column, no dashboard grid. This is
 * a page somebody reads once a quarter and makes a decision from, and a wall
 * of tiles is how a page like that stops being read.
 *
 * Nothing here is estimated, and nothing is drawn from no data. §8.3 is
 * explicit that when there is nothing to show the honest thing is one line,
 * not four empty charts — an empty chart implies the measurement happened and
 * came back zero, which is a different and much worse claim.
 */

type Range = 'quarter' | 'year' | 'twelve'

const RANGES: { value: Range; label: string }[] = [
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
  { value: 'twelve', label: 'Last 12 months' }
]

function boundsFor(range: Range): { from: string; to: string } {
  const to = today()
  const now = dayFromDate(new Date())

  if (range === 'twelve') return { from: addMonths(startOfMonth(now), -11), to }

  const [year, month] = now.split('-').map(Number)
  if (range === 'year') return { from: `${year}-01-01`, to }

  // Calendar quarters, not the tax year. Somebody asking "how did this
  // quarter go" means the three months they just lived through.
  const firstMonth = Math.floor((month! - 1) / 3) * 3 + 1
  return { from: `${year}-${String(firstMonth).padStart(2, '0')}-01`, to }
}

export function ResultsTab(): React.JSX.Element {
  const entitled = useFeature('marketingresults')
  const [range, setRange] = useState<Range>('quarter')
  const { from, to } = boundsFor(range)

  const { data } = useQuery({
    queryKey: keys.results(from, to),
    queryFn: () => window.solo.invoke('results:marketing', { from, to }),
    enabled: entitled
  })

  if (!entitled) {
    return (
      <ProPanel
        feature="marketingresults"
        title="Find out which half of it is working"
        blurb="Where your clients actually came from, what each campaign returned, and whether you kept the promises you made about showing up. No tracking, no pixels — it reads the records you already keep."
        does={[
          {
            title: 'Where clients came from',
            body: 'Counted from what you said when you added them, with what each channel has earned you beside it.'
          },
          {
            title: 'What a campaign returned',
            body: 'Spend, enquiries, clients won and revenue, sorted by what came back.'
          },
          {
            title: 'Whether you kept it up',
            body: 'A year of weeks, one row per channel. The pattern is the point: posted in March, stopped in April, started again in July.'
          },
          {
            title: 'Spend against your budget',
            body: 'What you planned for the year, what has gone, and what is left.'
          }
        ]}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-1">
        {RANGES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setRange(entry.value)}
            className={cn(
              'h-7 rounded-control px-2.5 text-[12px] transition-colors',
              range === entry.value ? 'bg-raised text-ink' : 'text-faint hover:text-ink'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/*
        §8.3, word for word in spirit: one line rather than four empty charts.
        An empty chart says the measurement happened and came back nothing,
        which is a different and much worse claim than "you have not told me
        anything yet".
      */}
      {data?.empty ? (
        <p className="max-w-[560px] text-[12.5px] leading-relaxed text-faint">
          Once you&rsquo;ve logged a few campaigns and told SoloWrk where clients came from, this
          is where you&rsquo;ll see what&rsquo;s actually working.
        </p>
      ) : (
        <div className="flex max-w-[720px] flex-col gap-3 overflow-y-auto pb-2">
          <WhereFrom channels={data?.channels ?? []} />
          <CampaignReturns campaigns={data?.campaigns ?? []} />
          <Consistency rows={data?.consistency ?? []} />
          <Budget budget={data?.budget} />
        </div>
      )}
    </div>
  )
}

/**
 * §8.1's first item, and the one the whole tab exists for: the single most
 * useful marketing fact a freelancer can have, and almost none of them know
 * it.
 */
function WhereFrom({ channels }: { channels: ChannelReturn[] }): React.JSX.Element | null {
  if (channels.length === 0) return null

  const most = Math.max(...channels.map((one) => one.revenue), 1)

  return (
    <Card className="p-4">
      <CardHeader title="Where clients came from" />

      <motion.div variants={listVariants} initial="hidden" animate="visible" className="flex flex-col gap-2.5">
        {channels.map((channel) => (
          <motion.div key={channel.channelId} variants={listItemVariants} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-ink">{channel.name}</span>
              <span className="numeric shrink-0 text-faint">
                {channel.clients} {channel.clients === 1 ? 'client' : 'clients'}
              </span>
              <span className="numeric w-[86px] shrink-0 text-right text-ink">
                {formatMoney(channel.revenue)}
              </span>
            </div>

            {/* Bar length is revenue, because that is the question being
                asked. Two clients worth £400 is not a better channel than
                one worth £12,000. */}
            <div className="h-[6px] overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: channel.colour }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max((channel.revenue / most) * 100, 2)}%` }}
                transition={transition.layout}
              />
            </div>
          </motion.div>
        ))}
      </motion.div>
    </Card>
  )
}

function CampaignReturns({
  campaigns
}: {
  campaigns: { campaignId: number; name: string; spend: number; enquiries: number; won: number; revenue: number; ratio: number | null; costPerEnquiry: number | null }[]
}): React.JSX.Element | null {
  const measured = campaigns.filter(
    (one) => one.spend > 0 || one.enquiries > 0 || one.won > 0
  )
  if (measured.length === 0) return null

  return (
    <Card className="p-4">
      <CardHeader title="What campaigns returned" />

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="pb-1.5 font-normal">Campaign</th>
              <th className="pb-1.5 text-right font-normal">Spend</th>
              <th className="pb-1.5 text-right font-normal">Enquiries</th>
              <th className="pb-1.5 text-right font-normal">Per enquiry</th>
              <th className="pb-1.5 text-right font-normal">Won</th>
              <th className="pb-1.5 text-right font-normal">Revenue</th>
              <th className="pb-1.5 text-right font-normal">Return</th>
            </tr>
          </thead>
          <tbody>
            {measured.map((row) => (
              <tr key={row.campaignId} className="border-t border-line">
                <td className="max-w-[160px] truncate py-1.5 text-ink">{row.name}</td>
                <td className="numeric py-1.5 text-right text-muted">{formatMoney(row.spend)}</td>
                <td className="numeric py-1.5 text-right text-muted">{row.enquiries || '—'}</td>
                <td className="numeric py-1.5 text-right text-muted">
                  {row.costPerEnquiry === null ? '—' : formatMoney(row.costPerEnquiry)}
                </td>
                <td className="numeric py-1.5 text-right text-muted">{row.won || '—'}</td>
                <td className="numeric py-1.5 text-right text-ink">{formatMoney(row.revenue)}</td>
                {/* An em dash, never a number, when nothing was spent. There
                    is no return on nothing, and printing one would be the
                    most flattering possible lie. */}
                <td
                  className={cn(
                    'numeric py-1.5 text-right',
                    row.ratio === null
                      ? 'text-disabled'
                      : row.ratio >= 1
                        ? 'text-success'
                        : 'text-warning'
                  )}
                >
                  {row.ratio === null ? '—' : `${row.ratio.toFixed(1)}×`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/**
 * §8.2's strip.
 *
 * One row per committed channel, one cell per period, three states. The point
 * is the *pattern* — posted through March, stopped in April when a big
 * project landed, started again in July when work dried up. That shape is the
 * actual problem, and seeing it drawn is more persuasive than any advice,
 * which is why the cells are three states and not a gradient. A gradient
 * would be prettier and much harder to read.
 */
function Consistency({ rows }: { rows: ChannelConsistency[] }): React.JSX.Element | null {
  if (rows.length === 0) return null

  return (
    <Card className="p-4">
      <CardHeader
        title="Whether you kept it up"
        action={
          <span className="flex items-center gap-2.5 text-[10.5px] text-faint">
            <Key className="bg-line" label="nothing" />
            <Key className="bg-warning" label="some" />
            <Key className="bg-success" label="met" />
          </span>
        }
      />

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.channelId} className="flex items-center gap-2.5">
            <span className="w-[104px] shrink-0 truncate text-[12px] text-ink">{row.name}</span>
            <span className="numeric w-[62px] shrink-0 text-[10.5px] text-disabled">
              {row.commitment}/{row.period === 'week' ? 'wk' : 'mo'}
            </span>

            <div className="flex min-w-0 flex-1 gap-[2px] overflow-x-auto">
              {row.periods.map((period) => (
                <span
                  key={period.start}
                  title={`${period.start} — ${period.done} of ${row.commitment}`}
                  className={cn(
                    'h-[14px] min-w-[6px] flex-1 rounded-[2px]',
                    period.fill === 'met'
                      ? 'bg-success'
                      : period.fill === 'partial'
                        ? 'bg-warning'
                        : 'bg-line'
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Key({ className, label }: { className: string; label: string }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-[9px] w-[9px] rounded-[2px]', className)} />
      {label}
    </span>
  )
}

function Budget({
  budget
}: {
  budget?: { budget: number; spent: number; remaining: number }
}): React.JSX.Element | null {
  if (!budget || budget.budget === 0) return null

  const over = budget.remaining < 0
  const used = Math.min((budget.spent / budget.budget) * 100, 100)

  return (
    <Card className="p-4">
      <CardHeader title="Spend against budget" />

      <div className="mb-2 flex items-baseline gap-3 text-[12px]">
        <span className="text-muted">
          <span className="numeric text-ink">{formatMoney(budget.spent)}</span> of{' '}
          <span className="numeric">{formatMoney(budget.budget)}</span>
        </span>
        <span className={cn('numeric ml-auto', over ? 'text-danger' : 'text-muted')}>
          {over
            ? `${formatMoney(Math.abs(budget.remaining))} over`
            : `${formatMoney(budget.remaining)} left`}
        </span>
      </div>

      <div className="h-[8px] overflow-hidden rounded-full bg-line">
        <motion.div
          className={cn('h-full rounded-full', over ? 'bg-danger' : 'bg-accent')}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(used, 2)}%` }}
          transition={transition.layout}
        />
      </div>
    </Card>
  )
}

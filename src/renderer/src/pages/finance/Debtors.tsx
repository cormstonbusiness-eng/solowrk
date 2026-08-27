import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { BellOff, HandCoins, Mail } from 'lucide-react'
import type { AgedDebtor, DebtHeat } from '@shared/types'
import { BUCKET_LABELS, DEBT_BUCKETS } from '@shared/debtors'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { ChaserModal, type ChaserDraft } from '@/components/finance/ChaserModal'
import { useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Who owes you, and for how long.
 *
 * A single "outstanding" figure hides the only thing worth knowing: £4,000
 * owed for a week is a business running normally, and £4,000 owed for four
 * months is a problem that has been quietly getting worse.
 *
 * Every row carries the chase note already written, because the gap between
 * seeing a debt and doing something about it is where the money is actually
 * lost — not in the writing of the email, in the not getting round to it.
 */

const HEAT_TEXT: Record<DebtHeat, string> = {
  calm: 'text-faint',
  watch: 'text-warning',
  urgent: 'text-danger'
}

const HEAT_EDGE: Record<DebtHeat, string> = {
  calm: 'bg-line-strong',
  watch: 'bg-warning',
  urgent: 'bg-danger'
}

export function Debtors(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [chaser, setChaser] = useState<ChaserDraft | null>(null)
  const [client, setClient] = useState<number | 'all' | 'none'>('all')

  const { data: report } = useQuery({
    queryKey: ['debtors'],
    queryFn: () => window.solo.invoke('debtors:aged')
  })

  // Stopping a chase is the Pro schedule; drafting one by hand is not. The
  // bell is hidden rather than shown and refused, since a button that only
  // ever explains why it does not work is not a button.
  const canStop = useFeature('chasing')

  const stop = useMutation({
    mutationFn: (id: number) => window.solo.invoke('chasing:stop', { id }),
    onSuccess: () => invalidate(['invoices'])
  })

  if (!report) return <></>

  const rows =
    client === 'all'
      ? report.rows
      : report.rows.filter((row) => (row.invoice.clientId ?? 'none') === client)

  return (
    <>
      <div className="mb-3 grid grid-cols-5 gap-3">
        {DEBT_BUCKETS.map((bucket) => (
          <Card key={bucket} className="p-3.5">
            <p className="mb-1.5 text-[11px] text-muted">{BUCKET_LABELS[bucket]}</p>
            <p
              className={cn(
                'numeric text-[17px] font-medium',
                report.buckets[bucket] === 0
                  ? 'text-faint'
                  : bucket === 'current'
                    ? 'text-ink'
                    : bucket === 'over90'
                      ? 'text-danger'
                      : 'text-warning'
              )}
            >
              {formatMoney(report.buckets[bucket])}
            </p>
          </Card>
        ))}
      </div>

      <Swap
        empty={report.rows.length === 0}
        fallback={
          <Empty
            icon={HandCoins}
            title="Nobody owes you anything"
            body="Every invoice you have sent has been paid. Aged debt appears here the moment one has not."
          />
        }
      >
        <>
          {report.byClient.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Chip label="Everyone" active={client === 'all'} onClick={() => setClient('all')}>
                {formatMoney(report.total)}
              </Chip>
              {report.byClient.map((debt) => (
                <Chip
                  key={debt.clientId ?? 'none'}
                  label={debt.clientName}
                  active={client === (debt.clientId ?? 'none')}
                  onClick={() => setClient(debt.clientId ?? 'none')}
                >
                  {formatMoney(debt.total)}
                  {debt.oldestDays > 0 && (
                    <span className="text-faint"> · {debt.oldestDays}d</span>
                  )}
                </Chip>
              ))}
            </div>
          )}

          <motion.div
            variants={listVariants}
            initial="initial"
            animate="animate"
            className="flex flex-col gap-2"
          >
            {rows.map((row) => (
              <motion.div key={row.invoice.id} variants={listItemVariants}>
                <DebtorRow
                  row={row}
                  onChase={setChaser}
                  records={canStop}
                  onStop={canStop ? () => stop.mutate(row.invoice.id) : null}
                />
              </motion.div>
            ))}
          </motion.div>

          <p className="mt-3 text-[11px] text-faint">
            Aged against each invoice's due date, so an invoice on ninety-day terms is not late the
            day it becomes payable. Nothing is sent for you.
          </p>
        </>
      </Swap>

      <ChaserModal chaser={chaser} onClose={() => setChaser(null)} />
    </>
  )
}

function DebtorRow({
  row,
  onChase,
  records,
  onStop
}: {
  row: AgedDebtor
  onChase: (draft: ChaserDraft) => void
  /**
   * Whether sending this note advances the chase schedule.
   *
   * False without the Pro entitlement, matching the hand-written chaser on the
   * Invoices page: the note itself is Basic, the schedule that remembers where
   * you got to is not.
   */
  records: boolean
  onStop: (() => void) | null
}): React.JSX.Element {
  const { invoice, daysOverdue } = row

  return (
    <Card className="group relative flex items-center justify-between gap-4 overflow-hidden py-2.5 pl-4">
      {/* The edge carries the urgency, so a long list reads before it is read. */}
      <span className={cn('absolute top-0 bottom-0 left-0 w-[3px]', HEAT_EDGE[row.heat])} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">
          {invoice.clientName ?? 'No client'}
          <span className="text-faint"> · {invoice.number}</span>
        </p>
        <p className="truncate text-[11px] text-faint">
          Due {formatDate(invoice.dueDate)}
          {row.lastChasedAt ? ` · chased ${formatDate(row.lastChasedAt)}` : ''}
          {invoice.projectName ? ` · ${invoice.projectName}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className={cn('numeric w-[74px] text-right text-[11.5px]', HEAT_TEXT[row.heat])}>
          {daysOverdue > 0 ? `${daysOverdue} days late` : 'Not yet due'}
        </span>
        <span className="numeric w-[84px] text-right text-[13px] text-ink">
          {formatMoney(invoice.gross, { pennies: true })}
        </span>

        {daysOverdue > 0 && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void window.solo
                  .invoke('invoices:chaser', {
                    id: invoice.id,
                    attempt: row.nextAttempt
                  })
                  .then((draft) =>
                    // Carrying the chase along so sending it advances the
                    // schedule — a note sent from here counts the same as one
                    // sent from the queue.
                    onChase(
                      records
                        ? { ...draft, chase: { id: invoice.id, attempt: row.nextAttempt } }
                        : draft
                    )
                  )
              }
            >
              <Mail size={13} strokeWidth={1.75} />
              {row.nextAttempt > 1 ? `Chase again` : 'Chase'}
            </Button>
            {onStop && (
            <button
              type="button"
              aria-label={`Stop chasing ${invoice.number}`}
              title="Stop chasing this one — it is being paid"
              onClick={onStop}
              className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
            >
              <BellOff size={13} strokeWidth={1.75} />
            </button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function Chip({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-control border px-2.5 py-1 text-[11.5px] transition-colors',
        active
          ? 'border-accent bg-accent-subtle text-ink'
          : 'border-line text-muted hover:bg-hover hover:text-ink'
      )}
    >
      {label} <span className="numeric text-muted">{children}</span>
    </button>
  )
}

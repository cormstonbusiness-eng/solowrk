import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, EyeOff, Landmark, Undo2, Upload } from 'lucide-react'
import type { BankImportResult, BankTransactionWithMatches } from '@shared/types'
import { EXPENSE_CATEGORIES as CATEGORIES } from '@shared/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { Select } from '@/components/ui/Select'
import { useInvalidate } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Reconciling a bank statement.
 *
 * A CSV the user downloaded from their own bank — there is no connection to
 * any bank in this app and no credentials anywhere in it, which is the only
 * shape this feature can take having promised the work stays on the machine.
 *
 * **Nothing reconciles itself.** A wrong match marks an invoice paid that was
 * not, which stops the chasing on money still owed and puts income in the
 * accounts that never arrived — and neither is visible afterwards. So every
 * line shows what it might be, with the reasons, and a person presses the
 * button. Where two candidates are equally plausible the app says so rather
 * than picking one.
 */

type View = 'new' | 'matched' | 'ignored'

const VIEWS: { value: View; label: string }[] = [
  { value: 'new', label: 'To reconcile' },
  { value: 'matched', label: 'Done' },
  { value: 'ignored', label: 'Ignored' }
]

export function Bank(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [view, setView] = useState<View>('new')
  const [result, setResult] = useState<BankImportResult | null>(null)

  const { data: lines = [] } = useQuery({
    queryKey: ['bank', view],
    queryFn: () => window.solo.invoke('bank:list', { status: view })
  })

  const bring = useMutation({
    mutationFn: async () => {
      const [path] = await window.solo.invoke('files:pick', { multiple: false })
      if (!path) return null
      return window.solo.invoke('bank:import', { path })
    },
    onSuccess: (imported) => {
      if (!imported) return
      setResult(imported)
      invalidate(['bank'])
    }
  })

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-control border border-line p-0.5">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              className={cn(
                'rounded-[6px] px-2.5 py-1 text-[12px]',
                view === option.value ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Button variant="primary" size="sm" onClick={() => bring.mutate()} disabled={bring.isPending}>
          <Upload size={14} strokeWidth={1.75} />
          Import a statement
        </Button>
      </div>

      {result && <ImportReport result={result} onDismiss={() => setResult(null)} />}

      <Swap
        empty={lines.length === 0}
        fallback={
          view === 'new' ? (
            <Empty
              icon={Landmark}
              title="Nothing waiting to be reconciled"
              body="Download a CSV statement from your bank and bring it in. Nothing is sent anywhere — the file is read on this machine, and the app suggests what each line might be for you to confirm."
              action={
                <Button variant="primary" onClick={() => bring.mutate()}>
                  <Upload size={14} strokeWidth={1.75} />
                  Import a statement
                </Button>
              }
            />
          ) : (
            <Empty
              icon={Landmark}
              title={view === 'matched' ? 'Nothing reconciled yet' : 'Nothing ignored'}
              body="Lines you have dealt with appear here."
            />
          )
        }
      >
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2"
        >
          {lines.map((line) => (
            <motion.div key={line.id} variants={listItemVariants}>
              <TransactionRow line={line} />
            </motion.div>
          ))}
        </motion.div>
      </Swap>
    </>
  )
}

/**
 * What the import actually did.
 *
 * Including the lines it could not read. Silently dropping four rows out of a
 * statement is how somebody ends up with accounts that do not reconcile and no
 * idea why — so they are counted, and the columns it recognised are named so a
 * misread is obvious at a glance rather than a fortnight later.
 */
function ImportReport({
  result,
  onDismiss
}: {
  result: BankImportResult
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <Card className={cn('mb-3 py-2.5', result.error && 'border-danger')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {result.error ? (
            <p className="text-[12.5px] text-danger">{result.error}</p>
          ) : (
            <>
              <p className="text-[12.5px] text-ink">
                {result.added} new{' '}
                {result.added === 1 ? 'transaction' : 'transactions'}
                {result.alreadySeen > 0 && (
                  <span className="text-muted"> · {result.alreadySeen} already in</span>
                )}
                {result.skipped.length > 0 && (
                  <span className="text-warning">
                    {' '}
                    · {result.skipped.length} line{result.skipped.length === 1 ? '' : 's'} not read
                  </span>
                )}
              </p>
              {result.columns && (
                <p className="mt-0.5 text-[11px] text-faint">
                  Read {result.columns.date} as the date, {result.columns.description} as the
                  payee, {result.columns.amount} as the amount.
                </p>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-[11px] text-faint hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </Card>
  )
}

function TransactionRow({ line }: { line: BankTransactionWithMatches }): React.JSX.Element {
  const invalidate = useInvalidate()
  const money = line.amount > 0

  const [chosen, setChosen] = useState<number | null>(null)
  const [category, setCategory] = useState('General')

  const after = (): void => {
    invalidate(['bank', 'invoices', 'expenses', 'finance'])
  }

  const matchInvoice = useMutation({
    mutationFn: (invoiceId: number) =>
      window.solo.invoke('bank:matchInvoice', { id: line.id, invoiceId }),
    onSuccess: after
  })

  const matchExpense = useMutation({
    mutationFn: (expenseId: number) =>
      window.solo.invoke('bank:matchExpense', { id: line.id, expenseId }),
    onSuccess: after
  })

  const asExpense = useMutation({
    mutationFn: () => window.solo.invoke('bank:createExpense', { id: line.id, patch: { category } }),
    onSuccess: after
  })

  const ignore = useMutation({
    mutationFn: () => window.solo.invoke('bank:ignore', { id: line.id }),
    onSuccess: after
  })

  const undo = useMutation({
    mutationFn: () => window.solo.invoke('bank:unmatch', { id: line.id }),
    onSuccess: after
  })

  const best = line.matches[0]
  const target = chosen ?? (line.clear ? (best?.id ?? null) : null)

  return (
    <Card className="flex flex-col gap-2.5 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-ink">{line.description || line.reference}</p>
          <p className="truncate text-[11px] text-faint">
            {formatDate(line.date)}
            {line.reference && line.description ? ` · ${line.reference}` : ''}
            <span className="text-faint"> · {line.source}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span
            className={cn(
              'numeric w-[92px] text-right text-[13px]',
              money ? 'text-success' : 'text-ink'
            )}
          >
            {money ? '+' : '−'}
            {formatMoney(Math.abs(line.amount), { pennies: true })}
          </span>

          {line.status === 'new' ? (
            <button
              type="button"
              aria-label="Not a business transaction"
              title="Not something the business needs to account for"
              onClick={() => ignore.mutate()}
              className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
            >
              <EyeOff size={13} strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Undo"
              title={
                line.status === 'matched'
                  ? 'Clear this match. The invoice stays paid — say so on the invoice itself if it was not.'
                  : 'Put this back on the pile'
              }
              onClick={() => undo.mutate()}
              className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
            >
              <Undo2 size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {line.status === 'new' && (
        <div className="flex flex-col gap-2 border-t border-line pt-2.5">
          {line.matches.length > 0 ? (
            <>
              {!line.clear && line.matches.length > 1 && (
                // Said out loud rather than shown as a shrug: two equally good
                // candidates is information, and picking one would be a coin
                // toss dressed up as a suggestion.
                <p className="text-[11px] text-warning">
                  More than one of these fits. Pick the right one.
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {line.matches.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => setChosen(match.id)}
                    className={cn(
                      'rounded-control border px-2.5 py-1 text-left text-[11.5px] transition-colors',
                      target === match.id
                        ? 'border-accent bg-accent-subtle text-ink'
                        : 'border-line text-muted hover:bg-hover hover:text-ink'
                    )}
                  >
                    {match.reasons.join(' · ')}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={target === null}
                  onClick={() =>
                    target !== null &&
                    (money ? matchInvoice.mutate(target) : matchExpense.mutate(target))
                  }
                >
                  <Check size={13} strokeWidth={1.75} />
                  {money ? 'Mark that invoice paid' : 'That is this expense'}
                </Button>

                {!money && <AsExpense category={category} onCategory={setCategory} onGo={() => asExpense.mutate()} />}
              </div>
            </>
          ) : money ? (
            <p className="text-[11.5px] text-muted">
              Nothing outstanding matches this. Mark the invoice paid yourself, or ignore the line.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-[11.5px] text-muted">Not logged yet.</p>
              <AsExpense category={category} onCategory={setCategory} onGo={() => asExpense.mutate()} />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Logging a debit nobody had recorded, with a category chosen up front. */
function AsExpense({
  category,
  onCategory,
  onGo
}: {
  category: string
  onCategory: (value: string) => void
  onGo: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={category}
        onChange={(value) => onCategory(value ?? 'General')}
        className="w-[150px]"
        options={CATEGORIES.map((name) => ({ value: name, label: name }))}
      />
      <Button variant="secondary" size="sm" onClick={onGo}>
        Log as an expense
      </Button>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Plus, Receipt, TriangleAlert, Trash2 } from 'lucide-react'
import type { ExpenseInput, ExpenseWithContext } from '@shared/types'
import { EXPENSE_CATEGORIES } from '@shared/types'
import type { Period } from '@shared/taxYear'
import { rangeFor, today } from '@shared/taxYear'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Dot, Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { Inspect } from '@/components/detail/Inspect'
import { Toolbar } from '@/components/list/Toolbar'
import { SavedViews } from '@/components/list/SavedViews'
import { useListState } from '@/hooks/useListState'
import { Debtors } from './finance/Debtors'
import { Mileage } from './finance/Mileage'
import { useTagFilter } from '@/hooks/useTagFilter'
import { useEntityActions } from '@/hooks/useEntityActions'
import { cn } from '@/lib/utils'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Tax year' }
]

type Tab = 'overview' | 'expenses' | 'mileage' | 'debtors'

export function Finance(): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('month')
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <Page
      title="Finance"
      description={rangeFor(period).label}
      actions={
        <div className="flex rounded-control border border-line p-0.5">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className="relative rounded-[6px] px-2.5 py-1 text-[12px]"
            >
              {period === option.value && (
                <motion.span
                  layoutId="finance-period"
                  transition={transition.layout}
                  className="absolute inset-0 rounded-[6px] bg-raised"
                />
              )}
              <span
                className={cn(
                  'relative z-10',
                  period === option.value ? 'text-ink' : 'text-muted'
                )}
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex items-center gap-2 border-b border-line">
        {(['overview', 'expenses', 'mileage', 'debtors'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className="relative px-3 py-2 text-[13px] capitalize"
          >
            <span className={tab === name ? 'text-ink' : 'text-muted hover:text-ink'}>{name}</span>
            {tab === name && (
              <motion.span
                layoutId="finance-tab"
                transition={transition.layout}
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview period={period} />}
      {tab === 'expenses' && <Expenses period={period} />}
      {/* Mileage takes no period: it is valued a tax year at a time. */}
      {tab === 'mileage' && <Mileage />}
      {/* Debt is a fact about now, not about the period above. */}
      {tab === 'debtors' && <Debtors />}
    </Page>
  )
}

function Overview({ period }: { period: Period }): React.JSX.Element {
  const { data: summary } = useQuery({
    queryKey: ['finance', 'summary', period],
    queryFn: () => window.solo.invoke('finance:summary', { period })
  })

  const { data: points = [] } = useQuery({
    queryKey: ['finance', 'series', period],
    queryFn: () => window.solo.invoke('finance:series', { period })
  })

  const { data: clients = [] } = useQuery({
    queryKey: ['finance', 'clients', period],
    queryFn: () => window.solo.invoke('finance:topClients', { period })
  })

  const { data: profitability = [] } = useQuery({
    queryKey: ['finance', 'profitability'],
    queryFn: () => window.solo.invoke('finance:profitability')
  })

  if (!summary) return <></>

  const chartData = points.map((point) => ({
    ...point,
    income: point.income / 100,
    expenses: point.expenses / 100
  }))

  return (
    <>
      <motion.div
        variants={listVariants}
        initial="initial"
        animate="animate"
        className="grid grid-cols-4 gap-3"
      >
        <Stat label="Income" value={summary.income} tone="text-ink" />
        <Stat label="Spending" value={summary.expenses} tone="text-ink" />
        <Stat
          label="Profit"
          value={summary.profit}
          tone={summary.profit >= 0 ? 'text-success' : 'text-danger'}
        />
        <Stat label="Set aside for tax" value={summary.setAside} tone="text-warning" />
      </motion.div>

      <div className="mt-3 grid grid-cols-5 gap-3">
        <Stat label="Awaiting payment" value={summary.outstanding} tone="text-ink" small />
        <Stat label="Overdue" value={summary.overdue} tone="text-danger" small />
        <Stat label="Unbilled time" value={summary.unbilledValue} tone="text-warning" small />
        <Stat label="Mileage" value={summary.mileage} tone="text-ink" small />
        <Card className="p-3.5">
          <p className="mb-1.5 text-[11px] text-muted">Hours tracked</p>
          <p className="numeric text-[17px] font-medium text-ink">{summary.hoursTracked}h</p>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader title="Income and spending" />
        {chartData.length === 0 ? (
          <div className="grid h-[240px] place-items-center">
            <p className="text-[12px] text-faint">
              Nothing recorded in this period yet. Mark an invoice paid or log an expense.
            </p>
          </div>
        ) : (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="income" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#30A46C" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#30A46C" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E5484D" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#E5484D" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#26262A" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: '#5a5a63', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  // Short labels: the range is already in the page header.
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis
                  tick={{ fill: '#5a5a63', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `£${value}`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1C1C1F',
                    border: '1px solid #35353B',
                    borderRadius: 10,
                    fontSize: 12
                  }}
                  labelStyle={{ color: '#8a8a93' }}
                  formatter={(value, name) => [
                    `£${Number(value).toLocaleString('en-GB')}`,
                    name === 'income' ? 'Income' : 'Spending'
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  stroke="#30A46C"
                  strokeWidth={1.5}
                  fill="url(#income)"
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  stroke="#E5484D"
                  strokeWidth={1.5}
                  fill="url(#spend)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <TaxCard />

      <ClientRates />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Top clients" />
          {clients.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-faint">No invoiced clients yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {clients.map((client) => (
                <div
                  key={client.clientId}
                  className="flex items-center justify-between rounded-control bg-raised px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-[12.5px] text-ink">
                    <Dot colour={client.colour} />
                    {client.clientName}
                  </span>
                  <span className="numeric text-[12.5px] text-muted">
                    {formatMoney(client.paid)}
                    {client.invoiced > client.paid && (
                      <span className="text-faint"> of {formatMoney(client.invoiced)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Project profitability" />
          {profitability.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-faint">No active projects.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {profitability.slice(0, 6).map((project) => {
                // Invoiced less than the time was worth means the job is paying
                // below your rate — the number worth surfacing.
                const short = project.trackedValue > 0 && project.invoiced < project.trackedValue

                return (
                  <div
                    key={project.projectId}
                    className="flex items-center justify-between rounded-control bg-raised px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink">
                      <Dot colour={project.colour} />
                      <span className="truncate">{project.projectName}</span>
                    </span>
                    <span className="numeric shrink-0 text-[12px]">
                      <span className={short ? 'text-warning' : 'text-muted'}>
                        {formatMoney(project.invoiced)}
                      </span>
                      <span className="text-faint"> / {formatMoney(project.trackedValue)}</span>
                    </span>
                  </div>
                )
              })}
              <p className="mt-1 text-[10.5px] text-faint">Invoiced against what tracked time is worth.</p>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  tone,
  small
}: {
  label: string
  value: number
  tone: string
  small?: boolean
}): React.JSX.Element {
  return (
    <motion.div variants={listItemVariants}>
      <Card className="p-3.5">
        <p className="mb-1.5 text-[11px] text-muted">{label}</p>
        <AnimatedNumber
          value={value}
          format={(pence) => formatMoney(Math.round(pence))}
          className={cn('numeric font-medium', small ? 'text-[17px]' : 'text-[22px]', tone)}
        />
      </Card>
    </motion.div>
  )
}

function Expenses({ period }: { period: Period }): React.JSX.Element {
  const range = rangeFor(period)
  const [adding, setAdding] = useState(false)

  const list = useListState()
  const tagFilter = useTagFilter('expense', list)
  const actions = useEntityActions()

  const { data: found = [] } = useQuery({
    queryKey: ['expenses', range.from, range.to],
    queryFn: () => window.solo.invoke('expenses:list', { from: range.from, to: range.to })
  })

  const chosen = list.values('category')
  const search = (list.one('q') ?? '').trim().toLowerCase()

  const expenses = found.filter((expense) => {
    if (!tagFilter.keep(expense.id)) return false
    if (chosen.length > 0 && !chosen.includes(expense.category)) return false
    if (!search) return true
    return `${expense.vendor} ${expense.description}`.toLowerCase().includes(search)
  })

  // Built from what is actually here rather than from a fixed list: expense
  // categories are free text, so the only honest set of chips is the one the
  // period's own rows use.
  const categories = [...new Set(found.map((expense) => expense.category))].sort()

  const remove = useMutation({
    mutationFn: (expense: { id: number; label: string }) =>
      actions.remove({ type: 'expense', id: expense.id }, expense.label)
  })

  const total = expenses.reduce((sum, expense) => sum + expense.total, 0)

  return (
    <>
      <Toolbar
        search={{ placeholder: 'Search vendor or description' }}
        state={list}
        facets={[
          {
            key: 'category',
            options: categories.map((name) => ({
              value: name,
              label: name,
              count: found.filter((expense) => expense.category === name).length
            }))
          },
          tagFilter.facet
        ]}
      >
        <p className="text-[12px] text-muted">
          {expenses.length} expense{expenses.length === 1 ? '' : 's'} ·{' '}
          <span className="numeric text-ink">{formatMoney(total)}</span>
        </p>
        <SavedViews page="expenses" state={list} />
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.75} />
          Add expense
        </Button>
      </Toolbar>

      <Swap
        empty={expenses.length === 0}
        fallback={
          <Empty
            icon={Receipt}
            title="No expenses in this period"
            body="Log what the business spends, with a receipt if you have one. Receipts are filed by year and month in your workspace."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus size={14} strokeWidth={1.75} />
                Add an expense
              </Button>
            }
          />
        }
      >
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2"
        >
          {expenses.map((expense) => (
            <motion.div key={expense.id} variants={listItemVariants}>
              <Card className="group flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">
                    {expense.vendor || expense.description || 'Expense'}
                  </p>
                  <p className="truncate text-[11px] text-faint">
                    {formatDate(expense.date)} · {expense.category}
                    {expense.projectName ? ` · ${expense.projectName}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {expense.receiptFile && (
                    <button
                      type="button"
                      onClick={() =>
                        void window.solo.invoke('files:open', { path: expense.receiptFile! })
                      }
                      className="text-[11px] text-faint hover:text-ink"
                    >
                      Receipt
                    </button>
                  )}
                  {expense.rebillable && expense.invoiceLineId === null && (
                    <span className="text-[10.5px] text-warning">Rebillable</span>
                  )}
                  <span className="numeric w-[84px] text-right text-[13px] text-ink">
                    {formatMoney(expense.total, { pennies: true })}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete expense"
                    onClick={() =>
                      remove.mutate({
                        id: expense.id,
                        label: expense.vendor || expense.description || 'expense'
                      })
                    }
                    className="text-faint transition-colors hover:text-danger"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                  <Inspect
                    subject={{ type: 'expense', id: expense.id }}
                    siblings={expenses.map((row) => ({ type: 'expense' as const, id: row.id }))}
                    label={expense.vendor || expense.description || 'expense'}
                  />
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Swap>

      <ExpenseModal open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function ExpenseModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<ExpenseInput>({
    date: today(),
    vendor: '',
    category: 'General',
    net: 0,
    vat: 0,
    rebillable: false
  })
  const [receipt, setReceipt] = useState<string | null>(null)
  const [read, setRead] = useState<{ filled: string[]; error: string | null } | null>(null)

  /**
   * Attaching a receipt reads it, and reading it fills the form.
   *
   * Windows' own OCR, so it happens on the machine and nothing is sent
   * anywhere — the only kind of receipt reading an app that promises
   * local-first can honestly offer.
   *
   * It fills *empty* fields only, and says which. OCR reads £11.90 as £1190
   * often enough that overwriting something somebody typed would eventually
   * put a wrong figure in a tax return, and a wrong figure nobody was asked
   * about is far worse than an empty box.
   */
  const attach = async (path: string): Promise<void> => {
    setReceipt(path)
    setRead(null)

    const result = await window.solo.invoke('expenses:readReceipt', { path })
    if (result.error) {
      setRead({ filled: [], error: result.error })
      return
    }

    const filled: string[] = []
    setDraft((current) => {
      const next = { ...current }
      if (result.reading.vendor && !current.vendor) {
        next.vendor = result.reading.vendor
        filled.push('supplier')
      }
      if (result.reading.date && current.date === today()) {
        next.date = result.reading.date
        filled.push('date')
      }
      if (result.reading.total !== null && !current.net) {
        // The receipt's total is gross. The form holds net and VAT
        // separately, so the VAT comes off rather than being added on top —
        // getting this backwards inflates every expense by twenty per cent.
        const vat = result.reading.vat ?? 0
        next.net = result.reading.total - vat
        next.vat = vat
        filled.push(vat > 0 ? 'amount and VAT' : 'amount')
      }
      return next
    })

    setRead({ filled, error: null })
  }

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const create = useMutation({
    mutationFn: () =>
      window.solo.invoke('expenses:create', { ...draft, receiptSourcePath: receipt }),
    onSuccess: () => {
      invalidate(['expenses', 'finance'])
      onClose()
      setDraft({ date: today(), vendor: '', category: 'General', net: 0, vat: 0, rebillable: false })
      setReceipt(null)
      setRead(null)
    }
  })

  const set = <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]): void =>
    setDraft({ ...draft, [key]: value })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add expense"
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            Add expense
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              value={draft.date ?? today()}
              onChange={(event) => set('date', event.target.value)}
            />
          </Field>
          <Field label="Vendor">
            <TextInput
              value={draft.vendor ?? ''}
              onChange={(event) => set('vendor', event.target.value)}
              placeholder="Adobe"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Net amount">
            <MoneyInput pence={draft.net ?? 0} onChangePence={(pence) => set('net', pence)} />
          </Field>
          <Field label="VAT" hint="Leave at zero if there is none.">
            <MoneyInput pence={draft.vat ?? 0} onChangePence={(pence) => set('vat', pence)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select
              value={draft.category ?? 'General'}
              onChange={(value) => set('category', value ?? 'General')}
              options={EXPENSE_CATEGORIES.map((name) => ({ value: name, label: name }))}
            />
          </Field>
          <Field label="Project" hint="For rebillable costs.">
            <Select
              value={draft.projectId ?? null}
              onChange={(value) => set('projectId', value)}
              placeholder="None"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2.5 rounded-control bg-raised px-3 py-2.5">
          <input
            type="checkbox"
            checked={draft.rebillable ?? false}
            onChange={(event) => set('rebillable', event.target.checked)}
            className="accent-accent"
          />
          <span className="text-[13px] text-ink">Rebill this to the client</span>
        </label>

        {read && (
          <p
            className={
              read.error
                ? 'text-[11.5px] text-muted'
                : 'text-[11.5px] text-success'
            }
          >
            {read.error
              ? read.error
              : read.filled.length === 0
                ? 'Read it, but everything was already filled in. Check it against the image.'
                : `Read the ${read.filled.join(', ')} off the receipt \u2014 worth checking.`}
          </p>
        )}

        <Field label="Receipt">
          <div className="flex gap-2">
            <div className="flex h-9 min-w-0 flex-1 items-center rounded-control border border-line bg-raised px-3">
              <span className="truncate text-[12px] text-muted">
                {receipt ?? 'No receipt attached'}
              </span>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void window.solo
                  .invoke('files:pick', { multiple: false })
                  .then(([path]) => {
                    if (path) void attach(path)
                  })
              }
            >
              Choose
            </Button>
          </div>
        </Field>

        <p className="text-[11px] text-faint">
          Total {formatMoney((draft.net ?? 0) + (draft.vat ?? 0), { pennies: true })}
        </p>
      </div>
    </Modal>
  )
}

export type { ExpenseWithContext }
/**
 * What the tax bill is going to be, and whether the set-aside will cover it.
 *
 * The app used to say "set aside 30%", which is what people are told in the
 * pub. It is wrong in both directions and expensively so: far too high on a
 * thirty-thousand-pound year, and badly too low the moment profit crosses into
 * the higher band. This works the actual bands and says which way it is out.
 *
 * The shortfall is the whole feature. Everything else is context for it.
 */
function TaxCard(): React.JSX.Element | null {
  const { data: tax } = useQuery({
    queryKey: ['finance', 'tax'],
    queryFn: () => window.solo.invoke('finance:tax')
  })

  // Nothing useful to say before there is a profit — and a card announcing a
  // £0 tax bill on a workspace opened this morning is noise.
  if (!tax || tax.profit <= 0) return null

  return (
    <div className="mt-3">
      <Card>
        <CardHeader
          title={`Tax set-aside · ${tax.taxYearLabel}`}
          action={
            <span className="type-meta text-faint">{tax.rulesLabel} rates</span>
          }
        />

        <div className="grid grid-cols-4 gap-4">
          <Figure label="Profit so far" value={formatMoney(tax.profit)} />
          <Figure label="Income tax" value={formatMoney(tax.incomeTax)} />
          <Figure label="Class 4 NI" value={formatMoney(tax.nationalInsurance)} />
          <Figure label="Estimated bill" value={formatMoney(tax.total)} strong />
        </div>

        <div className="mt-4 border-t border-line pt-3.5">
          {tax.enough ? (
            <p className="text-[12.5px] text-success">
              Setting aside {tax.currentPercent}% covers it, with{' '}
              <span className="numeric">{formatMoney(tax.held - tax.total)}</span> to spare.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-[12.5px] text-warning">
              <TriangleAlert size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
              <span>
                Setting aside {tax.currentPercent}% leaves you{' '}
                <span className="numeric font-semibold">{formatMoney(tax.shortfall)}</span> short.
                Raise it to <strong>{tax.recommendedPercent}%</strong> in Settings.
              </span>
            </p>
          )}

          <p className="type-meta mt-2 leading-relaxed text-faint">
            The next pound of profit is taxed at {Math.round(tax.marginalPercent)}%. An estimate
            of income tax and Class 4 National Insurance on trading profit only — no employment
            income, dividends, student loan or payments on account. For deciding what to move
            into savings, not for filing.
          </p>
        </div>
      </Card>
    </div>
  )
}

function Figure({
  label,
  value,
  strong
}: {
  label: string
  value: string
  strong?: boolean
}): React.JSX.Element {
  return (
    <div>
      <p className="type-label mb-1 text-faint">{label}</p>
      <p className={strong ? 'numeric text-[19px] font-semibold text-ink' : 'numeric text-[19px] text-muted'}>
        {value}
      </p>
    </div>
  )
}

/**
 * What each client actually pays per hour, against what the user thinks they
 * charge.
 *
 * The comparison is the point. "£38 an hour" on its own is a number; "£38 an
 * hour against your £60 rate" is a decision about whether to keep working for
 * them. Freelancers consistently underprice and have no visibility of it,
 * because nothing else in the app — or in most apps — joins the invoice to the
 * hours.
 *
 * Deliberately uncomfortable, and deliberately quiet about it: the low ones
 * are marked, not scolded.
 */
function ClientRates(): React.JSX.Element | null {
  const { data: rates = [] } = useQuery({
    queryKey: ['finance', 'clientRates'],
    queryFn: () => window.solo.invoke('finance:clientRates')
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.solo.invoke('settings:get')
  })

  // Only clients with hours against them can have a rate, and a table of
  // dashes teaches nobody anything.
  const measured = rates.filter((client) => client.effectiveRate !== null)
  if (measured.length === 0) return null

  const target = settings?.defaultHourlyRate ?? 0

  return (
    <div className="mt-3">
      <Card>
        <CardHeader
          title="What clients actually pay, per hour"
          action={
            target > 0 && (
              <span className="type-meta text-faint">
                your rate {formatMoney(target)}/h
              </span>
            )
          }
        />

        <div className="flex flex-col gap-1.5">
          {measured.map((client) => {
            const rate = client.effectiveRate!
            const under = target > 0 && rate < target
            // A tenth under is noise on a fixed-price job; a third under is a
            // pattern, and the difference is worth drawing.
            const badly = target > 0 && rate < target * 0.7

            return (
              <div
                key={client.clientId}
                className="flex items-center gap-3 rounded-control bg-raised px-3 py-2"
              >
                <Dot colour={client.colour} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {client.clientName}
                </span>
                <span className="numeric shrink-0 text-[11.5px] text-faint">
                  {client.hours.toFixed(1)}h
                </span>
                <span className="numeric w-[90px] shrink-0 text-right text-[11.5px] text-faint">
                  {formatMoney(client.invoiced)}
                </span>
                <span
                  className={cn(
                    'numeric w-[86px] shrink-0 text-right text-[13.5px] font-medium',
                    badly ? 'text-danger' : under ? 'text-warning' : 'text-success'
                  )}
                >
                  {formatMoney(rate)}/h
                </span>
              </div>
            )
          })}
        </div>

        <p className="type-meta mt-3 leading-relaxed text-faint">
          Everything invoiced to a client, divided by every hour tracked against their projects —
          billable or not, because an hour spent on a client is an hour spent on that client.
        </p>
      </Card>
    </div>
  )
}

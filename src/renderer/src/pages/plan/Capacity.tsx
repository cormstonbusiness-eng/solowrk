import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator, TriangleAlert } from 'lucide-react'
import type { CapacityInput } from '@shared/types'
import { ceiling, money, verdict } from '@shared/capacity'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { cn } from '@/lib/utils'

/**
 * The capacity calculator.
 *
 * Hours × utilisation × rate = the most this business can earn in a year.
 * Confronting on purpose: most freelancers have never multiplied it out, and
 * find that the income they are planning for is arithmetically impossible at
 * the rate they charge.
 *
 * It opens on the user's **own tracked history** where there is enough of it,
 * and says so. Watching your real utilisation appear as 48% when you had been
 * assuming 80% is the entire value of the exercise, and a calculator that
 * opened on 80% would never produce it.
 */

export function Capacity(): React.JSX.Element {
  const { data: defaults } = useQuery({
    queryKey: ['capacity', 'defaults'],
    queryFn: () => window.solo.invoke('capacity:defaults')
  })

  const [input, setInput] = useState<CapacityInput | null>(null)
  /**
   * Null until the defaults land, so the plan's stated take-home can seed it.
   *
   * It used to open on a hard-coded £30,000 every visit, which meant somebody
   * whose plan said £36,000 was told a different answer here than three
   * inches further down the page.
   */
  const [target, setTarget] = useState<number | null>(null)

  // Seeded once. Re-seeding on every refetch would pull the sliders back from
  // under somebody who is in the middle of trying a different rate.
  useEffect(() => {
    if (!defaults || input !== null) return
    // £30,000 only where nobody has said. A stated target always wins.
    setTarget((current) => current ?? (defaults.takeHomeTarget > 0 ? defaults.takeHomeTarget : 3_000_000))
    setInput({
      weeksPerYear: defaults.weeksPerYear,
      hoursPerWeek: defaults.hoursPerWeek,
      utilisationBasisPoints: defaults.utilisationBasisPoints,
      rate: defaults.rate,
      annualCosts: defaults.annualCosts,
      taxBasisPoints: defaults.taxBasisPoints
    })
  }, [defaults, input])

  if (!defaults || !input || target === null) return <></>

  const result = ceiling(input)
  const answer = verdict(target, input)

  const set = <K extends keyof CapacityInput>(key: K, value: CapacityInput[K]): void =>
    setInput({ ...input, [key]: value })

  return (
    <Card>
      <CardHeader
        title="What this business can earn"
        action={
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <Calculator size={12} strokeWidth={1.75} />
            Capacity
          </span>
        }
      />

      <p className="mb-3.5 text-[12px] leading-relaxed text-muted">
        {defaults.fromHistory ? (
          <>
            Started from your own last twelve months:{' '}
            <strong className="text-ink">{defaults.trackedBillableHours} billable hours</strong> out
            of {defaults.trackedHours} tracked, which is{' '}
            <strong className="text-ink">
              {(defaults.utilisationBasisPoints / 100).toFixed(0)}%
            </strong>{' '}
            of the hours your calendar says you had.
            {defaults.actualRate > 0 && (
              <>
                {' '}
                Billed work has earned {money(defaults.actualRate)} an hour on average.
              </>
            )}
          </>
        ) : (
          <>
            There is not enough tracked time yet to work out your real utilisation, so this starts
            at 55% — realistic for a solo freelancer, and almost always lower than people expect.
            Track time for a few months and this page will use your own figure instead.
          </>
        )}
      </p>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Working weeks a year" hint="After holiday and bank holidays.">
          <TextInput
            type="number"
            value={String(input.weeksPerYear)}
            onChange={(event) => set('weeksPerYear', Number(event.target.value) || 0)}
          />
        </Field>
        <Field label="Hours in a working week">
          <TextInput
            type="number"
            value={String(input.hoursPerWeek)}
            onChange={(event) => set('hoursPerWeek', Number(event.target.value) || 0)}
          />
        </Field>
        <Field label="Billable share, %" hint="Quoting and admin are not billable.">
          <TextInput
            type="number"
            value={String(Math.round(input.utilisationBasisPoints / 100))}
            onChange={(event) =>
              set('utilisationBasisPoints', (Number(event.target.value) || 0) * 100)
            }
          />
        </Field>

        <Field label="Your hourly rate">
          <MoneyInput pence={input.rate} onChangePence={(pence) => set('rate', pence)} />
        </Field>
        <Field
          label="Costs a year"
          hint={
            defaults.costsFromPlan
              ? 'From your business plan — nothing recorded yet.'
              : 'Software, insurance, hardware, accountant.'
          }
        >
          <MoneyInput
            pence={input.annualCosts}
            onChangePence={(pence) => set('annualCosts', pence)}
          />
        </Field>
        <Field label="Tax set aside, %">
          <TextInput
            type="number"
            value={String(Math.round(input.taxBasisPoints / 100))}
            onChange={(event) => set('taxBasisPoints', (Number(event.target.value) || 0) * 100)}
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 border-t border-line pt-3.5">
        <Figure label="Billable hours" value={`${result.billableHours}`} />
        <Figure label="Revenue" value={money(result.gross)} />
        <Figure label="Profit" value={money(result.profit)} tone={result.profit < 0 ? 'danger' : undefined} />
        <Figure
          label="Take home"
          value={money(result.takeHome)}
          tone={result.takeHome < 0 ? 'danger' : 'good'}
        />
      </div>

      <p className="mt-2 text-[11.5px] text-faint">
        That is {money(result.perAvailableHour)} for every hour of your working week, billable or
        not — the number worth comparing against a salary.
      </p>

      <div className="mt-4 border-t border-line pt-3.5">
        <div className="flex items-end gap-3">
          <Field label="What do you want to take home?" className="w-[200px]">
            <MoneyInput pence={target} onChangePence={setTarget} />
          </Field>
        </div>

        <p
          className={cn(
            'mt-2.5 flex items-start gap-1.5 rounded-control px-2.5 py-2 text-[12px] leading-relaxed',
            answer.reachable ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
          )}
        >
          {!answer.reachable && (
            <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          )}
          <span>{answer.summary}</span>
        </p>
      </div>
    </Card>
  )
}

function Figure({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'good' | 'danger'
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted">{label}</p>
      <p
        className={cn(
          'numeric text-[17px] font-medium',
          tone === 'danger' ? 'text-danger' : tone === 'good' ? 'text-success' : 'text-ink'
        )}
      >
        {value}
      </p>
    </div>
  )
}

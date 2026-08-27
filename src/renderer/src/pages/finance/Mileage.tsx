import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Car, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { MileageInput, MileageRateRow, Vehicle } from '@shared/types'
import {
  TENTHS_PER_MILE,
  VEHICLES,
  VEHICLE_LABELS,
  milesLabel,
  rateLabel,
  toTenths
} from '@shared/mileage'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The mileage log.
 *
 * It is shown a **tax year** at a time rather than following the period
 * switcher above it, and that is not a shortcut. HMRC's 45p rate covers the
 * first 10,000 business miles *in a tax year*; what a journey is worth depends
 * on the miles before it. A month's driving has no value of its own, so
 * showing one would be showing a number that is not a number.
 */

const VEHICLE_OPTIONS = VEHICLES.map((vehicle) => ({
  value: vehicle,
  label: VEHICLE_LABELS[vehicle]
}))

/** The tax year a `yyyy-mm-dd` sits in, stepped by whole years. */
function shiftYear(date: string, years: number): string {
  const [year, month, day] = date.split('-')
  return `${Number(year) + years}-${month}-${day}`
}

export function Mileage(): React.JSX.Element {
  // Anchored on a date rather than a label, because the tax year the date
  // belongs to is the main process's decision — its boundary is configurable.
  const [anchor, setAnchor] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [ratesOpen, setRatesOpen] = useState(false)

  const invalidate = useInvalidate()

  const { data: year } = useQuery({
    queryKey: ['mileage', anchor],
    queryFn: () => window.solo.invoke('mileage:year', anchor ? { date: anchor } : undefined)
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('mileage:delete', { id }),
    onSuccess: () => invalidate(['mileage', 'finance'])
  })

  if (!year) return <></>

  const carDriven = year.drivenTenths.car ?? 0
  const total = VEHICLES.reduce((sum, vehicle) => sum + (year.drivenTenths[vehicle] ?? 0), 0)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous tax year"
            onClick={() => setAnchor(shiftYear(year.taxYear.start, -1))}
            className="rounded-control p-1.5 text-muted hover:bg-hover hover:text-ink"
          >
            <ChevronLeft size={15} strokeWidth={1.75} />
          </button>
          <div className="min-w-[128px] text-center">
            <p className="text-[13px] text-ink">Tax year {year.taxYear.label}</p>
            <p className="text-[11px] text-faint">
              {formatDate(year.taxYear.start)} – {formatDate(year.taxYear.end)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Next tax year"
            onClick={() => setAnchor(shiftYear(year.taxYear.start, 1))}
            className="rounded-control p-1.5 text-muted hover:bg-hover hover:text-ink"
          >
            <ChevronRight size={15} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <p className="text-[12px] text-muted">
            <span className="numeric text-ink">{milesLabel(total)}</span> miles ·{' '}
            <span className="numeric text-ink">{formatMoney(year.total)}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setRatesOpen(true)}>
            <SlidersHorizontal size={14} strokeWidth={1.75} />
            Rates
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={1.75} />
            Add journey
          </Button>
        </div>
      </div>

      {year.untilThresholdTenths !== null && carDriven > 0 && (
        <Threshold driven={carDriven} remaining={year.untilThresholdTenths} />
      )}

      <Swap
        empty={year.entries.length === 0}
        fallback={
          <Empty
            icon={Car}
            title={`No journeys logged in ${year.taxYear.label}`}
            body="Log business driving and it is valued at HMRC's approved rates — 45p a mile for the first 10,000 miles of the tax year, then 25p."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus size={14} strokeWidth={1.75} />
                Add a journey
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
          {year.entries.map((entry) => (
            <motion.div key={entry.id} variants={listItemVariants}>
              <Card className="group flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">
                    {entry.fromPlace && entry.toPlace
                      ? `${entry.fromPlace} → ${entry.toPlace}`
                      : entry.purpose || 'Journey'}
                  </p>
                  <p className="truncate text-[11px] text-faint">
                    {formatDate(entry.date)}
                    {entry.vehicle !== 'car' ? ` · ${VEHICLE_LABELS[entry.vehicle]}` : ''}
                    {entry.purpose && entry.fromPlace ? ` · ${entry.purpose}` : ''}
                    {entry.projectName ? ` · ${entry.projectName}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {entry.rebillable && entry.invoiceLineId === null && (
                    <span className="text-[10.5px] text-warning">Rebillable</span>
                  )}
                  <span
                    className={cn(
                      'numeric w-[46px] text-right text-[11px]',
                      // A mixed rate is worth reading rather than skimming: it
                      // is the row where the allowance ran out.
                      entry.rate === null ? 'text-warning' : 'text-faint'
                    )}
                    title={
                      entry.rate === null
                        ? `${milesLabel(entry.atFirstRate)} miles at the higher rate, ${milesLabel(entry.atSecondRate)} at the lower`
                        : undefined
                    }
                  >
                    {rateLabel(entry.rate)}
                  </span>
                  <span className="numeric w-[62px] text-right text-[12px] text-muted">
                    {milesLabel(entry.tenths)} mi
                  </span>
                  <span className="numeric w-[74px] text-right text-[13px] text-ink">
                    {formatMoney(entry.amount, { pennies: true })}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete journey"
                    onClick={() => remove.mutate(entry.id)}
                    className="text-faint transition-colors hover:text-danger"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Swap>

      <JourneyModal open={adding} onClose={() => setAdding(false)} />
      <RatesModal open={ratesOpen} onClose={() => setRatesOpen(false)} />
    </>
  )
}

/**
 * How much of the higher rate is left.
 *
 * Shown because the moment it runs out costs 20p a mile and arrives without
 * warning otherwise — somebody planning a long trip in February is entitled to
 * know which side of the line it falls on.
 */
function Threshold({ driven, remaining }: { driven: number; remaining: number }): React.JSX.Element {
  const threshold = driven + remaining
  const used = Math.min(1, driven / threshold)

  return (
    <Card className="mb-3 flex items-center gap-4 py-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${(used * 100).toFixed(1)}%` }}
        />
      </div>
      <p className="shrink-0 text-[11.5px] text-muted">
        <span className="numeric text-ink">{milesLabel(remaining)}</span> miles left at the higher
        rate
      </p>
    </Card>
  )
}

function JourneyModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()

  const blank: MileageInput = {
    date: new Date().toISOString().slice(0, 10),
    fromPlace: '',
    toPlace: '',
    purpose: '',
    vehicle: 'car',
    rebillable: false
  }

  const [draft, setDraft] = useState<MileageInput>(blank)
  // Kept as text, not tenths, so a half-typed "12." is not read as 12 and
  // rounded behind somebody mid-keystroke.
  const [miles, setMiles] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const tenths = toTenths(miles)

  const create = useMutation({
    mutationFn: () => window.solo.invoke('mileage:create', { ...draft, tenths: tenths ?? 0 }),
    onSuccess: () => {
      invalidate(['mileage', 'finance'])
      onClose()
      setDraft(blank)
      setMiles('')
    }
  })

  const set = <K extends keyof MileageInput>(key: K, value: MileageInput[K]): void =>
    setDraft({ ...draft, [key]: value })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add journey"
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            // A journey of no distance is worth nothing and belongs in no log.
            disabled={create.isPending || tenths === null || tenths === 0}
          >
            Add journey
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              value={draft.date ?? ''}
              onChange={(event) => set('date', event.target.value)}
            />
          </Field>
          <Field label="Vehicle">
            <Select
              value={draft.vehicle ?? 'car'}
              onChange={(value) => set('vehicle', (value ?? 'car') as Vehicle)}
              options={VEHICLE_OPTIONS}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <TextInput
              value={draft.fromPlace ?? ''}
              onChange={(event) => set('fromPlace', event.target.value)}
              placeholder="Office"
            />
          </Field>
          <Field label="To">
            <TextInput
              value={draft.toPlace ?? ''}
              onChange={(event) => set('toPlace', event.target.value)}
              placeholder="Client site"
            />
          </Field>
        </div>

        <Field label="Miles" hint="One way or the whole trip — whatever you drove.">
          <div className="flex gap-2">
            <TextInput
              value={miles}
              onChange={(event) => setMiles(event.target.value)}
              placeholder="12.7"
              inputMode="decimal"
            />
            <Button
              variant="outline"
              // Most business journeys come back again, and doubling in your
              // head is where the wrong number gets typed.
              disabled={tenths === null || tenths === 0}
              onClick={() => tenths !== null && setMiles(milesLabel(tenths * 2))}
            >
              There and back
            </Button>
          </div>
        </Field>

        <Field label="Purpose" hint="What the trip was for. HMRC asks.">
          <TextInput
            value={draft.purpose ?? ''}
            onChange={(event) => set('purpose', event.target.value)}
            placeholder="Site survey"
          />
        </Field>

        <Field label="Project">
          <Select
            value={draft.projectId ?? null}
            onChange={(value) => set('projectId', value)}
            placeholder="None"
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
        </Field>

        <label className="flex items-center gap-2.5 rounded-control bg-raised px-3 py-2.5">
          <input
            type="checkbox"
            checked={draft.rebillable ?? false}
            onChange={(event) => set('rebillable', event.target.checked)}
            className="accent-accent"
          />
          <span className="text-[13px] text-ink">Rebill this to the client</span>
        </label>

        {miles !== '' && tenths === null && (
          <p className="text-[11.5px] text-danger">That is not a distance.</p>
        )}
      </div>
    </Modal>
  )
}

/**
 * The rates themselves.
 *
 * Editable because HMRC moves them, and a rate baked into a release is a rate
 * that is wrong for however long the next release takes.
 */
function RatesModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()

  const { data: rates = [] } = useQuery({
    queryKey: ['mileage', 'rates'],
    queryFn: () => window.solo.invoke('mileage:rates')
  })

  const save = useMutation({
    mutationFn: (rate: MileageRateRow) => window.solo.invoke('mileage:setRate', rate),
    onSuccess: () => invalidate(['mileage', 'finance'])
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mileage rates"
      width={520}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-muted">
          HMRC's approved rates. Changing one re-values every journey in the log, including past
          years — so change it when HMRC does, not to correct a single trip.
        </p>

        {rates.map((rate) => (
          <div key={rate.vehicle} className="flex flex-col gap-2">
            <p className="text-[12.5px] text-ink">{VEHICLE_LABELS[rate.vehicle]}</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pence per mile">
                <TextInput
                  type="number"
                  value={String(rate.firstRate)}
                  onChange={(event) =>
                    save.mutate({ ...rate, firstRate: Number(event.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="After the threshold">
                <TextInput
                  type="number"
                  value={String(rate.secondRate)}
                  onChange={(event) =>
                    save.mutate({ ...rate, secondRate: Number(event.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="Threshold, miles" hint={rate.thresholdTenths === 0 ? 'Flat rate.' : ''}>
                <TextInput
                  type="number"
                  value={String(rate.thresholdTenths / TENTHS_PER_MILE)}
                  onChange={(event) =>
                    save.mutate({
                      ...rate,
                      thresholdTenths: (Number(event.target.value) || 0) * TENTHS_PER_MILE
                    })
                  }
                />
              </Field>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

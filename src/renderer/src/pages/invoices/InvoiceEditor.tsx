import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Clock, Plus, Trash2 } from 'lucide-react'
import type { InvoiceInput, InvoiceWithContext, LineDraft } from '@shared/types'
import { RECURRENCES } from '@shared/types'
import { lineAmount, secondsToHours, timeValue, totalsFor } from '@shared/money'
import { today } from '@shared/taxYear'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { keys, useInvalidate } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { transition } from '@/lib/motion'

const BLANK_LINE: LineDraft = { description: '', quantity: 1, unitPrice: 0, kind: 'fixed' }

/**
 * Builds and edits an invoice.
 *
 * Totals are computed live in the renderer using the same `totalsFor` the main
 * process stores with, so what you see while editing is what gets saved — no
 * chance of the preview and the record disagreeing.
 */
export function InvoiceEditor({
  invoice,
  open,
  onClose
}: {
  invoice: InvoiceWithContext | null
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<InvoiceInput>({ clientId: null, lines: [{ ...BLANK_LINE }] })
  const [pullingTime, setPullingTime] = useState(false)

  const { data: settings } = useQuery({
    queryKey: keys.settings,
    queryFn: () => window.solo.invoke('settings:get')
  })

  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  useEffect(() => {
    if (invoice) {
      setDraft({
        clientId: invoice.clientId,
        projectId: invoice.projectId,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes,
        status: invoice.status,
        recurrence: invoice.recurrence,
        lines: invoice.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          kind: line.kind
        }))
      })
    } else {
      setDraft({
        clientId: null,
        issueDate: today(),
        lines: [{ ...BLANK_LINE }],
        recurrence: 'none'
      })
    }
  }, [invoice, open])

  const save = useMutation({
    mutationFn: () =>
      invoice
        ? window.solo.invoke('invoices:update', { id: invoice.id, patch: draft })
        : window.solo.invoke('invoices:create', draft),
    onSuccess: () => {
      invalidate(['invoices', 'time', 'finance'])
      onClose()
    }
  })

  const setLine = (index: number, patch: Partial<LineDraft>): void =>
    setDraft({
      ...draft,
      lines: draft.lines.map((line, i) => (i === index ? { ...line, ...patch } : line))
    })

  const totals = totalsFor(
    draft.lines.map((line) => lineAmount(line.quantity, line.unitPrice)),
    {
      vatRegistered: settings?.vatRegistered ?? false,
      vatRate: settings?.vatRate ?? 2000
    }
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={invoice ? `Invoice ${invoice.number}` : 'New invoice'}
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || draft.lines.length === 0}
          >
            {invoice ? 'Save changes' : 'Create invoice'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select
              value={draft.clientId}
              onChange={(value) => setDraft({ ...draft, clientId: value })}
              placeholder="No client"
              options={clients.map((client) => ({ value: client.id, label: client.name }))}
            />
          </Field>
          <Field label="Project" hint="Optional — links the invoice to the work.">
            <Select
              value={draft.projectId ?? null}
              onChange={(value) => setDraft({ ...draft, projectId: value })}
              placeholder="No project"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Issue date">
            <TextInput
              type="date"
              value={draft.issueDate ?? today()}
              onChange={(event) => setDraft({ ...draft, issueDate: event.target.value })}
            />
          </Field>
          <Field label="Due date" hint={invoice ? undefined : 'From your payment terms.'}>
            <TextInput
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
            />
          </Field>
          <Field label="Repeats" hint="Retainers generate as drafts.">
            <Select
              value={draft.recurrence ?? 'none'}
              onChange={(value) =>
                setDraft({ ...draft, recurrence: (value ?? 'none') as InvoiceInput['recurrence'] })
              }
              options={RECURRENCES.map((option) => ({
                value: option.value,
                label: option.label
              }))}
            />
          </Field>
        </div>

        <div className="border-t border-line pt-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-medium text-muted">Lines</p>
            {draft.projectId && (
              <Button variant="ghost" size="sm" onClick={() => setPullingTime(true)}>
                <Clock size={13} strokeWidth={1.75} />
                Pull in unbilled time
              </Button>
            )}
          </div>

          <div className="mb-1.5 flex gap-2 px-1 text-[10px] tracking-[0.08em] text-faint uppercase">
            <span className="flex-1">Description</span>
            <span className="w-[70px] text-right">Qty</span>
            <span className="w-[110px] text-right">Unit price</span>
            <span className="w-[90px] text-right">Amount</span>
            <span className="w-[26px]" />
          </div>

          <div className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {draft.lines.map((line, index) => (
                <motion.div
                  key={index}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={transition.press}
                  className="flex items-center gap-2"
                >
                  <TextInput
                    value={line.description}
                    onChange={(event) => setLine(index, { description: event.target.value })}
                    placeholder="What are you billing for?"
                    className="h-8 flex-1 text-[12.5px]"
                  />
                  <TextInput
                    type="number"
                    step="0.25"
                    value={line.quantity}
                    onChange={(event) =>
                      setLine(index, { quantity: Number.parseFloat(event.target.value) || 0 })
                    }
                    className="numeric h-8 w-[70px] text-right text-[12.5px]"
                  />
                  <div className="w-[110px]">
                    <MoneyInput
                      pence={line.unitPrice}
                      onChangePence={(pence) => setLine(index, { unitPrice: pence })}
                      className="h-8 text-right text-[12.5px]"
                    />
                  </div>
                  <span className="numeric w-[90px] text-right text-[12.5px] text-ink">
                    {formatMoney(lineAmount(line.quantity, line.unitPrice), { pennies: true })}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove line"
                    onClick={() =>
                      setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })
                    }
                    className="w-[26px] text-faint transition-colors hover:text-danger"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setDraft({ ...draft, lines: [...draft.lines, { ...BLANK_LINE }] })}
          >
            <Plus size={13} strokeWidth={1.75} />
            Add line
          </Button>
        </div>

        <div className="ml-auto w-[260px] border-t border-line pt-3">
          <Row label="Subtotal" value={formatMoney(totals.net, { pennies: true })} />
          {settings?.vatRegistered && (
            <Row
              label={`VAT at ${(settings.vatRate / 100).toFixed(0)}%`}
              value={formatMoney(totals.vat, { pennies: true })}
            />
          )}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-line-strong pt-2">
            <span className="text-[13px] font-medium text-ink">Total</span>
            <span className="numeric text-[16px] font-medium text-ink">
              {formatMoney(totals.gross, { pennies: true })}
            </span>
          </div>
        </div>

        <Field label="Notes" hint="Appears on the PDF.">
          <TextInput
            value={draft.notes ?? ''}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="Payment details, thanks, reference"
          />
        </Field>
      </div>

      <PullTimeModal
        open={pullingTime}
        projectId={draft.projectId ?? null}
        onClose={() => setPullingTime(false)}
        onPull={(lines) => {
          // Drop the empty starter line rather than leaving a blank row above
          // the pulled-in work.
          const existing = draft.lines.filter(
            (line) => line.description.trim() !== '' || line.unitPrice !== 0
          )
          setDraft({ ...draft, lines: [...existing, ...lines] })
          setPullingTime(false)
        }}
      />
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="numeric text-[12.5px] text-ink">{value}</span>
    </div>
  )
}

/**
 * Turns tracked time into invoice lines.
 *
 * Grouped by rate, because a project whose rate changed mid-way would otherwise
 * produce a single line whose quantity and unit price cannot both be right.
 */
function PullTimeModal({
  open,
  projectId,
  onClose,
  onPull
}: {
  open: boolean
  projectId: number | null
  onClose: () => void
  onPull: (lines: LineDraft[]) => void
}): React.JSX.Element {
  const { data } = useQuery({
    queryKey: ['time', 'unbilled', projectId],
    queryFn: () => window.solo.invoke('time:unbilled', { projectId: projectId! }),
    enabled: open && projectId !== null
  })

  const entries = data?.entries ?? []

  const byRate = entries.reduce<Record<number, { seconds: number; ids: number[] }>>(
    (groups, entry) => {
      const group = (groups[entry.rate] ??= { seconds: 0, ids: [] })
      group.seconds += entry.duration
      group.ids.push(entry.id)
      return groups
    },
    {}
  )

  const lines: LineDraft[] = Object.entries(byRate).map(([rate, group]) => ({
    description: `Time — ${secondsToHours(group.seconds)} hours`,
    quantity: secondsToHours(group.seconds),
    unitPrice: Number(rate),
    kind: 'time' as const,
    timeEntryIds: group.ids
  }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unbilled time"
      description="Billable time on this project that has not been invoiced yet."
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onPull(lines)} disabled={lines.length === 0}>
            Add {lines.length} line{lines.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-faint">
          No unbilled time on this project.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <div
              key={line.unitPrice}
              className="flex items-center justify-between rounded-control bg-raised px-3 py-2"
            >
              <div>
                <p className="text-[13px] text-ink">{line.quantity} hours</p>
                <p className="text-[11px] text-faint">
                  at {formatMoney(line.unitPrice)}/hr · {line.timeEntryIds?.length} entries
                </p>
              </div>
              <span className="numeric text-[13px] text-ink">
                {formatMoney(
                  timeValue(Math.round(line.quantity * 3600), line.unitPrice),
                  { pennies: true }
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
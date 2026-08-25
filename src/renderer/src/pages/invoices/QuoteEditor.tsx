import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Trash2 } from 'lucide-react'
import type { LineDraft, QuoteInput, QuoteWithContext } from '@shared/types'
import { lineAmount, totalsFor } from '@shared/money'
import { addDays, today } from '@shared/taxYear'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { keys, useInvalidate } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { transition } from '@/lib/motion'

const BLANK_LINE: LineDraft = { description: '', quantity: 1, unitPrice: 0 }

/**
 * Quotes are simpler than invoices: no time to pull in, no recurrence, no
 * payment terms — just what the work will cost and how long the price stands.
 */
export function QuoteEditor({
  quote,
  open,
  onClose
}: {
  quote: QuoteWithContext | null
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<QuoteInput>({ clientId: null, lines: [{ ...BLANK_LINE }] })

  const { data: settings } = useQuery({
    queryKey: keys.settings,
    queryFn: () => window.solo.invoke('settings:get')
  })

  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  useEffect(() => {
    if (quote) {
      setDraft({
        clientId: quote.clientId,
        issueDate: quote.issueDate,
        validUntil: quote.validUntil,
        notes: quote.notes,
        status: quote.status,
        lines: quote.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice
        }))
      })
    } else {
      setDraft({
        clientId: null,
        issueDate: today(),
        validUntil: addDays(today(), 30),
        lines: [{ ...BLANK_LINE }]
      })
    }
  }, [quote, open])

  const save = useMutation({
    mutationFn: () =>
      quote
        ? window.solo.invoke('quotes:update', { id: quote.id, patch: draft })
        : window.solo.invoke('quotes:create', draft),
    onSuccess: () => {
      invalidate(['quotes'])
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
    { vatRegistered: settings?.vatRegistered ?? false, vatRate: settings?.vatRate ?? 2000 }
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={quote ? `Quote ${quote.number}` : 'New quote'}
      width={680}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {quote ? 'Save changes' : 'Create quote'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Client">
            <Select
              value={draft.clientId}
              onChange={(value) => setDraft({ ...draft, clientId: value })}
              placeholder="No client"
              options={clients.map((client) => ({ value: client.id, label: client.name }))}
            />
          </Field>
          <Field label="Issued">
            <TextInput
              type="date"
              value={draft.issueDate ?? today()}
              onChange={(event) => setDraft({ ...draft, issueDate: event.target.value })}
            />
          </Field>
          <Field label="Valid until" hint="How long the price stands.">
            <TextInput
              type="date"
              value={draft.validUntil ?? ''}
              onChange={(event) => setDraft({ ...draft, validUntil: event.target.value || null })}
            />
          </Field>
        </div>

        <div className="border-t border-line pt-3.5">
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
                  /*
                    No exit animation, and that is deliberate. These rows are
                    keyed by position because a draft line has no identity of
                    its own, so deleting the second of four unmounts the
                    *fourth* — React shifts the contents up and drops the row
                    off the end. An exit animation on that fades the wrong row
                    out while the one you clicked silently becomes its
                    neighbour, which reads as the app deleting something else.
                    Removing instantly is the honest version, until lines carry
                    a stable id.
                  */
                  transition={transition.expand}
                  className="flex items-center gap-2 overflow-hidden"
                >
                  <TextInput
                    value={line.description}
                    onChange={(event) => setLine(index, { description: event.target.value })}
                    placeholder="What is included?"
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

        <div className="ml-auto w-[240px] border-t border-line pt-3">
          <div className="flex items-baseline justify-between py-1">
            <span className="text-[12px] text-muted">Subtotal</span>
            <span className="numeric text-[12.5px] text-ink">
              {formatMoney(totals.net, { pennies: true })}
            </span>
          </div>
          {settings?.vatRegistered && (
            <div className="flex items-baseline justify-between py-1">
              <span className="text-[12px] text-muted">
                VAT at {(settings.vatRate / 100).toFixed(0)}%
              </span>
              <span className="numeric text-[12.5px] text-ink">
                {formatMoney(totals.vat, { pennies: true })}
              </span>
            </div>
          )}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-line-strong pt-2">
            <span className="text-[13px] font-medium text-ink">Total</span>
            <span className="numeric text-[16px] font-medium text-ink">
              {formatMoney(totals.gross, { pennies: true })}
            </span>
          </div>
        </div>

        <Field label="Notes" hint="Appears on the PDF — scope, assumptions, exclusions.">
          <TextInput
            value={draft.notes ?? ''}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </Field>
      </div>
    </Modal>
  )
}
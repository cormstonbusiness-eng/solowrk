import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { BellOff, Copy, FileDown, Mail, Plus, ReceiptText, Repeat, Trash2 } from 'lucide-react'
import type { InvoiceDisplayStatus, InvoiceWithContext, QuoteWithContext } from '@shared/types'
import { Page } from '@/components/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Empty, Pill } from '@/components/ui/Empty'
import { Outbox } from './invoices/Outbox'
import { Swap } from '@/components/ui/Swap'
import { useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { useOpenParam } from '@/hooks/useOpenParam'
import { describeDue, formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { InvoiceEditor } from './invoices/InvoiceEditor'
import { QuoteEditor } from './invoices/QuoteEditor'

const STATUS_COLOURS: Record<InvoiceDisplayStatus, string> = {
  draft: '#8a8a93',
  sent: '#3B82F6',
  paid: '#30A46C',
  overdue: '#E5484D',
  cancelled: '#5a5a63'
}

const STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled'
}

type Tab = 'invoices' | 'quotes'

export function Invoices(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('invoices')
  const [editing, setEditing] = useState<InvoiceWithContext | null>(null)
  const [creating, setCreating] = useState(false)
  const [quoteEditing, setQuoteEditing] = useState<QuoteWithContext | null>(null)
  const [quoteCreating, setQuoteCreating] = useState(false)

  // Whichever tab is showing is the thing being asked for, so ?new=1 from the
  // palette raises an invoice, and the same URL on the quotes tab raises a quote.
  useOpenParam('new', () => (tab === 'invoices' ? setCreating(true) : setQuoteCreating(true)))

  return (
    <Page
      title={tab === 'invoices' ? 'Invoices' : 'Quotes'}
      description={
        tab === 'invoices'
          ? 'Raise them, chase them, get paid.'
          : 'Price the work before you do it.'
      }
      actions={
        <Button
          variant="primary"
          onClick={() => (tab === 'invoices' ? setCreating(true) : setQuoteCreating(true))}
        >
          <Plus size={14} strokeWidth={1.75} />
          New {tab === 'invoices' ? 'invoice' : 'quote'}
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2 border-b border-line">
        {(['invoices', 'quotes'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className="relative px-3 py-2 text-[13px] capitalize"
          >
            <span className={tab === name ? 'text-ink' : 'text-muted hover:text-ink'}>{name}</span>
            {tab === name && (
              <motion.span
                layoutId="money-tab"
                transition={transition.layout}
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'invoices' ? (
        <InvoiceList onEdit={setEditing} />
      ) : (
        <QuoteList onEdit={setQuoteEditing} />
      )}

      <InvoiceEditor
        invoice={editing}
        open={editing !== null || creating}
        onClose={() => {
          setEditing(null)
          setCreating(false)
        }}
      />

      <QuoteEditor
        quote={quoteEditing}
        open={quoteEditing !== null || quoteCreating}
        onClose={() => {
          setQuoteEditing(null)
          setQuoteCreating(false)
        }}
      />
    </Page>
  )
}

function InvoiceList({
  onEdit
}: {
  onEdit: (invoice: InvoiceWithContext) => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [chaser, setChaser] = useState<ChaserDraft | null>(null)
  const [deleting, setDeleting] = useState<InvoiceWithContext | null>(null)

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => window.solo.invoke('invoices:list', {})
  })

  const setStatus = useMutation({
    mutationFn: (args: { id: number; status: 'draft' | 'sent' | 'paid' | 'cancelled' }) =>
      window.solo.invoke('invoices:update', { id: args.id, patch: { status: args.status } }),
    onSuccess: () => invalidate(['invoices', 'finance'])
  })

  const makePdf = useMutation({
    mutationFn: (id: number) => window.solo.invoke('invoices:pdf', { id }),
    onSuccess: (path) => {
      invalidate(['invoices', 'files'])
      void window.solo.invoke('files:open', { path })
    }
  })

  /**
   * Deliberately does not touch the invoice's own `pdfPath`. The invoice PDF is
   * the record of what was asked for; the receipt is a second document saying
   * it arrived, and one must not quietly replace the other.
   */
  const makeReceipt = useMutation({
    mutationFn: (id: number) => window.solo.invoke('invoices:receipt', { id }),
    onSuccess: (path) => {
      invalidate(['files'])
      void window.solo.invoke('files:open', { path })
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('invoices:delete', { id }),
    onSuccess: () => invalidate(['invoices', 'time', 'finance'])
  })

  const visible = statusFilter
    ? invoices.filter((invoice) => invoice.displayStatus === statusFilter)
    : invoices

  const outstanding = invoices
    .filter((invoice) => invoice.status === 'sent')
    .reduce((sum, invoice) => sum + invoice.gross, 0)

  const overdue = invoices
    .filter((invoice) => invoice.displayStatus === 'overdue')
    .reduce((sum, invoice) => sum + invoice.gross, 0)

  return (
    <>
      <ChaseQueue onRead={setChaser} />

      <div className="mb-3 flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          options={(Object.keys(STATUS_LABELS) as InvoiceDisplayStatus[]).map((status) => ({
            value: status,
            label: STATUS_LABELS[status]
          }))}
          className="w-[170px]"
        />
        <div className="flex-1" />
        <span className="text-[12px] text-muted">
          Awaiting payment <span className="numeric text-ink">{formatMoney(outstanding)}</span>
        </span>
        {overdue > 0 && (
          <span className="text-[12px] text-danger">
            Overdue <span className="numeric">{formatMoney(overdue)}</span>
          </span>
        )}
      </div>

      {/* Above the list, because a note waiting to go to a client is more
          urgent than the list of invoices it came from — and because it
          disappears entirely when there is nothing waiting. */}
      <Outbox />

      <Swap
        empty={visible.length === 0}
        fallback={
          <Empty
            icon={ReceiptText}
            title={invoices.length === 0 ? 'No invoices yet' : 'Nothing matches that filter'}
            body={
              invoices.length === 0
                ? 'Raise your first invoice. If you have tracked time against a project, you can pull it straight in as lines.'
                : 'Try a different status.'
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
          {visible.map((invoice) => {
            const due = describeDue(invoice.dueDate)

            return (
              <motion.div key={invoice.id} variants={listItemVariants}>
                <Card className="flex items-center justify-between gap-4 py-3">
                  <button
                    type="button"
                    onClick={() => onEdit(invoice)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13.5px] text-ink">
                        <span className="numeric">{invoice.number}</span>
                        {invoice.recurrence !== 'none' && (
                          <Repeat size={12} strokeWidth={1.75} className="text-faint" />
                        )}
                      </p>
                      <p className="truncate text-[11.5px] text-faint">
                        {invoice.clientName ?? 'No client'}
                        {invoice.projectName ? ` · ${invoice.projectName}` : ''}
                      </p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-[11.5px] text-faint">
                      {formatDate(invoice.issueDate)}
                    </span>
                    {invoice.displayStatus === 'overdue' && (
                      <span className="text-[11.5px] text-danger">{due.label}</span>
                    )}
                    <span className="numeric w-[92px] text-right text-[13.5px] text-ink">
                      {formatMoney(invoice.gross, { pennies: true })}
                    </span>
                    <Pill colour={STATUS_COLOURS[invoice.displayStatus]}>
                      {STATUS_LABELS[invoice.displayStatus]}
                    </Pill>

                    <div className="flex items-center gap-1">
                      {invoice.status === 'draft' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus.mutate({ id: invoice.id, status: 'sent' })}
                        >
                          Mark sent
                        </Button>
                      )}
                      {invoice.status === 'sent' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus.mutate({ id: invoice.id, status: 'paid' })}
                        >
                          Mark paid
                        </Button>
                      )}
                      {invoice.displayStatus === 'overdue' && (
                        <button
                          type="button"
                          aria-label="Draft chase email"
                          title="Draft chase email"
                          onClick={() =>
                            void window.solo
                              .invoke('invoices:chaser', { id: invoice.id })
                              .then(setChaser)
                          }
                          className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
                        >
                          <Mail size={13} strokeWidth={1.75} />
                        </button>
                      )}
                      {invoice.status === 'paid' && (
                        <button
                          type="button"
                          aria-label={`Save a receipt for ${invoice.number}`}
                          title="Save a receipt"
                          onClick={() => makeReceipt.mutate(invoice.id)}
                          className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
                        >
                          <ReceiptText size={13} strokeWidth={1.75} />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Export PDF"
                        title="Export PDF"
                        onClick={() => makePdf.mutate(invoice.id)}
                        className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
                      >
                        <FileDown size={13} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(invoice)}
                        className="text-[11.5px] text-faint hover:text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      </Swap>

      <ChaserModal chaser={chaser} onClose={() => setChaser(null)} />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={`Delete ${deleting?.number ?? 'invoice'}?`}
        body="Any time billed on this invoice returns to your unbilled pool. Its PDF, if you exported one, stays in your workspace."
      />
    </>
  )
}

interface ChaserDraft {
  subject: string
  body: string
  to: string
  /**
   * Present only when the draft came from the queue. Acting on it then advances
   * the schedule; a chaser written by hand from the button on an overdue
   * invoice does not, because that button is Basic and `chasing:record` is not.
   */
  chase?: { id: number; attempt: number }
}

/**
 * Invoices that have gone quiet, with the note already written.
 *
 * Above the list rather than folded into it, because a filter someone has to
 * remember to apply is a filter nobody applies — and this is the one thing on
 * the page that is asking for a decision rather than reporting a fact. It
 * disappears entirely when there is nothing to chase, which is most days.
 */
function ChaseQueue({ onRead }: { onRead: (draft: ChaserDraft) => void }): React.JSX.Element | null {
  const invalidate = useInvalidate()
  const entitled = useFeature('chasing')

  const { data: chases = [] } = useQuery({
    // Under the invoices key so marking one chased, or paid, refreshes both
    // without anybody having to name this list at the call site.
    queryKey: ['invoices', 'chases'],
    queryFn: () => window.solo.invoke('chasing:due'),
    enabled: entitled
  })

  const stop = useMutation({
    mutationFn: (id: number) => window.solo.invoke('chasing:stop', { id }),
    onSuccess: () => invalidate(['invoices'])
  })

  if (chases.length === 0) return null

  const total = chases.reduce((sum, chase) => sum + chase.invoice.gross, 0)

  return (
    <Card className="mb-3 border-danger/30 bg-danger/[0.04]">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-medium text-ink">
          {chases.length === 1 ? 'One invoice needs chasing' : `${chases.length} invoices need chasing`}
        </h2>
        <span className="numeric text-[12px] text-danger">{formatMoney(total)} outstanding</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {chases.map((chase) => (
          <div
            key={chase.invoice.id}
            className="flex items-center justify-between gap-4 rounded-control bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">
                <span className="numeric">{chase.invoice.number}</span>
                <span className="text-faint"> · {chase.invoice.clientName ?? 'No client'}</span>
              </p>
              <p className="text-[11.5px] text-faint">
                <span className="text-danger">
                  {chase.daysLate} day{chase.daysLate === 1 ? '' : 's'} late
                </span>
                {' · '}
                {formatMoney(chase.invoice.gross, { pennies: true })}
                {' · '}
                {chase.attempts > 1 ? `note ${chase.attempt} of ${chase.attempts}` : 'note ready'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void window.solo
                    .invoke('invoices:chaser', {
                      id: chase.invoice.id,
                      attempt: chase.attempt
                    })
                    .then((draft) =>
                      onRead({
                        ...draft,
                        chase: { id: chase.invoice.id, attempt: chase.attempt }
                      })
                    )
                }
              >
                <Mail size={13} strokeWidth={1.75} />
                Read the note
              </Button>
              <button
                type="button"
                aria-label={`Stop chasing ${chase.invoice.number}`}
                title="Stop chasing this one"
                onClick={() => stop.mutate(chase.invoice.id)}
                className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
              >
                <BellOff size={13} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2.5 text-[11px] text-faint">
        Nothing is sent for you. Reading a note and sending it marks the invoice chased; the bell
        stops this one without marking it paid.
      </p>
    </Card>
  )
}

/**
 * A chase email drafted for the user to read, edit and send. SoloWrk never sends
 * it — an email to a client in someone's name is not a decision to automate.
 */
function ChaserModal({
  chaser,
  onClose
}: {
  chaser: ChaserDraft | null
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [copied, setCopied] = useState(false)

  /**
   * Recorded when the note is taken away to be sent, not when it was drafted —
   * a draft nobody read has not chased anybody, and marking it done at that
   * point would let the next milestone silently replace one never sent.
   */
  const record = (draft: ChaserDraft): void => {
    if (!draft.chase) return
    void window.solo
      .invoke('chasing:record', draft.chase)
      .then(() => invalidate(['invoices']))
      // Refusing here means a licence lapsed between opening the draft and
      // sending it. The note is still perfectly good; say nothing and let the
      // read-only bar do the explaining.
      .catch(() => undefined)
  }

  return (
    <Modal
      open={chaser !== null}
      onClose={onClose}
      title="Chase this invoice"
      description="Read it over, change anything you like, then send it yourself."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!chaser) return
              void navigator.clipboard.writeText(chaser.body)
              record(chaser)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            <Copy size={13} strokeWidth={1.75} />
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!chaser) return
              void window.solo.invoke('shell:mailto', {
                to: chaser.to,
                subject: chaser.subject,
                body: chaser.body
              })
              record(chaser)
            }}
            disabled={!chaser?.to}
          >
            <Mail size={13} strokeWidth={1.75} />
            Open in email
          </Button>
        </>
      }
    >
      {chaser && (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-control bg-raised px-3 py-2">
            <p className="text-[11px] text-faint">To</p>
            <p className="text-[12.5px] text-ink">{chaser.to || 'No email on file for this client'}</p>
          </div>
          <div className="rounded-control bg-raised px-3 py-2">
            <p className="text-[11px] text-faint">Subject</p>
            <p className="text-[12.5px] text-ink">{chaser.subject}</p>
          </div>
          <pre className="rounded-control bg-raised px-3 py-2.5 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">
            {chaser.body}
          </pre>
        </div>
      )}
    </Modal>
  )
}

function QuoteList({
  onEdit
}: {
  onEdit: (quote: QuoteWithContext) => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [converting, setConverting] = useState<QuoteWithContext | null>(null)
  const [deleting, setDeleting] = useState<QuoteWithContext | null>(null)

  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => window.solo.invoke('quotes:list', {})
  })

  const makePdf = useMutation({
    mutationFn: (id: number) => window.solo.invoke('quotes:pdf', { id }),
    onSuccess: (path) => void window.solo.invoke('files:open', { path })
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('quotes:delete', { id }),
    onSuccess: () => {
      invalidate(['quotes'])
      setDeleting(null)
    }
  })

  const setStatus = useMutation({
    mutationFn: (args: { id: number; status: QuoteWithContext['status'] }) =>
      window.solo.invoke('quotes:update', { id: args.id, patch: { status: args.status } }),
    onSuccess: () => invalidate(['quotes'])
  })

  const accepted = quotes.filter((quote) => quote.status === 'accepted').length
  const sent = quotes.filter((quote) => quote.status === 'sent').length

  if (quotes.length === 0) {
    return (
      <Empty
        icon={ReceiptText}
        title="No quotes yet"
        body="Price a job before you start it. When a quote is accepted, SoloWrk can turn it into a project and a deposit invoice in one step."
      />
    )
  }

  return (
    <>
      {sent + accepted > 0 && (
        <p className="mb-3 text-[12px] text-muted">
          {accepted} accepted of {sent + accepted} sent
          {sent + accepted > 0 && (
            <span className="text-faint">
              {' '}
              · {Math.round((accepted / (sent + accepted)) * 100)}% win rate
            </span>
          )}
        </p>
      )}

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-2"
      >
        {quotes.map((quote) => (
          <motion.div key={quote.id} variants={listItemVariants}>
            <Card className="flex items-center justify-between gap-4 py-3">
              <button
                type="button"
                onClick={() => onEdit(quote)}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="numeric truncate text-[13.5px] text-ink">{quote.number}</span>
                <span className="truncate text-[11.5px] text-faint">
                  {quote.clientName ?? 'No client'}
                </span>
              </button>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11.5px] text-faint">{formatDate(quote.issueDate)}</span>
                <span className="numeric w-[92px] text-right text-[13.5px] text-ink">
                  {formatMoney(quote.gross, { pennies: true })}
                </span>
                <Pill
                  colour={
                    quote.status === 'accepted'
                      ? '#30A46C'
                      : quote.status === 'declined'
                        ? '#E5484D'
                        : quote.status === 'sent'
                          ? '#3B82F6'
                          : '#8a8a93'
                  }
                >
                  {quote.status}
                </Pill>

                {quote.status === 'draft' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStatus.mutate({ id: quote.id, status: 'sent' })}
                  >
                    Mark sent
                  </Button>
                )}
                {quote.status === 'sent' && (
                  <Button variant="ghost" size="sm" onClick={() => setConverting(quote)}>
                    Accepted
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Export PDF"
                  title="Export PDF"
                  onClick={() => makePdf.mutate(quote.id)}
                  className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-ink"
                >
                  <FileDown size={13} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete quote ${quote.number}`}
                  title="Delete quote"
                  onClick={() => setDeleting(quote)}
                  className="rounded-control p-1.5 text-faint hover:bg-hover hover:text-danger"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <ConvertQuoteModal quote={converting} onClose={() => setConverting(null)} />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={`Delete quote ${deleting?.number ?? ''}?`}
        body="The quote and its lines are removed. Any PDF already exported stays on disk, and a project or invoice converted from it is untouched."
        confirmLabel="Delete quote"
      />
    </>
  )
}

function ConvertQuoteModal({
  quote,
  onClose
}: {
  quote: QuoteWithContext | null
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [withProject, setWithProject] = useState(true)
  const [deposit, setDeposit] = useState(50)

  const convert = useMutation({
    mutationFn: () =>
      window.solo.invoke('quotes:convert', {
        id: quote!.id,
        createProject: withProject,
        depositPercent: deposit
      }),
    onSuccess: () => {
      invalidate(['quotes', 'projects', 'invoices', 'clients'])
      onClose()
    }
  })

  return (
    <Modal
      open={quote !== null}
      onClose={onClose}
      title="Quote accepted"
      description="Turn it into work."
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => convert.mutate()}>
            Convert
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 rounded-control bg-raised px-3 py-2.5">
          <input
            type="checkbox"
            checked={withProject}
            onChange={(event) => setWithProject(event.target.checked)}
            className="accent-accent"
          />
          <span className="text-[13px] text-ink">Create a project with its folders</span>
        </label>

        <div className="rounded-control bg-raised px-3 py-2.5">
          <p className="mb-2 text-[13px] text-ink">Raise a deposit invoice</p>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={deposit}
              onChange={(event) => setDeposit(Number(event.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="numeric w-[42px] text-right text-[13px] text-ink">{deposit}%</span>
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            {deposit === 0
              ? 'No deposit invoice will be raised.'
              : `A draft invoice for ${formatMoney(
                  Math.round(((quote?.net ?? 0) * deposit) / 100)
                )} plus VAT, which you can review before sending.`}
          </p>
        </div>
      </div>
    </Modal>
  )
}
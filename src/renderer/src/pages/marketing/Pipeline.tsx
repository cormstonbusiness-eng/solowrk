import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { CalendarClock, Plus, TriangleAlert } from 'lucide-react'
import type { LeadInput, LeadWithHealth, LostReason } from '@shared/types'
import {
  LOST_REASONS,
  LOST_REASON_LABELS,
  OPEN_STAGES,
  STAGE_LABELS,
  type LeadHealth,
  type Stage
} from '@shared/pipeline'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useInvalidate } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The lead board.
 *
 * §12 calls this the pipeline that stops the feast-and-famine cycle, and the
 * one rule that makes it work is the next action: a lead without one is
 * flagged in `danger` and stays flagged. That flag is the whole discipline of
 * pipeline management, so it is the loudest thing on the card and it cannot be
 * dismissed — only answered, by deciding what to do next.
 */

const HEALTH_EDGE: Record<LeadHealth, string> = {
  adrift: 'bg-danger',
  overdue: 'bg-danger',
  today: 'bg-warning',
  soon: 'bg-accent',
  scheduled: 'bg-line-strong',
  closed: 'bg-line'
}

function healthLine(lead: LeadWithHealth): { text: string; tone: string } {
  switch (lead.health) {
    case 'adrift':
      // Named as a decision nobody has made, not as a missing field.
      return { text: 'No next step', tone: 'text-danger' }
    case 'overdue':
      return { text: `${lead.nextAction} · overdue`, tone: 'text-danger' }
    case 'today':
      return { text: `${lead.nextAction} · today`, tone: 'text-warning' }
    default:
      return {
        text: `${lead.nextAction} · ${formatDate(lead.nextActionOn ?? '')}`,
        tone: 'text-faint'
      }
  }
}

export function Pipeline(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState<LeadWithHealth | null>(null)
  const [adding, setAdding] = useState(false)
  const [losing, setLosing] = useState<LeadWithHealth | null>(null)

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => window.solo.invoke('leads:list')
  })

  const { data: report } = useQuery({
    queryKey: ['leads', 'report'],
    queryFn: () => window.solo.invoke('leads:report')
  })

  const move = useMutation({
    mutationFn: (args: { id: number; stage: Stage }) => window.solo.invoke('leads:move', args),
    onSuccess: () => invalidate(['leads'])
  })

  const win = useMutation({
    mutationFn: (id: number) => window.solo.invoke('leads:win', { id }),
    onSuccess: () => invalidate(['leads', 'clients'])
  })

  const sensors = useSensors(
    // A card that moves on a 2px twitch is a card nobody can click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const onDragEnd = (event: DragEndEvent): void => {
    const stage = event.over?.id as Stage | undefined
    if (!stage) return

    const id = Number(event.active.id)
    const lead = leads.find((one) => one.id === id)
    if (!lead || lead.stage === stage) return

    // Losing needs a reason, so it asks rather than dropping the lead into a
    // column with "something else" already filled in.
    if (stage === 'lost') {
      setLosing(lead)
      return
    }
    if (stage === 'won') {
      win.mutate(id)
      return
    }

    move.mutate({ id, stage })
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-5">
          <Figure label="In the pipeline" value={formatMoney(report?.value.total ?? 0)} />
          <Figure
            label="Weighted"
            value={formatMoney(report?.value.weighted ?? 0)}
            hint="By stage probability"
          />
          {(report?.value.adrift ?? 0) > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] text-danger">
                <TriangleAlert size={11} strokeWidth={2} />
                No next step
              </p>
              <p className="numeric text-[17px] font-medium text-danger">
                {report!.value.adrift}
              </p>
            </div>
          )}
        </div>

        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.75} />
          Add lead
        </Button>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-6 gap-3">
          {[...OPEN_STAGES, 'won' as Stage, 'lost' as Stage].map((stage) => (
            <Column
              key={stage}
              stage={stage}
              leads={leads.filter((lead) => lead.stage === stage)}
              onOpen={setEditing}
            />
          ))}
        </div>
      </DndContext>

      <LeadModal
        lead={editing}
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
      />

      <LostModal lead={losing} onClose={() => setLosing(null)} />
    </>
  )
}

function Figure({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted" title={hint}>
        {label}
      </p>
      <p className="numeric text-[17px] font-medium text-ink">{value}</p>
    </div>
  )
}

function Column({
  stage,
  leads,
  onOpen
}: {
  stage: Stage
  leads: LeadWithHealth[]
  onOpen: (lead: LeadWithHealth) => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const value = leads.reduce((sum, lead) => sum + (lead.value ?? 0), 0)

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <p className="truncate text-[12px] text-ink">{STAGE_LABELS[stage]}</p>
        <p className="numeric shrink-0 text-[11px] text-faint">
          {leads.length}
          {value > 0 && ` · ${formatMoney(value)}`}
        </p>
      </div>

      <motion.div
        ref={setNodeRef}
        variants={listVariants}
        initial="initial"
        animate="animate"
        className={cn(
          'flex min-h-[120px] flex-1 flex-col gap-1.5 rounded-card border border-dashed p-1.5 transition-colors duration-press ease-solo',
          isOver ? 'border-accent bg-accent-subtle' : 'border-line'
        )}
      >
        {leads.map((lead) => (
          <motion.div key={lead.id} variants={listItemVariants}>
            <LeadCard lead={lead} onOpen={() => onOpen(lead)} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

function LeadCard({
  lead,
  onOpen
}: {
  lead: LeadWithHealth
  onOpen: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  const line = healthLine(lead)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-control border border-line bg-surface p-2.5 text-left transition-colors duration-press ease-solo hover:bg-surface-hover',
        isDragging && 'opacity-40'
      )}
    >
      {/* The edge carries the health, so a full board reads before it is read. */}
      <span className={cn('absolute top-0 bottom-0 left-0 w-[2px]', HEALTH_EDGE[lead.health])} />

      <p className="truncate pl-1.5 text-[12.5px] text-ink">{lead.company || lead.name}</p>
      {lead.company && lead.name && (
        <p className="truncate pl-1.5 text-[11px] text-faint">{lead.name}</p>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2 pl-1.5">
        <p className={cn('flex min-w-0 items-center gap-1 truncate text-[11px]', line.tone)}>
          {lead.health === 'adrift' ? (
            <TriangleAlert size={10} strokeWidth={2} className="shrink-0" />
          ) : lead.stage !== 'won' && lead.stage !== 'lost' ? (
            <CalendarClock size={10} strokeWidth={1.75} className="shrink-0" />
          ) : null}
          {lead.stage === 'won' ? 'Won' : lead.stage === 'lost' ? loss(lead) : line.text}
        </p>

        {lead.value !== null && (
          <span className="numeric shrink-0 text-[11px] text-muted">
            {formatMoney(lead.value)}
          </span>
        )}
      </div>
    </div>
  )
}

function loss(lead: LeadWithHealth): string {
  return lead.lostReason ? LOST_REASON_LABELS[lead.lostReason] : 'Lost'
}

function LeadModal({
  lead,
  open,
  onClose
}: {
  lead: LeadWithHealth | null
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<LeadInput>({})

  // Reset whenever a different lead is opened, so an edit in progress never
  // carries across into somebody else's record.
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  if (open && openedFor !== (lead?.id ?? 0)) {
    setOpenedFor(lead?.id ?? 0)
    setDraft(
      lead
        ? {
            name: lead.name,
            company: lead.company,
            email: lead.email,
            phone: lead.phone,
            source: lead.source,
            value: lead.value,
            nextAction: lead.nextAction,
            nextActionOn: lead.nextActionOn,
            notes: lead.notes
          }
        : { name: '', company: '', source: '', nextAction: '', nextActionOn: null }
    )
  }

  const save = useMutation({
    mutationFn: () =>
      lead
        ? window.solo.invoke('leads:update', { id: lead.id, patch: draft })
        : window.solo.invoke('leads:create', draft),
    onSuccess: () => {
      invalidate(['leads'])
      onClose()
    }
  })

  const set = <K extends keyof LeadInput>(key: K, value: LeadInput[K]): void =>
    setDraft({ ...draft, [key]: value })

  const planned = (draft.nextAction ?? '').trim() !== '' && draft.nextActionOn

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={lead ? lead.company || lead.name : 'Add lead'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {lead ? 'Save' : 'Add lead'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company">
            <TextInput
              value={draft.company ?? ''}
              onChange={(event) => set('company', event.target.value)}
              placeholder="Northgate Studio"
            />
          </Field>
          <Field label="Contact">
            <TextInput
              value={draft.name ?? ''}
              onChange={(event) => set('name', event.target.value)}
              placeholder="Jane Powell"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <TextInput
              value={draft.email ?? ''}
              onChange={(event) => set('email', event.target.value)}
            />
          </Field>
          <Field label="Phone">
            <TextInput
              value={draft.phone ?? ''}
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Where from?" hint="Referral, LinkedIn, an old client.">
            <TextInput
              value={draft.source ?? ''}
              onChange={(event) => set('source', event.target.value)}
            />
          </Field>
          <Field label="Worth roughly" hint="A guess is more useful than nothing.">
            <MoneyInput
              pence={draft.value ?? 0}
              onChangePence={(pence) => set('value', pence === 0 ? null : pence)}
            />
          </Field>
        </div>

        {/*
          The one rule, given its own space and its own explanation rather than
          sitting among the contact fields as though it were another detail.
        */}
        <div
          className={cn(
            'flex flex-col gap-3 rounded-control border p-3',
            planned ? 'border-line' : 'border-danger/40 bg-danger/[0.05]'
          )}
        >
          <div className="grid grid-cols-[1fr_150px] gap-3">
            <Field label="What happens next?">
              <TextInput
                value={draft.nextAction ?? ''}
                onChange={(event) => set('nextAction', event.target.value)}
                placeholder="Send the proposal"
              />
            </Field>
            <Field label="When?">
              <TextInput
                type="date"
                value={draft.nextActionOn ?? ''}
                onChange={(event) => set('nextActionOn', event.target.value || null)}
              />
            </Field>
          </div>

          {!planned && (
            <p className="text-[11.5px] leading-relaxed text-danger">
              A lead with nothing planned is the one that goes quiet for six weeks and turns up as
              somebody else's client. You can save without it — it will stay flagged until you
              decide.
            </p>
          )}
        </div>

        <Field label="Notes">
          <TextInput
            value={draft.notes ?? ''}
            onChange={(event) => set('notes', event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

/**
 * Losing one, with a reason from the fixed list.
 *
 * Asked rather than assumed, because the count is the point: knowing you lose
 * 60% on price is actionable and "we lost some" is not. The note is where the
 * detail goes, so the list never has to grow to fit one awkward case.
 */
function LostModal({
  lead,
  onClose
}: {
  lead: LeadWithHealth | null
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [reason, setReason] = useState<LostReason>('price')
  const [note, setNote] = useState('')

  const lose = useMutation({
    mutationFn: () =>
      window.solo.invoke('leads:move', {
        id: lead!.id,
        stage: 'lost',
        lostReason: reason,
        lostNote: note
      }),
    onSuccess: () => {
      invalidate(['leads'])
      setNote('')
      onClose()
    }
  })

  return (
    <Modal
      open={lead !== null}
      onClose={onClose}
      title={`Why did ${lead?.company || lead?.name || 'this'} not happen?`}
      description="Kept so the pattern shows up. It is the only way to find out what is actually costing you work."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => lose.mutate()} disabled={lose.isPending}>
            Mark lost
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Reason">
          <Select
            value={reason}
            onChange={(value) => setReason((value ?? 'other') as LostReason)}
            options={LOST_REASONS.map((one) => ({ value: one, label: LOST_REASON_LABELS[one] }))}
          />
        </Field>

        <Field label="Anything worth remembering?">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}


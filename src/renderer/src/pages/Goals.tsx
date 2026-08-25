import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import type { GoalInput, GoalKind, GoalPeriod, GoalProgress } from '@shared/types'
import { GOAL_KINDS, GOAL_PERIODS } from '@shared/types'
import { Page } from '@/components/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { keys, useInvalidate } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'

const BLANK: GoalInput = {
  name: '',
  kind: 'revenue',
  target: 0,
  period: 'year',
  colour: DEFAULT_ENTITY_COLOUR
}

const isMoney = (kind: GoalKind): boolean =>
  GOAL_KINDS.find((entry) => entry.value === kind)?.money ?? false

function formatValue(value: number, kind: GoalKind): string {
  return isMoney(kind) ? formatMoney(value) : String(value)
}

/**
 * Goals, measured from what the app already knows.
 *
 * Only a "something else" goal carries a number you type — revenue, hours,
 * clients and the rest are counted from real records, so a goal cannot quietly
 * become a lie you keep believing because nobody updated it.
 */
export function Goals(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState<(GoalInput & { id?: number }) | null>(null)
  const [deleting, setDeleting] = useState<GoalProgress | null>(null)

  const { data: goals = [] } = useQuery({
    queryKey: keys.goals,
    queryFn: () => window.solo.invoke('goals:list', {})
  })

  const save = useMutation({
    mutationFn: (draft: GoalInput & { id?: number }) =>
      draft.id
        ? window.solo.invoke('goals:update', { id: draft.id, patch: draft })
        : window.solo.invoke('goals:create', draft),
    onSuccess: () => {
      invalidate(['goals'])
      setEditing(null)
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('goals:delete', { id }),
    onSuccess: () => {
      invalidate(['goals'])
      setDeleting(null)
    }
  })

  const bump = useMutation({
    mutationFn: (args: { id: number; manual: number }) =>
      window.solo.invoke('goals:update', { id: args.id, patch: { manual: args.manual } }),
    onSuccess: () => invalidate(['goals'])
  })

  return (
    <Page
      title="Goals"
      description="What you are aiming at, measured from real numbers."
      actions={
        <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
          <Plus size={14} strokeWidth={1.75} />
          New goal
        </Button>
      }
    >
      {goals.length === 0 ? (
        <Empty
          icon={Target}
          title="No goals set"
          body="Set a revenue target for the tax year, a number of new clients this quarter, or hours you want to bill each month. SoloWrk counts them from your own records — nothing to keep updated."
          action={
            <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
              <Plus size={14} strokeWidth={1.75} />
              Set your first goal
            </Button>
          }
        />
      ) : (
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="grid grid-cols-2 gap-3"
        >
          <AnimatePresence initial={false}>
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onEdit={() => setEditing({ ...goal })}
                onDelete={() => setDeleting(goal)}
                onBump={(manual) => bump.mutate({ id: goal.id, manual })}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <GoalModal
        draft={editing}
        onChange={setEditing}
        onSave={() => editing && save.mutate(editing)}
      />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        body="The goal is removed. Nothing it measured is affected — the invoices, hours and clients it was counting stay exactly as they are."
        confirmLabel="Delete goal"
      />
    </Page>
  )
}

function GoalCard({
  goal,
  onEdit,
  onDelete,
  onBump
}: {
  goal: GoalProgress
  onEdit: () => void
  onDelete: () => void
  onBump: (manual: number) => void
}): React.JSX.Element {
  const met = goal.target > 0 && goal.current >= goal.target

  // Only meaningful once there is a projection to compare against.
  const offPace = goal.projected !== null && goal.target > 0 && goal.projected < goal.target

  return (
    <motion.div layout variants={listItemVariants} transition={transition.layout}>
      <Card className="group p-3.5">
        <div className="mb-2.5 flex items-start gap-2">
          <span
            style={{ backgroundColor: goal.colour }}
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">{goal.name}</p>
            <p className="truncate text-[11px] text-faint">
              {GOAL_KINDS.find((entry) => entry.value === goal.kind)?.label} ·{' '}
              {GOAL_PERIODS.find((entry) => entry.value === goal.period)?.label.toLowerCase()}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label="Edit goal"
              onClick={onEdit}
              className="text-faint hover:text-ink"
            >
              <Pencil size={12} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Delete goal"
              onClick={onDelete}
              className="text-faint hover:text-danger"
            >
              <Trash2 size={12} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="mb-1.5 flex items-baseline gap-2">
          <span className={cn('numeric text-[20px] font-medium', met ? 'text-success' : 'text-ink')}>
            {formatValue(goal.current, goal.kind)}
          </span>
          <span className="numeric text-[12px] text-faint">
            of {formatValue(goal.target, goal.kind)}
          </span>
          {met && <Check size={14} strokeWidth={2.5} className="text-success" />}
        </div>

        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-raised">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${goal.share / 100}%` }}
            transition={transition.page}
            style={{ backgroundColor: met ? '#30A46C' : goal.colour }}
            className="h-full rounded-full"
          />
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          {goal.daysLeft !== null && (
            <span className="text-faint">
              {goal.daysLeft === 0
                ? 'Last day'
                : `${goal.daysLeft} day${goal.daysLeft === 1 ? '' : 's'} left`}
            </span>
          )}

          {goal.projected !== null && !met && (
            <span className={cn('ml-auto', offPace ? 'text-warning' : 'text-success')}>
              On track for {formatValue(goal.projected, goal.kind)}
            </span>
          )}

          {goal.kind === 'custom' && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label="Decrease"
                onClick={() => onBump(Math.max(0, goal.manual - 1))}
                className="grid h-5 w-5 place-items-center rounded-[5px] bg-raised text-muted hover:text-ink"
              >
                −
              </button>
              <button
                type="button"
                aria-label="Increase"
                onClick={() => onBump(goal.manual + 1)}
                className="grid h-5 w-5 place-items-center rounded-[5px] bg-raised text-muted hover:text-ink"
              >
                +
              </button>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

function GoalModal({
  draft,
  onChange,
  onSave
}: {
  draft: (GoalInput & { id?: number }) | null
  onChange: (draft: (GoalInput & { id?: number }) | null) => void
  onSave: () => void
}): React.JSX.Element {
  const set = <K extends keyof GoalInput>(key: K, value: GoalInput[K]): void => {
    if (draft) onChange({ ...draft, [key]: value })
  }

  const kind = draft?.kind ?? 'revenue'
  const meta = GOAL_KINDS.find((entry) => entry.value === kind)

  return (
    <Modal
      open={draft !== null}
      onClose={() => onChange(null)}
      title={draft?.id ? 'Edit goal' : 'New goal'}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={() => onChange(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={!draft?.name?.trim()}>
            {draft?.id ? 'Save' : 'Set goal'}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-3.5">
          <Field label="What are you aiming at?">
            <TextInput
              autoFocus
              value={draft.name ?? ''}
              onChange={(event) => set('name', event.target.value)}
              placeholder="£60k this tax year"
            />
          </Field>

          <Field label="Measured by" hint={meta?.hint}>
            <Select
              value={kind}
              onChange={(value) => set('kind', (value ?? 'revenue') as GoalKind)}
              options={GOAL_KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Target">
              {isMoney(kind) ? (
                <MoneyInput
                  pence={draft.target ?? 0}
                  onChangePence={(pence) => set('target', pence)}
                />
              ) : (
                <NumberInput
                  value={draft.target ?? 0}
                  onChangeValue={(value) => set('target', value)}
                  min={0}
                />
              )}
            </Field>
            <Field label="Over">
              <Select
                value={draft.period ?? 'year'}
                onChange={(value) => set('period', (value ?? 'year') as GoalPeriod)}
                options={GOAL_PERIODS}
              />
            </Field>
          </div>

          {draft.period === 'once' && (
            <Field label="By" hint="A one-off goal runs from today until this date.">
              <TextInput
                type="date"
                value={draft.endsOn ?? ''}
                onChange={(event) => set('endsOn', event.target.value || null)}
              />
            </Field>
          )}

          <Field label="Colour">
            <ColourPicker
              value={draft.colour ?? DEFAULT_ENTITY_COLOUR}
              onChange={(colour) => set('colour', colour)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}

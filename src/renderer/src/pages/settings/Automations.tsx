import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { History, Plus, Trash2, Workflow } from 'lucide-react'
import type {
  AutomationAction,
  AutomationRule,
  AutomationRuleInput,
  AutomationTrigger
} from '@shared/automations'
import {
  ACTION_LABELS,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  TRIGGER_HAS_DAYS,
  TRIGGER_LABELS,
  actionAllowedFor,
  describeRule
} from '@shared/automations'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { Expand } from '@/components/ui/Expand'
import { Field, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Swap } from '@/components/ui/Swap'
import { formatDate } from '@/lib/format'

const BLANK: AutomationRuleInput = {
  name: '',
  trigger: 'invoice_overdue',
  triggerDays: 14,
  action: 'create_task',
  actionText: 'Ring {client} about {name}',
  actionDays: 1,
  enabled: true
}

/**
 * Rules the user writes, listed as sentences rather than as fields.
 *
 * A rule is only worth having if you can tell at a glance what it does, and a
 * row reading "trigger: invoice_overdue · days: 14 · action: create_task" is a
 * database record on a screen. `describeRule` turns the same thing into English,
 * and the form shows it live, so a rule that will never fire looks wrong while
 * you are writing it rather than being discovered as silence three weeks later.
 */
export function Automations(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<AutomationRuleInput | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showing, setShowing] = useState<number | null>(null)

  const { data: rules = [] } = useQuery({
    queryKey: ['automations'],
    queryFn: () => window.solo.invoke('automations:list')
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['automations'] })
  }

  const save = useMutation({
    mutationFn: (input: AutomationRuleInput) =>
      editingId === null
        ? window.solo.invoke('automations:create', input)
        : window.solo.invoke('automations:update', { id: editingId, patch: input }),
    onSuccess: () => {
      setEditing(null)
      setEditingId(null)
      refresh()
    }
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      window.solo.invoke('automations:update', { id, patch: { enabled } }),
    onSuccess: refresh
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('automations:delete', { id }),
    onSuccess: refresh
  })

  return (
    <>
      <Card>
        <CardHeader
          title="Rules"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingId(null)
                setEditing({ ...BLANK })
              }}
            >
              <Plus size={13} strokeWidth={1.75} />
              New rule
            </Button>
          }
        />

        <p className="mb-3.5 text-[12.5px] leading-relaxed text-muted">
          Small things that happen without you. Rules are checked once a day and act on each
          thing once — a rule made today leaves everything that was already true alone, so
          writing one never sets off a pile of tasks about last year.
        </p>

        <Swap
          empty={rules.length === 0}
          fallback={
            <Empty
              icon={Workflow}
              title="No rules yet"
              body="Draft the final invoice when a project finishes. Make a task to ring someone when an invoice goes a fortnight late. Two or three rules is usually the lot."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditingId(null)
                    setEditing({ ...BLANK })
                  }}
                >
                  <Plus size={14} strokeWidth={1.75} />
                  Write your first rule
                </Button>
              }
            />
          }
        >
          <div className="flex flex-col gap-1.5">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-control border border-line bg-raised">
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(rule.id)
                        setEditing(toInput(rule))
                      }}
                      className="block w-full text-left"
                    >
                      <p className={rule.enabled ? 'text-[13px] text-ink' : 'text-[13px] text-faint'}>
                        {rule.name || 'Untitled rule'}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                        {describeRule(rule)}
                      </p>
                    </button>
                  </div>

                  <button
                    type="button"
                    aria-label={`History for ${rule.name}`}
                    onClick={() => setShowing(showing === rule.id ? null : rule.id)}
                    className="mt-0.5 text-faint transition-colors hover:text-ink"
                  >
                    <History size={14} strokeWidth={1.75} />
                  </button>

                  <button
                    type="button"
                    aria-label={`Delete ${rule.name}`}
                    onClick={() => remove.mutate(rule.id)}
                    className="mt-0.5 text-faint transition-colors hover:text-danger"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>

                  <Toggle
                    checked={rule.enabled}
                    onChange={(enabled) => toggle.mutate({ id: rule.id, enabled })}
                    label={`${rule.name || 'This rule'} is on`}
                    hideLabel
                  />
                </div>

                <AnimatePresence initial={false}>
                  {showing === rule.id && (
                    <Expand contentClassName="border-t border-line px-3 py-2.5">
                      <RuleHistory id={rule.id} />
                    </Expand>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </Swap>
      </Card>

      <RuleForm
        draft={editing}
        onChange={setEditing}
        onClose={() => {
          setEditing(null)
          setEditingId(null)
        }}
        onSave={() => editing && save.mutate(editing)}
        saving={save.isPending}
        error={save.error?.message ?? null}
      />
    </>
  )
}

function toInput(rule: AutomationRule): AutomationRuleInput {
  return {
    name: rule.name,
    trigger: rule.trigger,
    triggerDays: rule.triggerDays,
    action: rule.action,
    actionText: rule.actionText,
    actionDays: rule.actionDays,
    enabled: rule.enabled
  }
}

/**
 * What this rule has actually done.
 *
 * A feature that acts on your behalf has to be able to show its working. This
 * is the only answer to "why is there a task about this?", and without it the
 * honest response to a rule doing something unexpected is to turn the whole
 * thing off.
 */
function RuleHistory({ id }: { id: number }): React.JSX.Element {
  const { data: history = [] } = useQuery({
    queryKey: ['automations', 'history', id],
    queryFn: () => window.solo.invoke('automations:history', { id })
  })

  if (history.length === 0) {
    return <p className="text-[11.5px] text-faint">Nothing yet.</p>
  }

  return (
    <div className="flex flex-col gap-1">
      {history.map((entry) => (
        <div key={`${entry.subject}-${entry.ranAt}`} className="flex justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{entry.outcome}</span>
          <span className="shrink-0 text-[11px] text-faint">{formatDate(entry.ranAt)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * The form.
 *
 * Two things it does that a plain set of fields would not. The sentence at the
 * bottom reads the rule back, so what the app understood is visible before it
 * is saved. And the count says how many things the rule already matches and
 * will leave alone — which makes the backfill a stated fact rather than a
 * surprise, and heads off the reasonable worry that saving this is about to
 * generate forty tasks.
 */
function RuleForm({
  draft,
  onChange,
  onClose,
  onSave,
  saving,
  error
}: {
  draft: AutomationRuleInput | null
  onChange: (draft: AutomationRuleInput) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
  error: string | null
}): React.JSX.Element {
  const { data: matches = [] } = useQuery({
    queryKey: ['automations', 'preview', draft?.trigger, draft?.triggerDays],
    queryFn: () =>
      window.solo.invoke('automations:preview', {
        trigger: draft!.trigger,
        triggerDays: draft!.triggerDays
      }),
    enabled: draft !== null
  })

  const set = <K extends keyof AutomationRuleInput>(
    key: K,
    value: AutomationRuleInput[K]
  ): void => {
    if (draft) onChange({ ...draft, [key]: value })
  }

  return (
    <Modal
      open={draft !== null}
      onClose={onClose}
      title="Rule"
      description="When something happens, do something about it."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            Save rule
          </Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-3.5">
          <Field label="Name it" hint="For you, so a list of rules is readable.">
            <TextInput
              value={draft.name}
              placeholder="Chase the quiet ones"
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>

          <div className="flex gap-2">
            <div className="flex-1">
              <Field label="When">
                <Select
                  value={draft.trigger}
                  options={AUTOMATION_TRIGGERS.map((value) => ({
                    value,
                    label: TRIGGER_LABELS[value]
                  }))}
                  onChange={(value) => {
                    const trigger = (value ?? 'invoice_overdue') as AutomationTrigger
                    onChange({
                      ...draft,
                      trigger,
                      // An action that no longer makes sense here would be
                      // saved and then refused, so it moves out of the way now.
                      action: actionAllowedFor(draft.action, trigger)
                        ? draft.action
                        : 'create_task'
                    })
                  }}
                />
              </Field>
            </div>

            {TRIGGER_HAS_DAYS[draft.trigger] && (
              <div className="w-[92px]">
                <Field label="Days">
                  <NumberInput
                    value={draft.triggerDays}
                    onChangeValue={(value) => set('triggerDays', value)}
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="Then">
            <Select
              value={draft.action}
              options={AUTOMATION_ACTIONS.filter((action) =>
                actionAllowedFor(action, draft.trigger)
              ).map((value) => ({ value, label: ACTION_LABELS[value] }))}
              onChange={(value) => set('action', (value ?? 'create_task') as AutomationAction)}
            />
          </Field>

          {draft.action !== 'draft_invoice' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Field
                  label={draft.action === 'notify' ? 'Say' : 'Task title'}
                  hint="Use {name}, {client}, {amount} and {days} to fill in the details."
                >
                  <TextInput
                    value={draft.actionText}
                    onChange={(event) => set('actionText', event.target.value)}
                  />
                </Field>
              </div>

              {draft.action === 'create_task' && (
                <div className="w-[92px]">
                  <Field label="Due in">
                    <NumberInput
                      value={draft.actionDays ?? 0}
                      onChangeValue={(value) => set('actionDays', value)}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          <div className="rounded-control border border-line bg-raised px-3 py-2.5">
            <p className="text-[12px] leading-relaxed text-ink">{describeRule(draft)}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              {matches.length === 0
                ? 'Nothing matches this today.'
                : `${matches.length} ${matches.length === 1 ? 'thing matches' : 'things match'} this today. Those are left alone — the rule only acts on what happens from now on.`}
            </p>
          </div>

          {error && (
            <p className="rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5 text-[12px] text-ink">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

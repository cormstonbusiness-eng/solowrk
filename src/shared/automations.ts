import type { Pence } from './types'

/**
 * The vocabulary of a rule, shared so the form and the engine cannot disagree
 * about what a rule can say.
 */

export const AUTOMATION_TRIGGERS = [
  'invoice_overdue',
  'invoice_paid',
  'project_completed',
  'task_overdue',
  'document_expiring'
] as const

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number]

export const AUTOMATION_ACTIONS = ['create_task', 'notify', 'draft_invoice'] as const

export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number]

export interface AutomationRule {
  id: number
  name: string
  trigger: AutomationTrigger
  /** Days late, or days before expiry. Ignored by triggers with no horizon. */
  triggerDays: number
  action: AutomationAction
  /** Task title or notification wording, with tokens still in it. */
  actionText: string
  /** A created task is due this many days out. Null means no due date. */
  actionDays: number | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type AutomationRuleInput = Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt'>

/** What a rule matched, flattened so every action reads the same shape. */
export interface AutomationSubject {
  /** 'invoice:12' — typed, because the same number means different things. */
  key: string
  id: number
  /** The invoice number, project name, task title. */
  label: string
  clientName: string | null
  projectId: number | null
  amount: Pence | null
  /** Days late, or days until expiry. Null where neither applies. */
  days: number | null
}

/**
 * Which triggers take a number of days.
 *
 * Used by the form to decide whether to show the field at all, because a
 * disabled input somebody cannot use is worse than no input: it invites the
 * question of what it would do.
 */
export const TRIGGER_HAS_DAYS: Record<AutomationTrigger, boolean> = {
  invoice_overdue: true,
  invoice_paid: false,
  project_completed: false,
  task_overdue: true,
  document_expiring: true
}

/**
 * Which triggers an action makes sense for.
 *
 * `draft_invoice` needs a project to bill and unbilled time to bill for, so it
 * is only offered where the subject is a project. Offering it everywhere and
 * failing quietly at run time would be a rule that looks like it works.
 */
export const ACTION_NEEDS_PROJECT: Record<AutomationAction, boolean> = {
  create_task: false,
  notify: false,
  draft_invoice: true
}

export function actionAllowedFor(action: AutomationAction, trigger: AutomationTrigger): boolean {
  return !ACTION_NEEDS_PROJECT[action] || trigger === 'project_completed'
}

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  invoice_overdue: 'An invoice goes overdue by',
  invoice_paid: 'An invoice is paid',
  project_completed: 'A project is marked complete',
  task_overdue: 'A task goes overdue by',
  document_expiring: 'A document is due to expire in'
}

export const ACTION_LABELS: Record<AutomationAction, string> = {
  create_task: 'Create a task',
  notify: 'Tell me',
  draft_invoice: 'Draft an invoice from unbilled time'
}

/**
 * Fill the tokens in a rule's wording.
 *
 * Deliberately forgiving: an unknown token is left exactly as typed rather than
 * replaced with "undefined" or stripped. Somebody who writes `{clientname}` gets
 * a task with `{clientname}` in the title, sees what went wrong, and fixes it —
 * which beats a task that silently says "Chase undefined".
 *
 * A token with no value for this subject becomes an empty string, because a
 * project with no client should produce "Invoice for" rather than "Invoice for
 * {client}".
 */
export function fillTokens(text: string, subject: AutomationSubject): string {
  const values: Record<string, string> = {
    name: subject.label,
    client: subject.clientName ?? '',
    days: subject.days === null ? '' : String(subject.days),
    amount:
      subject.amount === null
        ? ''
        : `£${(subject.amount / 100).toLocaleString('en-GB', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}`
  }

  return text
    .replace(/\{(\w+)\}/g, (match, token: string) => values[token] ?? match)
    // Filling an empty token can leave a double space or a trailing one.
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * The rule read back as a sentence.
 *
 * The same job the chase-schedule hint does: show what was understood rather
 * than echo what was typed, so a rule that will never fire looks wrong in the
 * form instead of being discovered as silence three weeks later.
 */
export function describeRule(rule: {
  trigger: AutomationTrigger
  triggerDays: number
  action: AutomationAction
  actionText: string
}): string {
  const when = TRIGGER_HAS_DAYS[rule.trigger]
    ? `${TRIGGER_LABELS[rule.trigger]} ${rule.triggerDays} day${rule.triggerDays === 1 ? '' : 's'}`
    : TRIGGER_LABELS[rule.trigger]

  const then =
    rule.action === 'draft_invoice'
      ? 'draft an invoice from any unbilled time on it'
      : rule.action === 'notify'
        ? `tell you: “${rule.actionText || '…'}”`
        : `create a task: “${rule.actionText || '…'}”`

  return `${when}, ${then}.`
}

import type { Database, Row } from '../db'
import type {
  AutomationRule,
  AutomationRuleInput,
  AutomationSubject,
  AutomationTrigger
} from '@shared/automations'
import { actionAllowedFor, fillTokens } from '@shared/automations'
import { addDays, nowStamp } from '@shared/calendar'
import { secondsToHours } from '@shared/money'
import { today } from '@shared/taxYear'
import { createInvoice } from './invoices'
import { createTask } from './tasks'
import { unbilledFor } from './time'

/**
 * When this, then that.
 *
 * Evaluated as state rather than as events. Nothing in the app raises "an
 * invoice went overdue" — overdue is not a status, it is a due date and a
 * calendar, and the app is quite often shut on the day it happens. So instead
 * of listening for something, each rule asks a question every morning: *what
 * matches me now that I have not already dealt with?*
 *
 * That has two consequences worth knowing. A rule catches up on things that
 * became true while the laptop was closed, which is right. And a rule needs a
 * memory of what it has acted on, or it would create the same task every
 * morning for as long as an invoice stayed unpaid — which is the exact
 * behaviour that makes people switch a feature like this off. The memory is
 * `automation_runs`, and its primary key is the rule.
 */

interface RuleRow extends Row {
  id: number
  name: string
  trigger: string
  trigger_days: number
  action: string
  action_text: string
  action_days: number | null
  enabled: number
  created_at: string
  updated_at: string
}

function toRule(row: RuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger as AutomationRule['trigger'],
    triggerDays: row.trigger_days,
    action: row.action as AutomationRule['action'],
    actionText: row.action_text,
    actionDays: row.action_days,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listRules(db: Database): AutomationRule[] {
  return db
    .all<RuleRow>('SELECT * FROM automation_rules ORDER BY created_at DESC')
    .map(toRule)
}

export function getRule(db: Database, id: number): AutomationRule {
  const row = db.get<RuleRow>('SELECT * FROM automation_rules WHERE id = ?', [id])
  if (!row) throw new Error(`No rule ${id}`)
  return toRule(row)
}

/**
 * Save a rule, and immediately mark everything it already matches as done.
 *
 * The single most important line in this file. Without it, saving *when an
 * invoice goes 14 days overdue, create a task to ring them* against a database
 * with three years of history creates fifty tasks in the same second — and the
 * user's first experience of automation is undoing it.
 *
 * A rule means "when this happens", and something that was already true when
 * the rule was written did not happen after it. So the backfill records every
 * current match with an empty outcome, which reads in the history as *already
 * true when you made this* rather than as *this ran*.
 */
export function createRule(db: Database, input: AutomationRuleInput): AutomationRule {
  if (!actionAllowedFor(input.action, input.trigger)) {
    throw new Error('That action needs a project to work on.')
  }

  db.run(
    `INSERT INTO automation_rules (name, trigger, trigger_days, action, action_text,
                                   action_days, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.trigger,
      input.triggerDays,
      input.action,
      input.actionText,
      input.actionDays,
      input.enabled ? 1 : 0,
      nowStamp(),
      nowStamp()
    ]
  )

  const rule = getRule(db, db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id)
  backfillRule(db, rule)
  return rule
}

/** Everything this rule matches today, written off as already handled. */
export function backfillRule(db: Database, rule: AutomationRule, day = today()): number {
  const matches = findSubjects(db, rule, day)
  for (const subject of matches) recordRun(db, rule.id, subject.key, '')
  return matches.length
}

export function updateRule(
  db: Database,
  id: number,
  patch: Partial<AutomationRuleInput>
): AutomationRule {
  const current = getRule(db, id)
  const next = { ...current, ...patch }

  if (!actionAllowedFor(next.action, next.trigger)) {
    throw new Error('That action needs a project to work on.')
  }

  db.run(
    `UPDATE automation_rules
        SET name = ?, trigger = ?, trigger_days = ?, action = ?, action_text = ?,
            action_days = ?, enabled = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.name,
      next.trigger,
      next.triggerDays,
      next.action,
      next.actionText,
      next.actionDays,
      next.enabled ? 1 : 0,
      nowStamp(),
      id
    ]
  )

  /**
   * Changing what a rule watches makes it a different rule, so its memory of
   * what it has acted on no longer applies — and the new question has to be
   * backfilled the same way a new rule is, or widening "14 days" to "7 days"
   * would fire at everything already between the two.
   */
  if (patch.trigger !== undefined || patch.triggerDays !== undefined) {
    db.run('DELETE FROM automation_runs WHERE rule_id = ?', [id])
    backfillRule(db, getRule(db, id))
  }

  return getRule(db, id)
}

export function deleteRule(db: Database, id: number): void {
  db.run('DELETE FROM automation_rules WHERE id = ?', [id])
}

function recordRun(db: Database, ruleId: number, subject: string, outcome: string): boolean {
  try {
    db.run(
      'INSERT INTO automation_runs (rule_id, subject, ran_at, outcome) VALUES (?, ?, ?, ?)',
      [ruleId, subject, nowStamp(), outcome]
    )
    return true
  } catch (error) {
    // The primary key doing its job: this rule has already dealt with this.
    if (String(error).includes('UNIQUE') || String(error).includes('PRIMARY KEY')) return false
    throw error
  }
}

/**
 * What a rule matches right now.
 *
 * Every query returns the same flattened shape, so the actions never have to
 * know which table their subject came from. `days` is computed in SQL against
 * the day being evaluated rather than against `now`, so a sweep can be run for
 * a past date in a test and get the answer that date would have given.
 */
export function findSubjects(
  db: Database,
  rule: { trigger: AutomationTrigger; triggerDays: number },
  day = today()
): AutomationSubject[] {
  const rows = subjectQuery(db, rule, day)
  return rows
}

interface SubjectRow extends Row {
  id: number
  label: string
  client_name: string | null
  project_id: number | null
  amount: number | null
  days: number | null
}

function shape(kind: string, rows: SubjectRow[]): AutomationSubject[] {
  return rows.map((row) => ({
    key: `${kind}:${row.id}`,
    id: row.id,
    label: row.label,
    clientName: row.client_name,
    projectId: row.project_id,
    amount: row.amount,
    days: row.days === null ? null : Math.round(row.days)
  }))
}

function subjectQuery(
  db: Database,
  rule: { trigger: AutomationTrigger; triggerDays: number },
  day: string
): AutomationSubject[] {
  // julianday differences give whole days without any timezone in the middle,
  // which matters because every date in this app is a yyyy-mm-dd string and
  // building a Date from one can shift it across a boundary.
  switch (rule.trigger) {
    case 'invoice_overdue':
      return shape(
        'invoice',
        db.all<SubjectRow>(
          `SELECT i.id, i.number AS label, c.name AS client_name, i.project_id,
                  i.gross AS amount, julianday(?) - julianday(i.due_date) AS days
             FROM invoices i
             LEFT JOIN clients c ON c.id = i.client_id
            WHERE i.status = 'sent' AND i.paid_at IS NULL
              AND julianday(?) - julianday(i.due_date) >= ?
            ORDER BY i.due_date`,
          [day, day, rule.triggerDays]
        )
      )

    case 'invoice_paid':
      return shape(
        'invoice',
        db.all<SubjectRow>(
          `SELECT i.id, i.number AS label, c.name AS client_name, i.project_id,
                  i.gross AS amount, NULL AS days
             FROM invoices i
             LEFT JOIN clients c ON c.id = i.client_id
            WHERE i.status = 'paid' AND i.paid_at IS NOT NULL
            ORDER BY i.paid_at`,
          []
        )
      )

    case 'project_completed':
      return shape(
        'project',
        db.all<SubjectRow>(
          `SELECT p.id, p.name AS label, c.name AS client_name, p.id AS project_id,
                  NULL AS amount, NULL AS days
             FROM projects p
             LEFT JOIN clients c ON c.id = p.client_id
            WHERE p.status = 'completed' AND p.archived = 0
            ORDER BY p.updated_at`,
          []
        )
      )

    case 'task_overdue':
      return shape(
        'task',
        db.all<SubjectRow>(
          `SELECT t.id, t.title AS label, c.name AS client_name, t.project_id,
                  NULL AS amount, julianday(?) - julianday(t.due_at) AS days
             FROM tasks t
             LEFT JOIN projects p ON p.id = t.project_id
             LEFT JOIN clients c ON c.id = p.client_id
            WHERE t.status != 'done' AND t.archived = 0 AND t.due_at IS NOT NULL
              AND julianday(?) - julianday(t.due_at) >= ?
            ORDER BY t.due_at`,
          [day, day, rule.triggerDays]
        )
      )

    case 'document_expiring':
      return shape(
        'document',
        db.all<SubjectRow>(
          `SELECT d.id, d.title AS label, NULL AS client_name, NULL AS project_id,
                  NULL AS amount, julianday(d.expiry_at) - julianday(?) AS days
             FROM documents d
            WHERE d.expiry_at IS NOT NULL
              AND julianday(d.expiry_at) - julianday(?) <= ?
            ORDER BY d.expiry_at`,
          [day, day, rule.triggerDays]
        )
      )
  }
}

export interface AutomationOutcome {
  ruleId: number
  ruleName: string
  /** Carried so the caller knows which of these it has to raise a notification for. */
  action: AutomationRule['action']
  subject: string
  /** What happened, in the words the user will read in the history. */
  outcome: string
}

/**
 * Run every enabled rule.
 *
 * The record is written **before** the action, not after. If creating a task
 * throws halfway through, the alternative would be a rule that tries the same
 * failing thing every morning forever; recording first means it is attempted
 * once, and a failure is a thing to notice rather than a thing to repeat.
 */
export function runAutomations(db: Database, day = today()): AutomationOutcome[] {
  const results: AutomationOutcome[] = []

  for (const rule of listRules(db)) {
    if (!rule.enabled) continue

    for (const subject of findSubjects(db, rule, day)) {
      if (!recordRun(db, rule.id, subject.key, 'pending')) continue

      let outcome: string
      try {
        outcome = performAction(db, rule, subject, day)
      } catch (error) {
        outcome = `Failed: ${error instanceof Error ? error.message : String(error)}`
      }

      db.run('UPDATE automation_runs SET outcome = ? WHERE rule_id = ? AND subject = ?', [
        outcome,
        rule.id,
        subject.key
      ])

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        action: rule.action,
        subject: subject.key,
        outcome
      })
    }
  }

  return results
}

function performAction(
  db: Database,
  rule: AutomationRule,
  subject: AutomationSubject,
  day: string
): string {
  const text = fillTokens(rule.actionText, subject)

  switch (rule.action) {
    case 'create_task': {
      const title = text || `Follow up: ${subject.label}`
      createTask(db, {
        title,
        projectId: subject.projectId,
        dueAt: rule.actionDays === null ? undefined : addDays(day, rule.actionDays)
      })
      return `Created task “${title}”`
    }

    case 'notify':
      // The notification itself is raised by the caller, which owns the window
      // handle. This only says what to say — a service that reached for the UI
      // would be a service that cannot be tested.
      return text || `${subject.label} needs a look`

    case 'draft_invoice': {
      if (subject.projectId === null) return 'No project to bill'

      const unbilled = unbilledFor(db, subject.projectId)
      // Nothing to bill is a perfectly good outcome and not a failure. It is
      // also the common one: plenty of projects are fixed-price and carry no
      // tracked time at all.
      if (unbilled.entries.length === 0) return 'No unbilled time to invoice'

      /**
       * Grouped by rate, one line per rate, the same way the Pull time button
       * does it on the invoice editor. Two paths producing differently-shaped
       * invoices from the same time entries would be a difference nobody could
       * explain — and a project billed at two rates genuinely is two lines.
       */
      const byRate = unbilled.entries.reduce<Record<number, { seconds: number; ids: number[] }>>(
        (groups, entry) => {
          const group = (groups[entry.rate] ??= { seconds: 0, ids: [] })
          group.seconds += entry.duration
          group.ids.push(entry.id)
          return groups
        },
        {}
      )

      const invoice = createInvoice(db, {
        clientId: clientIdFor(db, subject.projectId),
        projectId: subject.projectId,
        // A draft, always. The point is that the user does not have to
        // remember, not that invoices leave without being read — and an
        // invoice sent on a rule would be the app deciding a job is finished.
        status: 'draft',
        issueDate: day,
        lines: Object.entries(byRate).map(([rate, group]) => ({
          description: `Time — ${secondsToHours(group.seconds)} hours`,
          quantity: secondsToHours(group.seconds),
          unitPrice: Number(rate),
          kind: 'time' as const,
          timeEntryIds: group.ids
        }))
      })

      return `Drafted ${invoice.number} for ${secondsToHours(unbilled.seconds)} hours`
    }
  }
}

function clientIdFor(db: Database, projectId: number): number | null {
  return (
    db.get<{ client_id: number | null } & Row>('SELECT client_id FROM projects WHERE id = ?', [
      projectId
    ])?.client_id ?? null
  )
}

/** What a rule has done, newest first, for the history panel. */
export function ruleHistory(
  db: Database,
  ruleId: number,
  limit = 20
): { subject: string; ranAt: string; outcome: string }[] {
  return db
    .all<{ subject: string; ran_at: string; outcome: string } & Row>(
      `SELECT subject, ran_at, outcome FROM automation_runs
        WHERE rule_id = ? AND outcome != ''
        ORDER BY ran_at DESC LIMIT ?`,
      [ruleId, limit]
    )
    .map((row) => ({ subject: row.subject, ranAt: row.ran_at, outcome: row.outcome }))
}

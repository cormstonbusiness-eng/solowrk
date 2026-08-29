import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db'
import {
  createRule,
  deleteRule,
  findSubjects,
  listRules,
  ruleHistory,
  runAutomations,
  updateRule
} from './automations'
import type { AutomationRuleInput } from '@shared/automations'

/**
 * Automation rules.
 *
 * The feature has one catastrophic failure and one merely annoying one, and
 * most of what follows is about those two. Catastrophic: a rule saved against
 * three years of history fires on all of it and creates fifty tasks in a
 * second, so the user's first experience of automation is undoing it. Annoying:
 * a rule with no memory recreates the same task every morning for as long as an
 * invoice stays unpaid.
 */

const TODAY = '2026-08-25'

function client(db: Database, name = 'Acme Ltd'): number {
  db.run(
    `INSERT INTO clients (name, contact_name, folder, relationship_stage, created_at, updated_at)
     VALUES (?, 'Dana', ?, 'active', datetime('now'), datetime('now'))`,
    [name, `Clients\\${name}`]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function invoice(db: Database, number: string, dueDate: string, status = 'sent'): number {
  db.run(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, gross, created_at, updated_at)
     VALUES (?, 1, ?, '2026-06-01', ?, 120000, datetime('now'), datetime('now'))`,
    [number, status, dueDate]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

function project(db: Database, name: string, status = 'active'): number {
  db.run(
    `INSERT INTO projects (client_id, name, status, colour, folder, created_at, updated_at)
     VALUES (1, ?, ?, '#FF7A2F', ?, datetime('now'), datetime('now'))`,
    [name, status, `Clients\\Acme\\${name}`]
  )
  return db.get<{ id: number }>('SELECT last_insert_rowid() AS id')!.id
}

const CHASE_RULE: AutomationRuleInput = {
  name: 'Ring them',
  trigger: 'invoice_overdue',
  triggerDays: 14,
  action: 'create_task',
  actionText: 'Ring {client} about {name}',
  actionDays: 1,
  enabled: true
}

describe('a new rule does not act on history', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  it('creates nothing for what was already true when it was written', () => {
    // The one that would make somebody uninstall. Three old unpaid invoices,
    // then a rule about overdue invoices: it must not produce three tasks.
    invoice(db, 'INV-1', '2026-01-01')
    invoice(db, 'INV-2', '2026-02-01')
    invoice(db, 'INV-3', '2026-03-01')

    createRule(db, CHASE_RULE)

    expect(runAutomations(db, TODAY)).toEqual([])
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n).toBe(0)
  })

  it('acts on what becomes true afterwards', () => {
    invoice(db, 'INV-1', '2026-01-01')
    createRule(db, CHASE_RULE)

    // A new invoice falls due and goes past the threshold.
    invoice(db, 'INV-2', '2026-08-01')

    const results = runAutomations(db, TODAY)

    expect(results).toHaveLength(1)
    expect(results[0]!.subject).toBe('invoice:2')
  })

  it('records the backfill as something other than a run', () => {
    // The history should be able to say "already true when you made this"
    // rather than claiming to have done something.
    invoice(db, 'INV-1', '2026-01-01')
    const rule = createRule(db, CHASE_RULE)

    expect(ruleHistory(db, rule.id)).toEqual([])
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM automation_runs')!.n).toBe(1)
  })
})

describe('a rule fires once per thing', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  it('does not create the same task every morning', () => {
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')

    expect(runAutomations(db, TODAY)).toHaveLength(1)
    expect(runAutomations(db, TODAY)).toEqual([])
    expect(runAutomations(db, '2026-08-26')).toEqual([])
    expect(runAutomations(db, '2026-09-30')).toEqual([])

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n).toBe(1)
  })

  it('treats two invoices as two things', () => {
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    invoice(db, 'INV-2', '2026-08-02')

    expect(runAutomations(db, TODAY)).toHaveLength(2)
  })

  it('forgets nothing when the rule is disabled and enabled again', () => {
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    runAutomations(db, TODAY)

    const rule = listRules(db)[0]!
    updateRule(db, rule.id, { enabled: false })
    updateRule(db, rule.id, { enabled: true })

    expect(runAutomations(db, TODAY)).toEqual([])
  })
})

describe('changing what a rule watches', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  it('does not fire at everything between the old threshold and the new one', () => {
    // Widening 14 days to 3 suddenly matches invoices that were sitting
    // quietly inside the old gap. That is a different question, so it gets
    // backfilled like a new rule rather than acted on.
    invoice(db, 'INV-1', '2026-08-18') // 7 days late: inside 14, outside 3
    const rule = createRule(db, CHASE_RULE)

    updateRule(db, rule.id, { triggerDays: 3 })

    expect(runAutomations(db, TODAY)).toEqual([])
  })

  it('leaves the memory alone when only the wording changes', () => {
    // Rewording is not a new question, so it must not undo what has been done.
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    runAutomations(db, TODAY)

    updateRule(db, listRules(db)[0]!.id, { actionText: 'Chase {name}' })

    expect(runAutomations(db, TODAY)).toEqual([])
  })
})

describe('what a rule can watch', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  it('counts overdue days from the due date, not from when it was issued', () => {
    invoice(db, 'INV-1', '2026-08-11') // exactly 14 days before TODAY

    const found = findSubjects(db, { trigger: 'invoice_overdue', triggerDays: 14 }, TODAY)

    expect(found).toHaveLength(1)
    expect(found[0]!.days).toBe(14)
  })

  it('does not match a day early', () => {
    // The edge somebody would notice: a rule set to 14 days should not fire on
    // day 13, because "14 days overdue" is a promise about a date.
    invoice(db, 'INV-1', '2026-08-12')

    expect(findSubjects(db, { trigger: 'invoice_overdue', triggerDays: 14 }, TODAY)).toEqual([])
  })

  it('ignores an invoice that has been paid', () => {
    const id = invoice(db, 'INV-1', '2026-01-01')
    db.run(`UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?`, ['2026-02-01', id])

    expect(findSubjects(db, { trigger: 'invoice_overdue', triggerDays: 14 }, TODAY)).toEqual([])
  })

  it('ignores a draft, which the client has never seen', () => {
    invoice(db, 'INV-1', '2026-01-01', 'draft')

    expect(findSubjects(db, { trigger: 'invoice_overdue', triggerDays: 0 }, TODAY)).toEqual([])
  })

  it('finds a completed project, and not an archived one', () => {
    project(db, 'Live', 'active')
    project(db, 'Done', 'completed')
    const archived = project(db, 'Old', 'completed')
    db.run('UPDATE projects SET archived = 1 WHERE id = ?', [archived])

    const found = findSubjects(db, { trigger: 'project_completed', triggerDays: 0 }, TODAY)

    expect(found.map((s) => s.label)).toEqual(['Done'])
  })
})

describe('what a rule does', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  it('fills the wording in from the thing it matched', () => {
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    runAutomations(db, TODAY)

    const task = db.get<{ title: string }>('SELECT title FROM tasks')!
    expect(task.title).toBe('Ring Acme Ltd about INV-1')
  })

  it('gives the task a due date the rule asked for', () => {
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    runAutomations(db, TODAY)

    const task = db.get<{ due_at: string }>('SELECT due_at FROM tasks')!
    expect(task.due_at).toContain('2026-08-26')
  })

  it('hangs the task on the project when there is one', () => {
    const projectId = project(db, 'Rebrand')
    createRule(db, { ...CHASE_RULE, actionText: 'Invoice {name}' })
    invoice(db, 'INV-1', '2026-08-01')
    db.run('UPDATE invoices SET project_id = ? WHERE number = ?', [projectId, 'INV-1'])

    runAutomations(db, TODAY)

    expect(db.get<{ project_id: number }>('SELECT project_id FROM tasks')!.project_id).toBe(
      projectId
    )
  })

  it('still writes a sensible title when the wording is left empty', () => {
    createRule(db, { ...CHASE_RULE, actionText: '' })
    invoice(db, 'INV-1', '2026-08-01')
    runAutomations(db, TODAY)

    expect(db.get<{ title: string }>('SELECT title FROM tasks')!.title).toContain('INV-1')
  })

  it('refuses an action that needs a project it will never have', () => {
    // "Draft an invoice from unbilled time" needs a project. Offering it
    // against overdue invoices would be a rule that looks like it works.
    expect(() =>
      createRule(db, { ...CHASE_RULE, action: 'draft_invoice' })
    ).toThrow()
  })

  it('records a failure once rather than retrying it every morning', () => {
    createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    // Make task creation fail by removing the table out from under it.
    db.run('DROP TABLE tasks')

    const results = runAutomations(db, TODAY)

    expect(results[0]!.outcome).toContain('Failed')
    expect(runAutomations(db, TODAY)).toEqual([])
  })
})

describe('drafting an invoice off a finished project', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  const RULE: AutomationRuleInput = {
    name: 'Bill it',
    trigger: 'project_completed',
    triggerDays: 0,
    action: 'draft_invoice',
    actionText: '',
    actionDays: null,
    enabled: true
  }

  function logTime(db: Database, projectId: number, seconds: number, rate: number): void {
    db.run(
      `INSERT INTO time_entries (project_id, started_at, ended_at, duration, rate, notes, billable, created_at, updated_at)
       VALUES (?, '2026-08-01T09:00:00', '2026-08-01T10:00:00', ?, ?, '', 1, datetime('now'), datetime('now'))`,
      [projectId, seconds, rate]
    )
  }

  it('bills the unbilled time', () => {
    createRule(db, RULE)
    const id = project(db, 'Rebrand')
    logTime(db, id, 3600, 6000)
    logTime(db, id, 1800, 6000)
    db.run(`UPDATE projects SET status = 'completed' WHERE id = ?`, [id])

    const [result] = runAutomations(db, TODAY)

    expect(result!.outcome).toContain('Drafted')
    const invoice = db.get<{ status: string; net: number }>('SELECT status, net FROM invoices')!
    // A draft, always. An invoice sent on a rule would be the app deciding a
    // job is finished.
    expect(invoice.status).toBe('draft')
    expect(invoice.net).toBe(9000)
  })

  it('makes one line per rate, not one per entry', () => {
    createRule(db, RULE)
    const id = project(db, 'Rebrand')
    logTime(db, id, 3600, 6000)
    logTime(db, id, 3600, 6000)
    logTime(db, id, 3600, 9000)
    db.run(`UPDATE projects SET status = 'completed' WHERE id = ?`, [id])

    runAutomations(db, TODAY)

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM invoice_lines')!.n).toBe(2)
  })

  it('says so plainly when there is nothing to bill', () => {
    // The common case, not a failure: plenty of projects are fixed-price and
    // carry no tracked time at all.
    createRule(db, RULE)
    const id = project(db, 'Fixed price')
    db.run(`UPDATE projects SET status = 'completed' WHERE id = ?`, [id])

    const [result] = runAutomations(db, TODAY)

    expect(result!.outcome).toContain('No unbilled time')
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM invoices')!.n).toBe(0)
  })

  it('does not bill the same project twice', () => {
    createRule(db, RULE)
    const id = project(db, 'Rebrand')
    logTime(db, id, 3600, 6000)
    db.run(`UPDATE projects SET status = 'completed' WHERE id = ?`, [id])

    runAutomations(db, TODAY)
    runAutomations(db, '2026-08-26')

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM invoices')!.n).toBe(1)
  })
})

describe('housekeeping', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    client(db)
  })
  afterEach(() => db.close())

  it('takes the history with the rule', () => {
    const rule = createRule(db, CHASE_RULE)
    invoice(db, 'INV-1', '2026-08-01')
    runAutomations(db, TODAY)

    deleteRule(db, rule.id)

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM automation_runs')!.n).toBe(0)
  })

  it('skips a disabled rule entirely', () => {
    createRule(db, { ...CHASE_RULE, enabled: false })
    invoice(db, 'INV-1', '2026-08-01')

    expect(runAutomations(db, TODAY)).toEqual([])
  })
})

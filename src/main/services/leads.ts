import type { Database, Row } from '../db'
import type { Lead, LeadInput, LeadWithHealth, PipelineReport } from '@shared/types'
import {
  bySource,
  conversion,
  leadHealth,
  lostReasons,
  pipelineValue,
  type LostReason,
  type Stage
} from '@shared/pipeline'
import { today } from '@shared/taxYear'
import { createClient } from './clients'

/**
 * Leads, and what they add up to.
 *
 * The board is ordinary CRUD; the two things worth reading are `moveLead`,
 * which records where a lead has been rather than only where it is, and
 * `winLead`, which turns a lead into a real client without losing the history
 * that got it there.
 */

interface LeadRow extends Row {
  id: number
  name: string
  company: string
  email: string
  phone: string
  source: string
  stage: Stage
  value: number | null
  next_action: string
  next_action_on: string | null
  lost_reason: LostReason | null
  lost_note: string
  notes: string
  client_id: number | null
  project_id: number | null
  closed_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    source: row.source,
    stage: row.stage,
    value: row.value,
    nextAction: row.next_action,
    nextActionOn: row.next_action_on,
    lostReason: row.lost_reason,
    lostNote: row.lost_note,
    notes: row.notes,
    clientId: row.client_id,
    projectId: row.project_id,
    closedAt: row.closed_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listLeads(db: Database, asOf: string = today()): LeadWithHealth[] {
  return db
    .all<LeadRow>(
      'SELECT * FROM leads WHERE archived = 0 ORDER BY sort_order, id'
    )
    .map((row) => {
      const lead = toLead(row)
      return { ...lead, health: leadHealth(lead, asOf) }
    })
}

export function getLead(db: Database, id: number): Lead {
  const row = db.get<LeadRow>('SELECT * FROM leads WHERE id = ?', [id])
  if (!row) throw new Error(`No lead with id ${id}`)
  return toLead(row)
}

/** Records where a lead is, on top of the row that says where it is now. */
function noteStage(db: Database, leadId: number, stage: Stage): void {
  db.run("INSERT INTO lead_events (lead_id, stage, at) VALUES (?, ?, datetime('now'))", [
    leadId,
    stage
  ])
}

export function createLead(db: Database, input: LeadInput): Lead {
  const stage = input.stage ?? 'lead'

  // At the end of its column, so a new lead does not jump the queue of things
  // somebody has already ordered.
  const last =
    db.get<Row & { last: number | null }>(
      'SELECT MAX(sort_order) AS last FROM leads WHERE stage = ?',
      [stage]
    )?.last ?? 0

  db.run(
    `INSERT INTO leads (name, company, email, phone, source, stage, value,
                        next_action, next_action_on, notes, sort_order,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name?.trim() || 'New lead',
      input.company ?? '',
      input.email ?? '',
      input.phone ?? '',
      input.source ?? '',
      stage,
      input.value ?? null,
      input.nextAction ?? '',
      input.nextActionOn ?? null,
      input.notes ?? '',
      last + 1
    ]
  )

  const id = db.get<Row & { id: number }>('SELECT last_insert_rowid() AS id')!.id
  noteStage(db, id, stage)
  return getLead(db, id)
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  company: 'company',
  email: 'email',
  phone: 'phone',
  source: 'source',
  value: 'value',
  nextAction: 'next_action',
  nextActionOn: 'next_action_on',
  notes: 'notes',
  lostNote: 'lost_note'
}

export function updateLead(db: Database, id: number, patch: LeadInput): Lead {
  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (assignments.length > 0) {
    db.run(`UPDATE leads SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`, [
      ...values,
      id
    ])
  }

  // Stage changes go through `moveLead`, which has history to write and rules
  // about closing. Silently accepting one here would let a lead reach `won`
  // without ever being recorded as having got there.
  if (patch.stage !== undefined) return moveLead(db, id, patch.stage)

  return getLead(db, id)
}

/**
 * Move a lead to another stage.
 *
 * Closing stamps `closed_at`; reopening clears it, along with the lost reason
 * — a lead dragged back onto the board is live again, and leaving "too
 * expensive" attached to a live lead would put it in the lost breakdown while
 * somebody is still working on it.
 */
export function moveLead(
  db: Database,
  id: number,
  stage: Stage,
  options: { lostReason?: LostReason; lostNote?: string; sortOrder?: number } = {}
): Lead {
  const current = getLead(db, id)
  const closing = stage === 'won' || stage === 'lost'

  db.run(
    `UPDATE leads
        SET stage = ?,
            closed_at = ?,
            lost_reason = ?,
            lost_note = ?,
            sort_order = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [
      stage,
      // Kept if it was already closed in the same stage, so re-saving a lost
      // lead does not move the date it was lost on.
      closing ? (current.stage === stage ? current.closedAt : today()) : null,
      stage === 'lost' ? (options.lostReason ?? current.lostReason ?? 'other') : null,
      stage === 'lost' ? (options.lostNote ?? current.lostNote) : '',
      options.sortOrder ?? current.sortOrder,
      id
    ]
  )

  if (current.stage !== stage) noteStage(db, id, stage)

  return getLead(db, id)
}

/**
 * Won: turn the lead into a client.
 *
 * The client is made from the lead's own details rather than asking for them
 * again — somebody who has just won work should not have to retype the name
 * they have been looking at for three weeks. The lead is kept and linked, not
 * consumed: it is the record of how that client arrived, and it is the only
 * thing the source report is built from.
 */
export async function winLead(
  db: Database,
  workspacePath: string,
  id: number
): Promise<{ lead: Lead; clientId: number }> {
  const lead = getLead(db, id)

  // Already won and already linked: moving it again must not make a second
  // client for the same person.
  if (lead.clientId !== null) {
    return { lead: moveLead(db, id, 'won'), clientId: lead.clientId }
  }

  const client = await createClient(db, workspacePath, {
    name: lead.company.trim() || lead.name,
    contactName: lead.name,
    email: lead.email,
    phone: lead.phone,
    notes: lead.notes
  })

  db.run("UPDATE leads SET client_id = ?, updated_at = datetime('now') WHERE id = ?", [
    client.id,
    id
  ])

  return { lead: moveLead(db, id, 'won'), clientId: client.id }
}

export function deleteLead(db: Database, id: number): void {
  db.run("UPDATE leads SET archived = 1, archived_at = datetime('now') WHERE id = ?", [id])
}

/**
 * Reorder within a column.
 *
 * Fractional positions, so moving one card writes one row rather than
 * renumbering the column — the same approach the task board uses.
 */
export function reorderLead(db: Database, id: number, stage: Stage, sortOrder: number): Lead {
  return moveLead(db, id, stage, { sortOrder })
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export function pipelineReport(db: Database, asOf: string = today()): PipelineReport {
  const leads = listLeads(db, asOf)

  return {
    asOf,
    value: pipelineValue(leads, asOf),
    sources: bySource(leads),
    lost: lostReasons(leads),
    conversion: conversion(leads)
  }
}

/**
 * Leads wanting attention today, for the dashboard.
 *
 * Adrift first, then overdue, then due today — the order they cost money in.
 */
export function leadsNeedingAttention(db: Database, asOf: string = today()): LeadWithHealth[] {
  const rank: Record<string, number> = { adrift: 0, overdue: 1, today: 2 }

  return listLeads(db, asOf)
    .filter((lead) => lead.health in rank)
    .sort(
      (a, b) =>
        rank[a.health]! - rank[b.health]! ||
        (a.nextActionOn ?? '').localeCompare(b.nextActionOn ?? '')
    )
}

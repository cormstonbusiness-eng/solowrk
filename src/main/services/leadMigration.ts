import type { Database, Row } from '../db'
import type { RelationshipStage } from '@shared/types'
import { createClient } from './clients'

/**
 * Moving the lead pipeline into Clients.
 *
 * Marketing was built as a lead tracker, which is a sales function in the
 * wrong module. The pipeline is not deleted — it moves here, so that a person
 * exists in one place rather than two, and a campaign can report how many
 * enquiries it produced by counting the clients that point back at it.
 *
 * **Why this is code rather than a migration.** A client owns a folder on
 * disk, and `createClient` makes the directory *before* the row so that no row
 * can ever point at a directory that does not exist. SQL cannot make a
 * directory. So migration 30 lays the schema and this does the conversion, on
 * the next workspace open, exactly as `seedStarterTemplates` does.
 *
 * **Idempotent, and it has to be.** It runs on every open. A lead that has
 * already been converted carries a `client_id`, and that is the only test —
 * matching on name would make a second client for anyone who happened to
 * rename one, and matching on nothing would make a second client every time
 * the app started.
 */

interface LeadRow extends Row {
  id: number
  name: string
  company: string
  email: string
  phone: string
  source: string
  stage: string
  notes: string
  lost_reason: string | null
  lost_note: string
  client_id: number | null
}

/**
 * Where each pipeline stage lands.
 *
 * Three of the six collapse into `prospect`, and that is not information lost:
 * contacted, in conversation and proposal-sent are all "talking, not decided",
 * and the detail of which was true is in the lead's own event history, which
 * the conversion keeps. A stage is where somebody stands, not how they got
 * there.
 */
const STAGE: Record<string, RelationshipStage> = {
  lead: 'lead',
  contacted: 'prospect',
  conversation: 'prospect',
  proposal: 'prospect',
  won: 'active',
  lost: 'former'
}

/**
 * What a lead knew that a client has no column for.
 *
 * Appended to the notes rather than dropped. The source is the single most
 * useful thing on a lead — it is the beginning of knowing what works — and
 * losing it silently during a migration somebody did not ask for would be
 * the worst version of this change.
 */
function notesFor(lead: LeadRow): string {
  const lines = [lead.notes.trim()]

  if (lead.source.trim()) lines.push(`Source: ${lead.source.trim()}`)

  if (lead.stage === 'lost') {
    const reason = lead.lost_reason?.trim()
    const note = lead.lost_note.trim()
    if (reason || note) {
      lines.push(`Lost${reason ? ` (${reason})` : ''}${note ? `: ${note}` : ''}`)
    }
  }

  return lines.filter(Boolean).join('\n\n')
}

/**
 * Convert every unconverted lead into a client.
 *
 * Returns how many were moved, for the log. Never throws: a workspace that
 * will not open is far worse than a lead that has not moved yet, and the next
 * open will try again.
 */
let running: Promise<number> | null = null

export function migrateLeadsToClients(db: Database, workspacePath: string): Promise<number> {
  /**
   * One run at a time, and concurrent callers join the one already going.
   *
   * Found on a real workspace: `workspace:status` reaches `restore()`, React
   * runs its effects twice in development, and both calls entered `open()` and
   * suspended at the first `await`. Both then read the same unconverted lead,
   * and one lead became two clients. The only sign was the log line printing
   * twice.
   *
   * `open()` serialises now too, which is the better fix — but this is the
   * function that turns a read into a write, so it carries its own guard. Two
   * separate *processes* on one workspace would still race; that is a wider
   * problem than this, and the app does not support it in the first place.
   */
  if (running) return running

  running = convert(db, workspacePath).finally(() => {
    running = null
  })

  return running
}

/** Testing seam: one test's in-flight run must not leak into the next. */
export function resetLeadMigration(): void {
  running = null
}

async function convert(db: Database, workspacePath: string): Promise<number> {
  // The table is gone in a future schema; until then, absence is not an error.
  const pending = db.all<LeadRow>(
    `SELECT * FROM leads
      WHERE client_id IS NULL AND archived = 0
      ORDER BY id`
  )

  let moved = 0

  for (const lead of pending) {
    // The company if there is one, the person if not — the same rule
    // `winLead` already used, so a lead converted by hand before this ran and
    // one converted by it end up named the same way.
    const name = lead.company.trim() || lead.name.trim() || 'Unnamed'

    const client = await createClient(db, workspacePath, {
      name,
      contactName: lead.company.trim() ? lead.name : '',
      email: lead.email,
      phone: lead.phone,
      notes: notesFor(lead),
      relationshipStage: STAGE[lead.stage] ?? 'lead'
    })

    // Linked, not consumed. The lead row stays as the record of how that
    // client arrived, and it is what stops this running again.
    db.run("UPDATE leads SET client_id = ?, updated_at = datetime('now') WHERE id = ?", [
      client.id,
      lead.id
    ])

    moved += 1
  }

  return moved
}

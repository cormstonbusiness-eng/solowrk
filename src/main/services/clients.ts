import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from '../db'
import type { Client, ClientInput } from '@shared/types'
import { toFolderName, uniqueFolderName } from './naming'
import { resolveInWorkspace } from './workspace'

const CLIENTS_ROOT = 'Clients'

interface ClientRow extends Row {
  id: number
  name: string
  contact_name: string
  email: string
  phone: string
  address: string
  vat_number: string
  default_rate: number | null
  payment_terms_days: number | null
  notes: string
  colour: string
  folder: string
  status: string
  interested_at: string | null
  became_active_at: string | null
  archived: number
  created_at: string
  updated_at: string
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    vatNumber: row.vat_number,
    defaultRate: row.default_rate,
    paymentTermsDays: row.payment_terms_days,
    notes: row.notes,
    colour: row.colour,
    folder: row.folder,
    status: row.status as Client['status'],
    interestedAt: row.interested_at,
    becameActiveAt: row.became_active_at,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listClients(db: Database, includeArchived = false): Client[] {
  const where = includeArchived ? '' : 'WHERE archived = 0'
  return db
    .all<ClientRow>(`SELECT * FROM clients ${where} ORDER BY name COLLATE NOCASE`)
    .map(toClient)
}

export function getClient(db: Database, id: number): Client {
  const row = db.get<ClientRow>('SELECT * FROM clients WHERE id = ?', [id])
  if (!row) throw new Error(`No client with id ${id}`)
  return toClient(row)
}

export async function createClient(
  db: Database,
  workspacePath: string,
  input: ClientInput
): Promise<Client> {
  const taken = db.all<Row & { folder: string }>('SELECT folder FROM clients').map((r) =>
    r.folder.replace(`${CLIENTS_ROOT}\\`, '')
  )
  const folderName = uniqueFolderName(input.name, taken)
  const folder = join(CLIENTS_ROOT, folderName)

  // Create the folder first: if the disk refuses, no orphaned row is left
  // pointing at a directory that does not exist.
  await mkdir(resolveInWorkspace(workspacePath, join(folder, '_client')), { recursive: true })

  const status = input.status ?? 'active'

  db.run(
    `INSERT INTO clients
       (name, contact_name, email, phone, address, vat_number, default_rate,
        payment_terms_days, notes, colour, folder, status,
        interested_at, became_active_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name,
      input.contactName ?? '',
      input.email ?? '',
      input.phone ?? '',
      input.address ?? '',
      input.vatNumber ?? '',
      input.defaultRate ?? null,
      input.paymentTermsDays ?? null,
      input.notes ?? '',
      input.colour ?? '#6E56CF',
      folder,
      status,
      // Stamped on the way in as well as on transition, so a client added
      // straight in as active still counts towards the goal for this period.
      status === 'interested' ? nowIso() : null,
      status === 'active' ? nowIso() : null
    ]
  )

  const row = db.get<ClientRow>('SELECT * FROM clients WHERE id = last_insert_rowid()')
  if (!row) throw new Error('Client was not created')
  return toClient(row)
}

const UPDATABLE: Record<string, string> = {
  name: 'name',
  contactName: 'contact_name',
  email: 'email',
  phone: 'phone',
  address: 'address',
  vatNumber: 'vat_number',
  defaultRate: 'default_rate',
  paymentTermsDays: 'payment_terms_days',
  notes: 'notes',
  colour: 'colour',
  status: 'status',
  archived: 'archived'
}

/** SQLite's own format, so stamps written here sort against `datetime('now')`. */
function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export async function updateClient(
  db: Database,
  workspacePath: string,
  id: number,
  patch: Partial<ClientInput>
): Promise<Client> {
  const current = getClient(db, id)

  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null))
  }

  /**
   * The first time they reach a status, record when.
   *
   * `COALESCE` so it is only ever written once: these stamps are what the
   * goals count, and a client moved from active to past and back would
   * otherwise be counted as a new client twice.
   */
  if (patch.status && patch.status !== current.status) {
    if (patch.status === 'interested') {
      assignments.push('interested_at = COALESCE(interested_at, ?)')
      values.push(nowIso())
    }
    if (patch.status === 'active') {
      assignments.push('became_active_at = COALESCE(became_active_at, ?)')
      values.push(nowIso())
    }
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE clients SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  if (patch.name && patch.name !== current.name) {
    await renameClientFolder(db, workspacePath, current, patch.name)
  }

  return getClient(db, id)
}

/**
 * Keep the folder name in step with the client name. Best-effort by design: if
 * a file inside is open, Windows refuses the rename, and a failed tidy-up must
 * not fail the edit or leave the row pointing somewhere that does not exist.
 */
async function renameClientFolder(
  db: Database,
  workspacePath: string,
  current: Client,
  newName: string
): Promise<void> {
  const taken = db
    .all<Row & { folder: string }>('SELECT folder FROM clients WHERE id != ?', [current.id])
    .map((r) => r.folder.replace(`${CLIENTS_ROOT}\\`, ''))

  const nextFolder = join(CLIENTS_ROOT, uniqueFolderName(newName, taken))
  if (nextFolder === current.folder) return

  try {
    await rename(
      resolveInWorkspace(workspacePath, current.folder),
      resolveInWorkspace(workspacePath, nextFolder)
    )
    db.run('UPDATE clients SET folder = ? WHERE id = ?', [nextFolder, current.id])
    // Projects store their own paths beneath the client, so they move too.
    db.run(
      `UPDATE projects SET folder = replace(folder, ?, ?) WHERE client_id = ?`,
      [current.folder, nextFolder, current.id]
    )
  } catch {
    // Folder stays where it is; the record keeps pointing at the real location.
  }
}

/**
 * Remove the client from SoloWrk. Files are deliberately left on disk — deleting
 * a record should never destroy a client's work.
 */
export function deleteClient(db: Database, id: number): void {
  db.run('DELETE FROM clients WHERE id = ?', [id])
}

export function clientFolderName(name: string): string {
  return toFolderName(name)
}

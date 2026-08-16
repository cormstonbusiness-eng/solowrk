import type { BrowserWindow } from 'electron'
import type { Database, Row } from '../db'
import type { Client, Enquiry } from '@shared/types'
import { getSettings } from './settings'
import { getSecret } from './credentials'
import { createClient } from './clients'
import { push } from './notifications'

/**
 * Contact-form enquiries, pulled in from the website.
 *
 * The site keeps them in a small store and exposes them behind a token; this
 * polls it. A desktop app has no public address, so it cannot receive a
 * webhook — polling is not a shortcut here, it is the only shape available.
 *
 * Enquiries are personal data belonging to the people who sent them, so they
 * come in over HTTPS with a bearer token and the token lives in the OS
 * keystore, never in the workspace.
 */

const TIMEOUT_MS = 15_000

interface RemoteEnquiry {
  id: string
  name: string
  email: string
  business: string
  phone: string
  budget: string
  projectType: string
  message: string
  receivedAt: string
}

function toEnquiry(row: Row & Record<string, unknown>): Enquiry {
  return {
    id: row.id as number,
    externalId: row.external_id as string,
    name: row.name as string,
    email: row.email as string,
    business: row.business as string,
    phone: row.phone as string,
    budget: row.budget as string,
    projectType: row.project_type as string,
    message: row.message as string,
    clientId: (row.client_id as number | null) ?? null,
    readAt: (row.read_at as string | null) ?? null,
    archived: row.archived === 1,
    receivedAt: row.received_at as string
  }
}

export function listEnquiries(db: Database, options: { archived?: boolean } = {}): Enquiry[] {
  return db
    .all<Row & Record<string, unknown>>(
      `SELECT * FROM website_enquiries
        WHERE archived = ?
        ORDER BY received_at DESC, id DESC`,
      [options.archived ? 1 : 0]
    )
    .map(toEnquiry)
}

export function unreadEnquiries(db: Database): number {
  const row = db.get<Row & { count: number }>(
    'SELECT COUNT(*) AS count FROM website_enquiries WHERE archived = 0 AND read_at IS NULL'
  )
  return row?.count ?? 0
}

export function markEnquiryRead(db: Database, id: number): void {
  db.run("UPDATE website_enquiries SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL", [
    id
  ])
}

export function archiveEnquiry(db: Database, id: number, archived: boolean): void {
  // Marked read on the way past: archiving something is having dealt with it,
  // and leaving it counted as unread afterwards would be nonsense.
  db.run(
    `UPDATE website_enquiries
        SET archived = ?, read_at = COALESCE(read_at, datetime('now'))
      WHERE id = ?`,
    [archived ? 1 : 0, id]
  )
}

/**
 * Fetch new enquiries and store the ones we have not seen.
 *
 * Returns how many were new. Nothing is ever updated in place — an enquiry is
 * a record of what somebody sent, and it should not change afterwards.
 */
export async function pollEnquiries(
  db: Database,
  getWindow: () => BrowserWindow | null
): Promise<number> {
  const { enquiriesUrl } = getSettings(db)
  const token = await getSecret('enquiries.token')

  if (enquiriesUrl.trim() === '' || token === null) return 0

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let payload: { configured?: boolean; enquiries?: RemoteEnquiry[] }
  try {
    const response = await fetch(enquiriesUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal
    })

    if (response.status === 401) {
      throw new Error('The website rejected the enquiries token.')
    }
    if (!response.ok) {
      throw new Error(`The website returned ${response.status}.`)
    }

    payload = (await response.json()) as typeof payload
  } finally {
    clearTimeout(timer)
  }

  const incoming = Array.isArray(payload.enquiries) ? payload.enquiries : []
  if (incoming.length === 0) return 0

  let added = 0

  db.transaction(() => {
    for (const item of incoming) {
      if (typeof item?.id !== 'string' || item.id === '') continue

      // Checked rather than counted from the insert: `db.run` returns nothing,
      // and the count is what decides whether a notification is raised.
      const seen = db.get<Row & { id: number }>(
        'SELECT id FROM website_enquiries WHERE external_id = ?',
        [item.id]
      )
      if (seen) continue

      // The unique index on external_id is the real guard — this stays correct
      // even if two polls overlap.
      db.run(
        `INSERT OR IGNORE INTO website_enquiries
           (external_id, name, email, business, phone, budget, project_type, message,
            received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          item.id,
          item.name ?? '',
          item.email ?? '',
          item.business ?? '',
          item.phone ?? '',
          item.budget ?? '',
          item.projectType ?? '',
          item.message ?? '',
          item.receivedAt ?? new Date().toISOString()
        ]
      )

      added++
    }
  })

  if (added > 0) {
    push(db, getWindow, {
      kind: 'info',
      title: added === 1 ? 'New enquiry' : `${added} new enquiries`,
      body:
        added === 1
          ? `${incoming[0]!.name} got in touch through your website.`
          : 'Someone got in touch through your website.',
      link: '/website/enquiries'
    })
  }

  return added
}

/**
 * Turn an enquiry into a client.
 *
 * The point of the whole feature: a lead reaches the books without being
 * retyped, and the enquiry keeps a link to the client it became so the two
 * never drift apart.
 */
export async function enquiryToClient(
  db: Database,
  workspacePath: string,
  id: number
): Promise<Client> {
  const row = db.get<Row & Record<string, unknown>>(
    'SELECT * FROM website_enquiries WHERE id = ?',
    [id]
  )
  if (!row) throw new Error('That enquiry no longer exists.')

  const enquiry = toEnquiry(row)
  if (enquiry.clientId !== null) {
    throw new Error('This enquiry has already been turned into a client.')
  }

  const client = await createClient(db, workspacePath, {
    // The business name if they gave one, otherwise their own — a client
    // record called "" would be useless.
    name: enquiry.business.trim() || enquiry.name.trim() || enquiry.email,
    active: true,
    contactName: enquiry.name,
    email: enquiry.email,
    phone: enquiry.phone,
    address: '',
    vatNumber: '',
    defaultRate: null,
    paymentTermsDays: null,
    colour: '#6E56CF'
  })

  db.run(
    `UPDATE website_enquiries
        SET client_id = ?, read_at = COALESCE(read_at, datetime('now'))
      WHERE id = ?`,
    [client.id, id]
  )

  return client
}

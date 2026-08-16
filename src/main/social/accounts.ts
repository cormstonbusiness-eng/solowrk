import type { Database, Row } from '../db'
import type { AccountStatus, SocialAccount } from '@shared/types'
import type { Platform } from '@shared/social'

/**
 * Connected social accounts.
 *
 * Read-only for now: stage 10.1 plans and schedules posts without any account
 * connected, and stage 10.3 adds the OAuth flow that writes these rows. The
 * table deliberately holds no tokens — `credential_key` points at a blob
 * encrypted with Electron's `safeStorage` in `userData`, outside the workspace,
 * so a workspace that is zipped, synced or copied to another machine never
 * carries access tokens with it.
 */

interface AccountRow extends Row {
  id: number
  platform: string
  handle: string
  display_name: string
  avatar_file: string | null
  external_id: string | null
  status: string
  scopes: string
  meta: string
  connected_at: string | null
  created_at: string
  updated_at: string
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    // Corrupt metadata must not stop the accounts list rendering.
    return {}
  }
}

function toAccount(row: AccountRow): SocialAccount {
  return {
    id: row.id,
    platform: row.platform as Platform,
    handle: row.handle,
    displayName: row.display_name,
    avatarFile: row.avatar_file,
    externalId: row.external_id,
    status: row.status as AccountStatus,
    scopes: row.scopes === '' ? [] : row.scopes.split(' '),
    meta: parseMeta(row.meta),
    connectedAt: row.connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listAccounts(db: Database): SocialAccount[] {
  return db
    .all<AccountRow>('SELECT * FROM social_accounts ORDER BY platform, id')
    .map(toAccount)
}

/** The account a post should publish through for a platform, if there is one. */
export function accountFor(db: Database, platform: Platform): SocialAccount | null {
  const row = db.get<AccountRow>(
    `SELECT * FROM social_accounts
      WHERE platform = ? AND status = 'connected'
      ORDER BY id LIMIT 1`,
    [platform]
  )
  return row ? toAccount(row) : null
}
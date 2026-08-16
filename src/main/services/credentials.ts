import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

/**
 * Secrets, encrypted at rest by the operating system.
 *
 * Two rules, both load-bearing:
 *
 * 1. **The blob lives in `userData`, never in the workspace.** The workspace is
 *    designed to be portable — zipped, synced to OneDrive, copied to another
 *    machine — and a token that travels with it is a token you have given away
 *    without noticing. This is what `social_accounts.credential_key` and the
 *    comment in migration 8 have been anticipating since phase 10.
 *
 * 2. **A secret never crosses the IPC bridge on the way out.** Callers can set
 *    one, delete one, and ask whether one exists. There is no `get` exposed to
 *    the renderer, so a token cannot end up in a React devtools panel, a query
 *    cache, or a crash report.
 *
 * Encryption is Electron's `safeStorage`, which is DPAPI on Windows — the key
 * is held by the OS and tied to the user account, so the file is useless if
 * copied elsewhere. No native module, which is a hard rule in this app.
 */

const FILENAME = 'credentials.json'

/** Named keys, so a typo is a compile error rather than a silent miss. */
export type CredentialKey = 'github.token' | 'enquiries.token'

function credentialsPath(): string {
  return join(app.getPath('userData'), FILENAME)
}

type Store = Record<string, string>

async function readStore(): Promise<Store> {
  try {
    const parsed: unknown = JSON.parse(await readFile(credentialsPath(), 'utf8'))
    // A hand-edited or truncated file must not take the app down on startup.
    return parsed !== null && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

async function writeStore(store: Store): Promise<void> {
  await writeFile(credentialsPath(), JSON.stringify(store, null, 2), 'utf8')
}

/**
 * Whether this machine can encrypt at all.
 *
 * On Windows it effectively always can. If it ever cannot, we refuse to store
 * the secret rather than quietly falling back to plain text — a token in a
 * readable JSON file is worse than no token, because the user believes it is
 * protected.
 */
export function canStoreSecrets(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function setSecret(key: CredentialKey, value: string): Promise<void> {
  if (!canStoreSecrets()) {
    throw new Error(
      'Windows cannot encrypt saved credentials on this machine, so SoloWrk will not ' +
        'store the token. Nothing has been saved.'
    )
  }

  const store = await readStore()

  if (value.trim() === '') {
    delete store[key]
  } else {
    store[key] = safeStorage.encryptString(value.trim()).toString('base64')
  }

  await writeStore(store)
}

/** Main-process only. Deliberately never reachable over IPC. */
export async function getSecret(key: CredentialKey): Promise<string | null> {
  const stored = (await readStore())[key]
  if (stored === undefined) return null

  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // Written by a different Windows account, or after a profile reset. The
    // secret is unrecoverable; report it as absent so the UI asks for it again.
    return null
  }
}

export async function hasSecret(key: CredentialKey): Promise<boolean> {
  return (await getSecret(key)) !== null
}

export async function deleteSecret(key: CredentialKey): Promise<void> {
  const store = await readStore()
  delete store[key]
  await writeStore(store)
}
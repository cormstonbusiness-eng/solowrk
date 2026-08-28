import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { LICENCE_VERSION, toLicence, type Licence, type LicenceClaims } from '@shared/licence'

/**
 * Verifying a licence, offline.
 *
 * Ed25519 over `node:crypto`, which has supported it natively since Node 12.
 * No dependency, which matters more here than it looks: SoloWrk deliberately
 * carries no compiled modules so `npm install` works on any machine and the
 * installer ships no ABI-specific binaries. A crypto library would have been
 * the first exception.
 *
 * **Why signing at all.** Until now the token was opaque and the app trusted
 * whatever the server returned — but `apiBaseUrl` is editable from the UI, so
 * anyone could point SoloWrk at their own server and mint themselves Pro. A
 * signature makes that escape hatch harmless, which is why it stays: somebody
 * pointing the app at a test server is a developer, and somebody forging a
 * licence now has to break Ed25519.
 *
 * It is also what makes §3.1's lifetime licence possible. Verification touches
 * no network, so a lifetime holder can be offline forever and still be Pro.
 */

/**
 * The public half of the licence key, SPKI DER in base64.
 *
 * Public by definition — it verifies, it cannot sign — so committing it is
 * correct and it must match `LICENCE_PRIVATE_KEY` on the server. Replacing it
 * invalidates every licence ever issued, so it changes only if the private key
 * is lost or leaked.
 */
const SHIPPED_PUBLIC_KEY = 'MCowBQYDK2VwAyEA+99UTMw8xAOiUSl7KBgwwhRByywWlVHxdvgfoOBwdTs='

/**
 * Read rather than captured at module load, so the tests can hand it a keypair
 * they generated and so a staging build can point at a staging key without a
 * separate binary. Cached by value: the parse happens once per distinct key,
 * not once per licence check.
 */
let cached: { base64: string; key: ReturnType<typeof createPublicKey> } | null = null

function publicKey(): ReturnType<typeof createPublicKey> {
  const base64 = process.env.SOLOWRK_LICENCE_PUBLIC_KEY ?? SHIPPED_PUBLIC_KEY

  if (!cached || cached.base64 !== base64) {
    cached = {
      base64,
      key: createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
    }
  }

  return cached.key
}

/**
 * `<base64url claims>.<base64url signature>`.
 *
 * Deliberately not a JWT. JWT's algorithm field is a documented footgun — the
 * `alg: none` family of attacks exists because the token gets to nominate how
 * it is checked. Here the algorithm is not negotiable: there is one, it is in
 * this file, and the token has no say in it.
 */
const SEPARATOR = '.'

export interface VerifyResult {
  licence: Licence | null
  /** Why it failed, for the log. Never shown to the user. */
  reason: string
}

/**
 * Verify a token and read the licence out of it.
 *
 * Returns `{ licence: null }` for anything wrong — a bad signature, a mangled
 * file, a version from the future. Never throws: every caller is asking what
 * the user is entitled to, and the answer to an unreadable token is Free, not
 * a crash on a screen they cannot get past.
 */
export function verifyLicence(token: string | null): VerifyResult {
  if (!token || token.trim() === '') return { licence: null, reason: 'no token' }

  const at = token.indexOf(SEPARATOR)
  if (at === -1) return { licence: null, reason: 'malformed' }

  const payload = token.slice(0, at)
  const signature = token.slice(at + 1)

  let claims: LicenceClaims
  try {
    const body = Buffer.from(payload, 'base64url')

    // Signature first, always. Parsing before checking means running JSON.parse
    // over bytes an attacker chose, which is a smaller hole than a forged
    // licence but is still a hole nobody needs.
    const good = verifySignature(null, body, publicKey(), Buffer.from(signature, 'base64url'))
    if (!good) return { licence: null, reason: 'bad signature' }

    claims = JSON.parse(body.toString('utf8')) as LicenceClaims
  } catch (cause) {
    return { licence: null, reason: cause instanceof Error ? cause.message : 'unreadable' }
  }

  const licence = toLicence(claims)
  if (!licence) {
    return {
      licence: null,
      reason: claims.v !== LICENCE_VERSION ? `version ${claims.v}` : 'rejected claims'
    }
  }

  return { licence, reason: '' }
}

/**
 * Read the claims without checking the signature.
 *
 * For diagnostics only — the support answer to "what does my licence say".
 * Never call this to decide entitlement; that is `verifyLicence`, and the
 * separation is the point.
 */
export function peekClaims(token: string | null): LicenceClaims | null {
  if (!token) return null
  const at = token.indexOf(SEPARATOR)
  if (at === -1) return null

  try {
    return JSON.parse(Buffer.from(token.slice(0, at), 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
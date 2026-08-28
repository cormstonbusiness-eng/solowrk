import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { readConfig, updateConfig } from './config'

const run = promisify(execFile)

/**
 * Which computer this is.
 *
 * §8 binds a seat to a hashed hardware fingerprint — the motherboard serial
 * and the Windows machine GUID, together — so that a licence follows the
 * machine rather than the installation. The alternative the app used until now
 * was a random UUID in the config file, which a reinstall throws away and a
 * copied config duplicates.
 *
 * **Never the MAC address**, which §8 is emphatic about and is right to be: it
 * changes with a VPN, a dock or a USB adapter, and every change is a customer
 * locked out of their own seat and a support ticket to go with it.
 *
 * Reached through PowerShell rather than a native binding, for the same reason
 * `ocr.ts` is: this app carries no compiled dependencies, so `npm install`
 * works anywhere and the installer ships no ABI-specific binaries. The cost is
 * one short-lived process, once, cached for the life of the run.
 *
 * The hash is one-way and never leaves as anything else. What reaches the
 * server is a sha256, not a serial number — the sign-in screen promises only
 * the licence, the email and the computer's name are sent, and a raw
 * motherboard serial would make that untrue.
 */

/** Long enough for a cold WMI query, short enough not to hold up a launch. */
const TIMEOUT_MS = 10_000

/**
 * Values the hardware reports when it has nothing to report.
 *
 * Consumer boards and virtual machines are full of these. Treating "Default
 * string" as a serial would give every machine in a VM fleet the same
 * fingerprint, which is worse than having none — it would collapse different
 * customers onto one seat.
 */
const MEANINGLESS = new Set([
  '',
  '0',
  'none',
  'null',
  'default string',
  'to be filled by o.e.m.',
  'to be filled by oem',
  'system serial number',
  'not applicable',
  'not specified',
  'unknown',
  'x'
])

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'

$board = ''
try { $board = (Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber } catch { $board = '' }

$guid = ''
try {
  $guid = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid
} catch { $guid = '' }

Write-Output ("{0}|{1}" -f $board, $guid)
`

/**
 * A serial, or an empty string if the machine was only being polite.
 *
 * Craig's own development machine reports "Default string" here, which is a
 * fair sign of how common this is on consumer hardware.
 */
export function usableSerial(value: string): string {
  const trimmed = value.trim()
  return MEANINGLESS.has(trimmed.toLowerCase()) ? '' : trimmed
}

/**
 * The digest, given what the hardware said.
 *
 * Separated from the reading so the interesting half can be tested without
 * depending on whichever machine happens to run the suite. Both parts are
 * named in the material, so a board-only machine cannot collide with a
 * guid-only one that happens to report the same string.
 */
export function digestFor(board: string, guid: string, fallbackId: string): string {
  const material =
    board === '' && guid === '' ? `fallback:${fallbackId}` : `board:${board}|guid:${guid}`

  return `sha256:${createHash('sha256').update(material).digest('hex')}`
}

/** What the machine will admit to, or empty strings if it will not. */
async function readHardware(): Promise<{ board: string; guid: string }> {
  if (process.platform !== 'win32') return { board: '', guid: '' }

  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { timeout: TIMEOUT_MS, windowsHide: true }
    )

    const [board = '', guid = ''] = stdout.trim().split('|')
    return { board: usableSerial(board), guid: usableSerial(guid) }
  } catch {
    // A locked-down machine, a disabled WMI service, a timeout. None of these
    // are worth failing a launch over — the fallback below covers them.
    return { board: '', guid: '' }
  }
}

let cached: string | null = null

/**
 * The fingerprint for this machine, as `sha256:…`.
 *
 * Falls back to the random per-installation id when the hardware says nothing
 * usable — a virtual machine, an OEM board with a blank serial, a policy that
 * blocks WMI. That is weaker, and it is the right trade: a seat that cannot be
 * identified must still be usable, because the alternative is refusing to
 * start. The fallback is persisted so it is at least stable across launches.
 *
 * Cached for the life of the process. Hardware does not change under a running
 * app, and this sits on the launch path.
 */
export async function fingerprint(): Promise<string> {
  if (cached) return cached

  const config = await readConfig()
  if (config.fingerprint) {
    cached = config.fingerprint
    return cached
  }

  const { board, guid } = await readHardware()
  const digest = digestFor(board, guid, config.deviceId ?? randomUUID())

  await updateConfig({ fingerprint: digest })
  cached = digest
  return digest
}

/** Whether this machine could be identified by its hardware at all. */
export async function isHardwareBound(): Promise<boolean> {
  const { board, guid } = await readHardware()
  return board !== '' || guid !== ''
}

/** Testing seam. The cache would otherwise outlive a test's expectations. */
export function resetFingerprintCache(): void {
  cached = null
}
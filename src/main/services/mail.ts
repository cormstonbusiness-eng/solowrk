import { createTransport } from 'nodemailer'
import { safeStorage } from 'electron'
import type { Settings } from '@shared/types'
import { readConfig, updateConfig } from './config'
import type { MailTransport } from './mailQueue'

/**
 * Sending, through the user's own mail account.
 *
 * There is no SoloWrk mail server and there is not going to be one. A service
 * relaying a freelancer's correspondence with their clients is a service that
 * can read it, lose it, and be blamed for it — and it would put every chaser
 * this app writes behind somebody else's deliverability reputation. Sending
 * through the user's own provider means the note arrives in their sent folder,
 * from their address, and a reply comes back to them.
 *
 * This module is the only thing that knows about a mail library. Everything
 * with a decision in it — what to send, when to give up, what to tell the user
 * — is in `mailQueue` and `mailPolicy`, behind the `MailTransport` interface,
 * so it can all be tested without a server to send to.
 */

export interface SmtpCredentials {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

/**
 * Whether there is enough here to try.
 *
 * Checked before queueing rather than only before sending, because a message
 * that fails five times against an unconfigured server tells the user their
 * mail is broken when the truth is that they never set it up.
 */
export function smtpConfigured(settings: Settings, hasPassword: boolean): boolean {
  return (
    settings.smtpHost.trim() !== '' &&
    settings.smtpUser.trim() !== '' &&
    settings.smtpPort > 0 &&
    hasPassword
  )
}

/**
 * Keep the password in the OS keychain.
 *
 * `safeStorage` encrypts against the logged-in Windows account, so the stored
 * blob is useless on another machine and useless to another user of this one.
 * When encryption is unavailable — a bare Linux session with no keyring — we
 * refuse rather than fall back to writing it in plain text. Somebody who cannot
 * store a password safely should find that out at the moment they try, not
 * after their mail credentials have been sitting in a JSON file.
 */
export async function storeSmtpPassword(password: string): Promise<void> {
  if (password === '') {
    await updateConfig({ smtpPassword: null })
    return
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('This machine has no secure store for passwords, so SoloWrk will not keep one.')
  }

  await updateConfig({
    smtpPassword: safeStorage.encryptString(password).toString('base64')
  })
}

export async function hasSmtpPassword(): Promise<boolean> {
  return (await readConfig()).smtpPassword !== null
}

/**
 * Returns null rather than throwing when the stored blob cannot be read.
 *
 * That happens for a real and undramatic reason: a Windows profile reset, or
 * the config file copied from another machine. The right response is to behave
 * as though no password is set and ask for it again, not to fail the send with
 * a decryption error nobody can act on.
 */
async function readSmtpPassword(): Promise<string | null> {
  const stored = (await readConfig()).smtpPassword
  if (!stored) return null

  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

/**
 * What the client sees in the From line.
 *
 * The business name in front of the address, because a chaser arriving from a
 * bare gmail address is a chaser that looks like a phishing attempt — which is
 * exactly the wrong impression to give somebody you are asking for money.
 */
function fromLine(settings: Settings): string {
  const address = settings.smtpFrom.trim() || settings.smtpUser.trim()
  const name = settings.businessName.trim() || settings.contactName.trim()

  // Quoted, because an unquoted display name containing a comma or a full stop
  // is a malformed header and some servers reject the whole message for it.
  return name ? `"${name.replace(/"/g, '')}" <${address}>` : address
}

export async function credentialsFor(settings: Settings): Promise<SmtpCredentials | null> {
  const password = await readSmtpPassword()
  if (password === null || !smtpConfigured(settings, true)) return null

  return {
    host: settings.smtpHost.trim(),
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    user: settings.smtpUser.trim(),
    password,
    from: fromLine(settings)
  }
}

/**
 * A transport for one drain.
 *
 * Built per drain rather than held open. A long-lived connection to a mail
 * server across a laptop's sleep is a connection that is quietly dead when it
 * is next needed, and the cost of reconnecting for a handful of messages a
 * week is nothing.
 */
export function smtpTransport(credentials: SmtpCredentials): MailTransport {
  const transport = createTransport({
    host: credentials.host,
    port: credentials.port,
    // Implicit TLS on 465; STARTTLS on 587, which nodemailer negotiates when
    // `secure` is false. `requireTLS` is what stops it quietly falling back to
    // sending the password in the clear if the server does not offer STARTTLS.
    secure: credentials.secure,
    requireTLS: !credentials.secure,
    auth: { user: credentials.user, pass: credentials.password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000
  })

  return {
    async send(message) {
      await transport.sendMail({
        from: credentials.from,
        to: message.to,
        subject: message.subject,
        text: message.body
      })
    }
  }
}

/**
 * Prove the settings work, without involving a client.
 *
 * Sends to the user's own address. The alternative — verifying the connection
 * without sending — checks the password but not whether the provider will
 * actually accept mail from this address, which is the half that fails on
 * Gmail and Microsoft accounts that need an app password.
 */
export async function sendTestEmail(settings: Settings): Promise<void> {
  const credentials = await credentialsFor(settings)
  if (!credentials) throw new Error('Mail is not set up yet — add a server and password first.')

  await smtpTransport(credentials).send({
    to: settings.smtpFrom.trim() || settings.smtpUser.trim(),
    subject: 'SoloWrk test message',
    body: [
      'This is SoloWrk checking it can send mail through your account.',
      '',
      'If you are reading it, invoice chasers will go out the same way — from',
      'this address, in your name, and into your sent folder.',
      '',
      'Nothing is sent to a client without you deciding to send it.'
    ].join('\n')
  })
}

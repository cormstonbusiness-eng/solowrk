/**
 * Guessing a mail server from an email address.
 *
 * Nobody knows their SMTP host. They know their email address, and asking them
 * for "smtp.office365.com, port 587, STARTTLS" is asking them to go and find a
 * support page — which is where a setup flow loses people. Six providers cover
 * most of the freelancers this app is for; everyone else types it in.
 *
 * A guess, and only ever offered into an empty field. Quietly rewriting a host
 * somebody has already set is worse than not helping.
 */

export interface SmtpPreset {
  label: string
  host: string
  port: number
  /**
   * True for implicit TLS on 465. False for 587, which connects in the clear
   * and upgrades with STARTTLS — still encrypted before the password is sent.
   */
  secure: boolean
}

/**
 * Port 587 throughout, because it is the one that survives.
 *
 * Some home and hotel networks block 465 outright, and a great many providers
 * treat 587 as the supported route for applications. STARTTLS on 587 is not the
 * weaker option: nodemailer is told to require it, so a server that will not
 * offer encryption gets refused rather than silently accepted.
 */
export const SMTP_PRESETS: Record<string, SmtpPreset> = {
  'gmail.com': { label: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false },
  'googlemail.com': { label: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false },
  'outlook.com': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'hotmail.co.uk': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'hotmail.com': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'live.co.uk': { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  'icloud.com': { label: 'iCloud', host: 'smtp.mail.me.com', port: 587, secure: false },
  'me.com': { label: 'iCloud', host: 'smtp.mail.me.com', port: 587, secure: false },
  'fastmail.com': { label: 'Fastmail', host: 'smtp.fastmail.com', port: 587, secure: false },
  'zoho.com': { label: 'Zoho', host: 'smtp.zoho.com', port: 587, secure: false },
  'yahoo.co.uk': { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 587, secure: false },
  'yahoo.com': { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 587, secure: false }
}

/**
 * The preset for an address, or null.
 *
 * Null for anything on a business domain, which is most of the people who will
 * use this and exactly the case a guess would get wrong — `smtp.` in front of
 * somebody's own domain is right often enough to be dangerous and wrong often
 * enough to waste an afternoon.
 */
export function presetFor(address: string): SmtpPreset | null {
  const domain = address.trim().toLowerCase().split('@')[1]
  return domain ? (SMTP_PRESETS[domain] ?? null) : null
}

/**
 * What is stopping this from working, in the order somebody would fix it.
 *
 * Returns the problems rather than a boolean so the UI can say which field is
 * wrong. An empty array means the settings are complete, not that they are
 * correct — only sending proves that, which is what the test button is for.
 */
export function smtpProblems(config: {
  host: string
  port: number
  user: string
}): string[] {
  const problems: string[] = []

  if (config.user.trim() === '') problems.push('Add the email address to send from.')
  else if (!config.user.includes('@')) problems.push('That does not look like an email address.')

  if (config.host.trim() === '') problems.push('Add your provider’s outgoing mail server.')
  if (config.port <= 0 || config.port > 65535) problems.push('The port should be 587 or 465.')

  return problems
}

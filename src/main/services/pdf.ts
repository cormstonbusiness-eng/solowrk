import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { BrowserWindow } from 'electron'
import type {
  DocumentForPdf,
  LineItemDocument,
  Settings,
  StatementForPdf,
  SummaryLine,
  YearSummaryForPdf
} from '@shared/types'
import { resolveInWorkspace } from './workspace'

/**
 * The documents SoloWrk produces for someone else to read.
 *
 * Rendered by loading HTML into an offscreen BrowserWindow and calling
 * printToPDF, rather than drawing with a PDF library. That keeps one template
 * for both the screen and the file, and gets real text layout, web fonts and
 * page breaks for free.
 *
 * Everything here is printed light-on-white: these are the only things SoloWrk
 * produces that leave the app, and a dark invoice would be unreadable and cost
 * the client a cartridge.
 *
 * Four kinds share one shell — the header, the business block, the page rules
 * and the footer — and differ only in the table between them. `DocumentForPdf`
 * in `@shared/types` is a union rather than one wide interface, so a branch
 * that forgets a kind fails to compile rather than rendering an empty page.
 */

export type { DocumentForPdf } from '@shared/types'

const HEADINGS: Record<DocumentForPdf['kind'], string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  receipt: 'Receipt',
  statement: 'Statement',
  summary: 'Year end'
}

/** Which folder each kind is filed in, under the workspace root. */
const FOLDERS: Record<DocumentForPdf['kind'], string> = {
  invoice: 'Invoices',
  quote: 'Quotes',
  // Filed beside the invoice it settles rather than in a folder of its own:
  // somebody looking for the paperwork on one job wants both together, and
  // "Receipts" in this app already means the photographs attached to expenses.
  receipt: 'Invoices',
  statement: 'Statements',
  // Only ever written into a pack folder the caller names, but the map must be
  // total so a kind added later cannot land somewhere arbitrary.
  summary: 'Exports'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

/**
 * Dates are `yyyy-mm-dd` strings and are formatted as UTC.
 *
 * Without the timeZone, `new Date('2026-06-01')` is midnight UTC and renders as
 * 31 May anywhere west of Greenwich — an invoice dated a day before it was
 * raised, on the one document that leaves the app.
 */
function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

const STYLES = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Inter, sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #16161a;
    background: #fff;
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  h1 { margin: 0; font-size: 22pt; letter-spacing: -0.02em; font-weight: 600; }
  /*
    Bounded in both directions so neither a tall square logo nor a wide
    lockup can push the heading down the page. object-fit keeps whatever
    shape the file actually is inside that box without stretching it.
  */
  .logo {
    display: block; max-height: 16mm; max-width: 55mm;
    object-fit: contain; object-position: left; margin-bottom: 9px;
  }
  .muted { color: #6b6b76; }
  .small { font-size: 9pt; }
  .business { text-align: right; font-size: 9.5pt; line-height: 1.45; }
  .meta { margin-top: 26px; display: flex; gap: 40px; }
  .meta div { min-width: 120px; }
  .label {
    font-size: 8pt; text-transform: uppercase; letter-spacing: 0.09em;
    color: #8a8a93; margin-bottom: 3px;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 26px; }
  th {
    text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.09em;
    color: #8a8a93; font-weight: 600; padding-bottom: 7px; border-bottom: 1px solid #e2e2e7;
  }
  td { padding: 9px 0; border-bottom: 1px solid #f0f0f3; vertical-align: top; }
  .right { text-align: right; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* Keep a row intact across a page break rather than splitting a line item. */
  tr { page-break-inside: avoid; }
  /*
    Repeat the column headings on every page. Without this a statement long
    enough to break gives its second page four unlabelled columns of numbers.
  */
  thead { display: table-header-group; }
  .totals { margin-top: 18px; margin-left: auto; width: 260px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; }
  .totals-row.grand {
    border-top: 1.5px solid #16161a; margin-top: 6px; padding-top: 9px;
    font-size: 12.5pt; font-weight: 600;
  }
  .paid-mark {
    display: inline-block; margin-top: 10px; padding: 4px 11px;
    border: 1.5px solid #1d7a4c; border-radius: 4px;
    color: #1d7a4c; font-size: 10pt; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .late { color: #b4232a; }
  .ageing { margin-top: 30px; page-break-inside: avoid; }
  .ageing table { margin-top: 8px; }
  .ageing td { padding: 7px 0; }
  .notes { margin-top: 34px; padding-top: 14px; border-top: 1px solid #f0f0f3; }
  .footer { margin-top: 26px; font-size: 8.5pt; color: #8a8a93; }
  /* Deliberately quieter than the payment terms above it: this is our line,
     not the customer's, and it must never compete with the amount owed. */
  .mark { margin-top: 10px; font-size: 7.5pt; color: #b4b4bb; }
`

function businessBlock(settings: Settings): string {
  const address = [
    settings.addressLine1,
    settings.addressLine2,
    settings.city,
    settings.postcode,
    settings.country
  ].filter((line) => line.trim().length > 0)

  const contact = [settings.email, settings.phone].filter((line) => line.trim().length > 0)

  return `<div class="business">
      <strong>${escapeHtml(settings.businessName || 'Your business')}</strong><br />
      ${address.map(escapeHtml).join('<br />')}
      ${contact.length > 0 ? `<br />${contact.map(escapeHtml).join('<br />')}` : ''}
      ${settings.vatRegistered && settings.vatNumber ? `<br />VAT ${escapeHtml(settings.vatNumber)}` : ''}
    </div>`
}

/** The columns of work, and the totals under them. */
function lineItemBody(doc: LineItemDocument, settings: Settings, branded: boolean): string {
  const secondaryLabel =
    doc.kind === 'invoice' ? 'Payment due' : doc.kind === 'quote' ? 'Valid until' : 'Paid on'

  const partyLabel =
    doc.kind === 'quote' ? 'Prepared for' : doc.kind === 'receipt' ? 'Received from' : 'Billed to'

  // A receipt carries the invoice's date, not its own, so "Issued" would be
  // the payment date printed twice under two different labels.
  const issuedLabel = doc.kind === 'receipt' ? 'Invoice dated' : 'Issued'

  const footer =
    doc.kind === 'quote'
      ? `This quote is valid until ${doc.secondaryDate ? formatDate(doc.secondaryDate) : 'further notice'}.`
      : doc.kind === 'receipt'
        ? `Received with thanks${doc.secondaryDate ? ` on ${formatDate(doc.secondaryDate)}` : ''}. No payment is outstanding on this invoice.`
        : `Payment due by ${doc.secondaryDate ? formatDate(doc.secondaryDate) : 'the agreed date'}.${
            settings.vatRegistered ? '' : ' VAT is not charged on this invoice.'
          }`

  return `
  <div class="meta">
    <div>
      <div class="label">${partyLabel}</div>
      <strong>${escapeHtml(doc.clientName ?? '—')}</strong>
      ${doc.clientAddress ? `<div class="small muted">${escapeHtml(doc.clientAddress)}</div>` : ''}
    </div>
    <div>
      <div class="label">${issuedLabel}</div>
      ${formatDate(doc.issueDate)}
    </div>
    ${
      doc.secondaryDate
        ? `<div><div class="label">${secondaryLabel}</div>${formatDate(doc.secondaryDate)}</div>`
        : ''
    }
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:52%">Description</th>
        <th class="right" style="width:12%">Qty</th>
        <th class="right" style="width:18%">Unit price</th>
        <th class="right" style="width:18%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${doc.lines
        .map(
          (line) => `<tr>
            <td>${escapeHtml(line.description)}</td>
            <td class="right num">${line.quantity}</td>
            <td class="right num">${money(line.unitPrice)}</td>
            <td class="right num">${money(line.amount)}</td>
          </tr>`
        )
        .join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span class="muted">Subtotal</span><span class="num">${money(doc.net)}</span></div>
    ${
      doc.vat > 0
        ? `<div class="totals-row"><span class="muted">VAT at ${doc.vatRate / 100}%</span><span class="num">${money(doc.vat)}</span></div>`
        : ''
    }
    <div class="totals-row grand"><span>${doc.kind === 'receipt' ? 'Paid' : 'Total'}</span><span class="num">${money(doc.gross)}</span></div>
    ${doc.kind === 'receipt' ? '<div class="right"><span class="paid-mark">Paid in full</span></div>' : ''}
  </div>

  ${
    // Notes on an invoice are almost always payment instructions, and a
    // receipt that tells somebody how to pay an invoice they have already
    // settled reads as though nobody checked.
    doc.notes && doc.kind !== 'receipt'
      ? `<div class="notes"><div class="label">Notes</div>${escapeHtml(doc.notes)}</div>`
      : ''
  }

  <div class="footer">${footer}</div>
  ${mark(branded)}`
}

/**
 * The line on an unbranded document.
 *
 * §2.2 sells "branding removal" as part of Basic+, which means there has to be
 * something to remove — until now there was no mark on an invoice at all, so
 * this is added rather than deleted.
 *
 * Kept small, grey and factual. It goes on a document somebody is sending to
 * their own client to ask for money, and anything louder would be charging
 * them for the privilege of not looking amateur. That is a fair thing to sell
 * and an unfair thing to extract.
 */
function mark(branded: boolean): string {
  return branded ? '' : '<div class="mark">Made with SoloWrk — solo-wrk.com</div>'
}

/** The invoices, what is left owing, and how long it has been owing. */
function statementBody(doc: StatementForPdf): string {
  const outstanding = doc.entries.filter((entry) => entry.paidAt === null)

  return `
  <div class="meta">
    <div>
      <div class="label">Account</div>
      <strong>${escapeHtml(doc.clientName ?? '—')}</strong>
      ${doc.clientAddress ? `<div class="small muted">${escapeHtml(doc.clientAddress)}</div>` : ''}
    </div>
    <div>
      <div class="label">As at</div>
      ${formatDate(doc.issueDate)}
    </div>
    ${
      doc.periodFrom
        ? `<div><div class="label">Showing from</div>${formatDate(doc.periodFrom)}</div>`
        : ''
    }
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:22%">Invoice</th>
        <th style="width:20%">Issued</th>
        <th style="width:20%">Due</th>
        <th style="width:20%">Status</th>
        <th class="right" style="width:18%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${
        doc.entries.length === 0
          ? `<tr><td colspan="5" class="muted">No invoices for this period.</td></tr>`
          : doc.entries
              .map(
                (entry) => `<tr>
            <td class="num">${escapeHtml(entry.number)}</td>
            <td>${formatDate(entry.issueDate)}</td>
            <td>${formatDate(entry.dueDate)}</td>
            <td>${
              entry.paidAt !== null
                ? `<span class="muted">Paid ${formatDate(entry.paidAt)}</span>`
                : entry.daysLate > 0
                  ? `<span class="late">${entry.daysLate} day${entry.daysLate === 1 ? '' : 's'} overdue</span>`
                  : '<span class="muted">Not yet due</span>'
            }</td>
            <td class="right num">${money(entry.gross)}</td>
          </tr>`
              )
              .join('')
      }
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span class="muted">Invoiced</span><span class="num">${money(doc.invoiced)}</span></div>
    <div class="totals-row"><span class="muted">Paid</span><span class="num">−${money(doc.paid)}</span></div>
    <div class="totals-row grand"><span>Outstanding</span><span class="num">${money(doc.outstanding)}</span></div>
  </div>

  ${
    // Only worth printing when there is something to age. A table of four
    // zeroes under a settled account reads as an accusation.
    outstanding.length > 0
      ? `<div class="ageing">
    <div class="label">How long it has been outstanding</div>
    <table>
      <tbody>
        ${doc.ageing
          .map(
            (bucket) => `<tr>
          <td class="${bucket.from >= 31 && bucket.amount > 0 ? 'late' : 'muted'}">${escapeHtml(bucket.label)}</td>
          <td class="right num">${money(bucket.amount)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>`
      : ''
  }

  <div class="footer">${
    doc.outstanding > 0
      ? 'If any of these have been paid recently our records may have crossed. Please get in touch and we will check.'
      : 'Nothing is outstanding on this account. Thank you.'
  }</div>`
}

/** A two-column table of named totals, used for both breakdowns. */
function breakdown(title: string, lines: SummaryLine[], total: number): string {
  if (lines.length === 0) return ''

  return `<div class="ageing">
    <div class="label">${escapeHtml(title)}</div>
    <table>
      <tbody>
        ${lines
          .map(
            (line) => `<tr>
          <td>${escapeHtml(line.label)}</td>
          <td class="right num muted">${total > 0 ? Math.round((line.amount / total) * 100) : 0}%</td>
          <td class="right num">${money(line.amount)}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>`
}

/**
 * The year in one page, for an accountant.
 *
 * States the basis in the header rather than leaving it to be inferred. A
 * figure whose basis an accountant has to guess is worse than one they have to
 * query, and "income" means at least two different numbers depending on who is
 * asking.
 */
function summaryBody(doc: YearSummaryForPdf): string {
  const rows: [string, string, boolean?][] = [
    ['Income received', money(doc.income)],
    ['Expenses', `−${money(doc.expenses)}`],
    ['Profit', money(doc.profit), true]
  ]

  // Only when there is some. A mileage line reading nil on an accountant's
  // one page invites a question about a claim nobody made.
  if (doc.mileage > 0) {
    rows.splice(2, 0, ['Mileage allowance', `−${money(doc.mileage)}`])
  }

  return `
  <div class="meta">
    <div>
      <div class="label">Tax year</div>
      <strong>${escapeHtml(doc.taxYearLabel)}</strong>
    </div>
    <div>
      <div class="label">Period</div>
      ${formatDate(doc.periodFrom)} to ${formatDate(doc.periodTo)}
    </div>
    <div>
      <div class="label">Prepared</div>
      ${formatDate(doc.issueDate)}
    </div>
  </div>

  <div class="totals" style="margin-top:26px">
    ${rows
      .map(
        ([label, value, grand]) =>
          `<div class="totals-row${grand ? ' grand' : ''}"><span${grand ? '' : ' class="muted"'}>${label}</span><span class="num">${value}</span></div>`
      )
      .join('')}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:70%">Also this year</th>
        <th class="right" style="width:30%">&nbsp;</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Invoices raised</td><td class="right num">${doc.invoicesRaised}</td></tr>
      <tr><td>Invoices paid</td><td class="right num">${doc.invoicesPaid}</td></tr>
      <tr><td>Hours tracked</td><td class="right num">${doc.hoursTracked.toFixed(1)}</td></tr>
      ${
        doc.vatRegistered
          ? `<tr><td>VAT collected on paid invoices</td><td class="right num">${money(doc.vatCollected)}</td></tr>`
          : ''
      }
      ${
        doc.setAside > 0
          ? `<tr><td>Set aside for tax at ${doc.setAsidePercent}%</td><td class="right num">${money(doc.setAside)}</td></tr>`
          : ''
      }
    </tbody>
  </table>

  ${breakdown('Where the money came from', doc.byClient, doc.income)}
  ${breakdown('What it went on', doc.byCategory, doc.expenses)}

  <div class="footer">
    Income is what was <strong>received</strong> between ${formatDate(doc.periodFrom)} and
    ${formatDate(doc.periodTo)} — the cash basis — not what was invoiced in that period.
    Expenses are counted on the date they were incurred.
    ${doc.vatRegistered ? '' : ' This business is not VAT registered.'}
    Prepared by SoloWrk from the workspace. Figures are a starting point for a return, not a
    substitute for one.
  </div>`
}

export function renderHtml(
  doc: DocumentForPdf,
  settings: Settings,
  logo: string | null = null,
  /**
   * Whether this licence has paid to have our name off the page (§2.2).
   *
   * Defaults to true, so every caller that has no opinion produces a clean
   * document. The mark is something a tier removes, not something the app
   * adds by accident — getting that default the other way round would put our
   * name on a paying customer's invoice.
   */
  branded = true
): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<style>${STYLES}</style>
</head>
<body>
  <div class="top">
    <div>
      ${logo ? `<img class="logo" src="${logo}" alt="" />` : ''}
      <h1>${HEADINGS[doc.kind]}</h1>
      ${
        // A statement's reference carries the client name and date so the file
        // is unique, but printing it here would name the client three times in
        // four lines — the Account and As at blocks below already say it.
        doc.kind === 'statement' || doc.kind === 'summary'
          ? ''
          : `<p class="muted" style="margin:4px 0 0">${escapeHtml(doc.number)}</p>`
      }
    </div>
    ${businessBlock(settings)}
  </div>
${
  doc.kind === 'statement'
    ? statementBody(doc)
    : doc.kind === 'summary'
      ? summaryBody(doc)
      : lineItemBody(doc, settings, branded)
}
</body>
</html>`
}

/**
 * The logo as a data URL, read straight from the workspace.
 *
 * Takes the path rather than the database because the renderer already has
 * `Settings` in hand, and threading a `Database` through the PDF pipeline just
 * to re-read a field it was already given would be the only reason it needed
 * one. Returns null on anything unreadable — a missing logo must never be the
 * reason an invoice fails to render.
 */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}

export async function logoFor(workspacePath: string, logoFile: string): Promise<string | null> {
  if (logoFile.trim() === '') return null

  try {
    const bytes = await readFile(resolveInWorkspace(workspacePath, logoFile))
    const mime = MIME[extname(logoFile).toLowerCase()] ?? 'image/png'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Names Windows refuses outright, whatever extension follows them. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Characters Windows will not accept in a file name, backslash included. */
const ILLEGAL = /[<>:"/\\|?*]/

/**
 * A document reference reduced to something safe to use as a file name.
 *
 * The invoice prefix is typed by the user in Settings and a statement carries
 * a client's name, so a reference can contain anything at all. A slash would
 * either try to escape the year folder or fail the write outright, and the
 * only symptom either way is an export button that does nothing.
 */
export function safeFileName(reference: string): string {
  // Built character by character rather than with a unicode escape range.
  // Written the other way, the escape sequence in the character class was
  // itself resolved before it reached the file, putting a raw control byte
  // in the source instead of the four characters meant to describe one.
  const cleaned = [...reference]
    .map((character) => (ILLEGAL.test(character) || character < ' ' ? '-' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows silently strips a trailing dot or space, which would turn two
    // different references into the same file.
    .replace(/[. ]+$/, '')

  if (cleaned === '' || RESERVED.test(cleaned)) return `document-${cleaned || 'unnamed'}`

  // Long enough for any real reference, short enough to leave room for the
  // folder path inside the old 260-character limit.
  return cleaned.slice(0, 120)
}

/**
 * Print arbitrary HTML to a PDF in the workspace.
 *
 * Split out from `writePdf` so anything that already has a page — the client
 * update pack, which is an HTML file in its own right — gets a PDF from the
 * exact same markup rather than a second renderer that drifts from the first.
 */
export async function writeHtmlPdf(
  workspacePath: string,
  html: string,
  folderRelative: string,
  name: string
): Promise<string> {
  await mkdir(resolveInWorkspace(workspacePath, folderRelative), { recursive: true })

  const fileRelative = join(folderRelative, `${safeFileName(name)}.pdf`)

  // Offscreen and never shown. sandbox stays on; the page is our own HTML with
  // no scripts, and JavaScript is disabled outright as belt and braces.
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    // Margins are zero here because the stylesheet's @page rule owns them —
    // otherwise Chromium's default margin is added on top of ours.
    const buffer = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })

    await writeFile(resolveInWorkspace(workspacePath, fileRelative), buffer)
  } finally {
    window.destroy()
  }

  return fileRelative
}

/**
 * Render to PDF and save it into the workspace, under the folder for its kind
 * and the year it was issued. Returns the workspace-relative path.
 */
export async function writePdf(
  workspacePath: string,
  doc: DocumentForPdf,
  settings: Settings,
  /** Overrides the usual filing, for a year-end pack that gathers its own. */
  into?: string,
  /** False adds the SoloWrk line. See `renderHtml`. */
  branded = true
): Promise<string> {
  const year = doc.issueDate.slice(0, 4)
  const folderRelative = into ?? join(FOLDERS[doc.kind], year)
  const logo = await logoFor(workspacePath, settings.logoFile)

  return writeHtmlPdf(
    workspacePath,
    renderHtml(doc, settings, logo, branded),
    folderRelative,
    doc.number
  )
}

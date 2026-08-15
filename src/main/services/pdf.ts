import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { DocumentLine, Settings } from '@shared/types'
import { resolveInWorkspace } from './workspace'

/**
 * Invoice and quote PDFs.
 *
 * Rendered by loading HTML into an offscreen BrowserWindow and calling
 * printToPDF, rather than drawing with a PDF library. That keeps one template
 * for both the screen and the file, and gets real text layout, web fonts and
 * page breaks for free.
 *
 * The document is printed light-on-white: this is the one thing Solo produces
 * that leaves the app, and a dark invoice would be unreadable and cost the
 * client a cartridge.
 */

export interface DocumentForPdf {
  kind: 'invoice' | 'quote'
  number: string
  issueDate: string
  /** Due date for an invoice, valid-until for a quote. */
  secondaryDate: string | null
  clientName: string | null
  clientAddress: string
  lines: DocumentLine[]
  net: number
  vat: number
  vatRate: number
  gross: number
  notes: string
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

export function renderHtml(doc: DocumentForPdf, settings: Settings): string {
  const heading = doc.kind === 'invoice' ? 'Invoice' : 'Quote'
  const secondaryLabel = doc.kind === 'invoice' ? 'Payment due' : 'Valid until'

  const businessLines = [
    settings.businessName,
    settings.addressLine1,
    settings.addressLine2,
    settings.city,
    settings.postcode,
    settings.country
  ].filter((line) => line.trim().length > 0)

  const contactLines = [settings.email, settings.phone].filter((line) => line.trim().length > 0)

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<style>
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
  .totals { margin-top: 18px; margin-left: auto; width: 260px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; }
  .totals-row.grand {
    border-top: 1.5px solid #16161a; margin-top: 6px; padding-top: 9px;
    font-size: 12.5pt; font-weight: 600;
  }
  .notes { margin-top: 34px; padding-top: 14px; border-top: 1px solid #f0f0f3; }
  .footer { margin-top: 26px; font-size: 8.5pt; color: #8a8a93; }
</style>
</head>
<body>
  <div class="top">
    <div>
      <h1>${heading}</h1>
      <p class="muted" style="margin:4px 0 0">${escapeHtml(doc.number)}</p>
    </div>
    <div class="business">
      <strong>${escapeHtml(settings.businessName || 'Your business')}</strong><br />
      ${businessLines.slice(1).map(escapeHtml).join('<br />')}
      ${contactLines.length > 0 ? `<br />${contactLines.map(escapeHtml).join('<br />')}` : ''}
      ${settings.vatRegistered && settings.vatNumber ? `<br />VAT ${escapeHtml(settings.vatNumber)}` : ''}
    </div>
  </div>

  <div class="meta">
    <div>
      <div class="label">Billed to</div>
      <strong>${escapeHtml(doc.clientName ?? '—')}</strong>
      ${doc.clientAddress ? `<div class="small muted">${escapeHtml(doc.clientAddress)}</div>` : ''}
    </div>
    <div>
      <div class="label">Issued</div>
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
    <div class="totals-row grand"><span>Total</span><span class="num">${money(doc.gross)}</span></div>
  </div>

  ${doc.notes ? `<div class="notes"><div class="label">Notes</div>${escapeHtml(doc.notes)}</div>` : ''}

  ${
    doc.kind === 'invoice'
      ? `<div class="footer">Payment due by ${doc.secondaryDate ? formatDate(doc.secondaryDate) : 'the agreed date'}.${
          settings.vatRegistered ? '' : ' VAT is not charged on this invoice.'
        }</div>`
      : `<div class="footer">This quote is valid until ${doc.secondaryDate ? formatDate(doc.secondaryDate) : 'further notice'}.</div>`
  }
</body>
</html>`
}

/**
 * Render to PDF and save it into the workspace under Invoices/<year> or
 * Quotes/<year>. Returns the workspace-relative path.
 */
export async function writePdf(
  workspacePath: string,
  doc: DocumentForPdf,
  settings: Settings
): Promise<string> {
  const year = doc.issueDate.slice(0, 4)
  const folderRelative = join(doc.kind === 'invoice' ? 'Invoices' : 'Quotes', year)
  await mkdir(resolveInWorkspace(workspacePath, folderRelative), { recursive: true })

  const fileRelative = join(folderRelative, `${doc.number}.pdf`)
  const absolute = resolveInWorkspace(workspacePath, fileRelative)

  // Offscreen and never shown. sandbox stays on; the page is our own HTML with
  // no scripts, and JavaScript is disabled outright as belt and braces.
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })

  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(renderHtml(doc, settings))}`
    )

    // Margins are zero here because the stylesheet's @page rule owns them —
    // otherwise Chromium's default margin is added on top of ours.
    const buffer = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })

    await writeFile(absolute, buffer)
  } finally {
    window.destroy()
  }

  return fileRelative
}

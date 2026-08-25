import type { ClientUpdatePack, Settings } from '@shared/types'

/**
 * The client update pack, as a self-contained page.
 *
 * One file with everything inside it — styles, the logo as a data URL, no
 * scripts and no external requests. It has to survive being an email
 * attachment opened on a locked-down office machine, which rules out anything
 * fetched at view time.
 *
 * Rendered light-on-white like the invoices. This is the second thing the app
 * produces that leaves it, and it will be read by somebody who has never heard
 * of SoloWrk on a screen we know nothing about.
 *
 * The same HTML becomes the PDF, so there is one renderer rather than two
 * drifting apart.
 */

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
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function hours(value: number): string {
  return `${value.toFixed(1)}h`
}

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  active: 'In progress',
  on_hold: 'On hold',
  completed: 'Complete',
  cancelled: 'Cancelled'
}

export function renderUpdatePack(
  pack: ClientUpdatePack,
  settings: Settings,
  logo: string | null
): string {
  const greeting = pack.contactName.trim() || pack.clientName

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(pack.clientName)} — project update</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 20px 48px;
    font-family: -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    color: #16161a;
    background: #f4f4f6;
  }
  .sheet {
    max-width: 720px;
    margin: 0 auto;
    background: #fff;
    border-radius: 12px;
    padding: 40px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  /* The card framing is screen dressing. On paper the page is the card. */
  @media print {
    body { padding: 0; background: #fff; }
    .sheet { max-width: none; border-radius: 0; padding: 0; box-shadow: none; }
  }
  .logo { display: block; max-height: 44px; max-width: 200px; object-fit: contain; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 25px; font-weight: 650; letter-spacing: -0.02em; }
  .lede { margin: 8px 0 0; color: #5d5d68; font-size: 15px; }
  .rule { height: 1px; background: #e8e8ee; margin: 28px 0; border: 0; }
  h2 {
    margin: 0 0 14px; font-size: 11px; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase; color: #8a8a93;
  }
  .headline { display: flex; gap: 32px; flex-wrap: wrap; margin-bottom: 4px; }
  .headline div { min-width: 120px; }
  .headline .n { font-size: 24px; font-weight: 650; letter-spacing: -0.01em; }
  .headline .l { font-size: 12px; color: #8a8a93; }
  .project { padding: 18px 0; border-top: 1px solid #f0f0f3; page-break-inside: avoid; }
  .project:first-of-type { border-top: 0; }
  .ptop { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .swatch { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .pname { font-size: 17px; font-weight: 600; }
  .pill {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px;
    background: #f0f0f3; color: #5d5d68;
  }
  .pill.done { background: #e6f5ec; color: #1d7a4c; }
  .pmeta { margin-left: auto; font-size: 12.5px; color: #8a8a93; white-space: nowrap; }
  .lists { display: flex; gap: 32px; margin-top: 12px; flex-wrap: wrap; }
  .lists > div { flex: 1 1 240px; min-width: 200px; }
  .lists h3 {
    margin: 0 0 6px; font-size: 11px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; color: #a0a0aa;
  }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 3px 0; font-size: 14px; }
  li.done::marker { color: #1d7a4c; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th {
    text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    color: #8a8a93; font-weight: 600; padding-bottom: 8px; border-bottom: 1px solid #e8e8ee;
  }
  td { padding: 10px 0; border-bottom: 1px solid #f4f4f6; font-size: 14px; }
  .right { text-align: right; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .late { color: #b4232a; font-weight: 600; }
  .total { font-weight: 650; font-size: 16px; }
  .foot { margin-top: 28px; font-size: 12.5px; color: #8a8a93; }
  .none { color: #8a8a93; font-size: 14px; margin: 0; }
</style>
</head>
<body>
<div class="sheet">
  ${logo ? `<img class="logo" src="${logo}" alt="" />` : ''}

  <h1>Project update for ${escapeHtml(pack.clientName)}</h1>
  <p class="lede">
    ${escapeHtml(greeting === pack.clientName ? 'Where things stand' : `Hello ${greeting} — where things stand`)},
    as at ${formatDate(pack.asOf)}. Covering work since ${formatDate(pack.since)}.
  </p>

  <hr class="rule" />

  <div class="headline">
    <div>
      <div class="n">${pack.projects.length}</div>
      <div class="l">${pack.projects.length === 1 ? 'project' : 'projects'} on the go</div>
    </div>
    <div>
      <div class="n">${hours(pack.hoursRecent)}</div>
      <div class="l">logged in this period</div>
    </div>
    ${
      pack.outstandingTotal > 0
        ? `<div>
      <div class="n">${money(pack.outstandingTotal)}</div>
      <div class="l">outstanding</div>
    </div>`
        : ''
    }
  </div>

  <hr class="rule" />

  <h2>The work</h2>
  ${
    pack.projects.length === 0
      ? '<p class="none">No active projects at the moment.</p>'
      : pack.projects.map(renderProject).join('')
  }

  ${
    pack.outstanding.length > 0
      ? `<hr class="rule" />
  <h2>Invoices outstanding</h2>
  <table>
    <thead>
      <tr>
        <th style="width:28%">Invoice</th>
        <th style="width:24%">Issued</th>
        <th style="width:26%">Due</th>
        <th class="right" style="width:22%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${pack.outstanding
        .map(
          (invoice) => `<tr>
        <td class="num">${escapeHtml(invoice.number)}</td>
        <td>${formatDate(invoice.issueDate)}</td>
        <td class="${invoice.overdue ? 'late' : ''}">${formatDate(invoice.dueDate)}${
          invoice.overdue ? ' — overdue' : ''
        }</td>
        <td class="right num">${money(invoice.gross)}</td>
      </tr>`
        )
        .join('')}
      <tr>
        <td colspan="3" class="total">Total outstanding</td>
        <td class="right num total">${money(pack.outstandingTotal)}</td>
      </tr>
    </tbody>
  </table>`
      : ''
  }

  <p class="foot">
    Any questions on any of this, just reply and I will pick it up.<br />
    ${escapeHtml(settings.contactName || settings.businessName || '')}${
      settings.email ? ` · ${escapeHtml(settings.email)}` : ''
    }${settings.phone ? ` · ${escapeHtml(settings.phone)}` : ''}
  </p>
</div>
</body>
</html>`
}

function renderProject(project: ClientUpdatePack['projects'][number]): string {
  const label = STATUS_LABELS[project.status] ?? project.status

  return `<div class="project">
    <div class="ptop">
      <span class="swatch" style="background:${escapeHtml(project.colour)}"></span>
      <span class="pname">${escapeHtml(project.name)}</span>
      <span class="pill${project.status === 'completed' ? ' done' : ''}">${escapeHtml(label)}</span>
      <span class="pmeta">
        ${project.dueOn ? `Due ${formatDate(project.dueOn)} · ` : ''}${hours(project.hoursTotal)} total
      </span>
    </div>

    ${
      project.completed.length === 0 && project.next.length === 0
        ? ''
        : `<div class="lists">
      ${
        project.completed.length > 0
          ? `<div>
        <h3>Done since last update</h3>
        <ul>${project.completed.map((title) => `<li class="done">${escapeHtml(title)}</li>`).join('')}</ul>
      </div>`
          : ''
      }
      ${
        project.next.length > 0
          ? `<div>
        <h3>Coming up next</h3>
        <ul>${project.next.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>
      </div>`
          : ''
      }
    </div>`
    }
  </div>`
}

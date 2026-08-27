/**
 * The templates the app ships with.
 *
 * Written for UK freelancers and meant to be used, not admired: a real
 * contract with a real payment clause, a proposal that asks for a decision, a
 * late-payment notice that cites the Act by name. A folder of Word files is
 * the thing being replaced, and a starter library of vague placeholders would
 * not replace it.
 *
 * **They are starting points, not legal advice**, and every one says so where
 * the user can see it rather than in a footnote nobody reads. That line is not
 * throat-clearing: somebody is going to send one of these to a client, and
 * being straight about what it is costs one sentence.
 *
 * Seeded into `document_templates` on first run, editable afterwards, and
 * never rewritten by an update — an app that quietly reverted somebody's
 * amended contract would be unforgivable.
 */

import type { DocumentKind } from './types'

export interface StarterTemplate {
  name: string
  kind: DocumentKind
  /** One line, shown in the picker. */
  summary: string
  body: string
}

/** Shown once, above the editor, on any template that becomes an agreement. */
export const LEGAL_NOTE =
  'A starting point, not legal advice. Read it, change what does not fit, and take proper advice for anything unusual or high-value.'

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: 'Freelance contract',
    kind: 'contract',
    summary: 'A short working agreement covering fee, timescale, revisions, IP and late payment.',
    body: `# Agreement for services

**Between** {{user.business_name}} ("the Supplier")
**and** {{client.company}} ("the Client")
**Dated** {{today}}

## 1. The work

The Supplier will carry out the work described as **{{project.name}}**.

{{#if project.description}}{{project.description}}

{{/if}}Anything not described above is outside this agreement and is quoted separately.

## 2. Fee

The fee for the work is **{{project.value}}**, exclusive of VAT{{#if user.vat_number}} (VAT number {{user.vat_number}}){{/if}}.

Expenses agreed in advance are charged at cost.

## 3. Payment

Invoices are payable within **{{user.payment_terms}}** of the invoice date.

The Supplier may suspend work on any overdue account, and may charge interest and compensation under the Late Payment of Commercial Debts (Interest) Act 1998.

## 4. Timescale

{{#if project.start}}Work begins on {{project.start}}.
{{/if}}{{#if project.due}}The agreed completion date is {{project.due}}.
{{/if}}
Timescales assume the Client supplies materials, feedback and approvals promptly. Delay by the Client moves the completion date by at least the length of the delay.

## 5. Revisions

The fee includes two rounds of revision at each agreed stage. Further revisions, and changes to work already approved, are charged at {{#if project.rate}}{{project.rate}} per hour{{/if}}{{#if project.rate}} {{/if}}or by prior quotation.

## 6. Intellectual property

The Supplier owns all rights in the work until the final invoice is paid in full. On payment in full, ownership of the delivered work passes to the Client.

The Supplier keeps the right to show the work in a portfolio and to describe it as their own, unless the parties agree otherwise in writing.

The Supplier keeps ownership of underlying tools, source assets, templates and working files, which are not part of the deliverables unless expressly agreed.

## 7. Cancellation

Either party may end this agreement in writing. The Client pays for all work carried out up to the date of cancellation, plus any commitments the Supplier has already made on the Client's behalf.

## 8. Liability

The Supplier's total liability under this agreement is limited to the fee paid. Neither party is liable for loss of profit, loss of business or any indirect loss.

Nothing here limits liability for death or personal injury caused by negligence, or for fraud.

## 9. Law

This agreement is governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.

---

**Signed for the Supplier**

{{user.contact}}, {{user.business_name}} · Date:

**Signed for the Client**

{{client.contact}}, {{client.company}} · Date:
`
  },

  {
    name: 'Proposal',
    kind: 'proposal',
    summary: 'What you understood, what you will do, what it costs, and what happens next.',
    body: `# Proposal: {{project.name}}

**Prepared for** {{client.company}}
**By** {{user.business_name}}
**Date** {{today}}

## What you need

{{#if project.description}}{{project.description}}
{{/if}}
_Say back what they told you, in their words. A client who reads their own problem described accurately has already half decided._

## What I would do

1.
2.
3.

## What you get

-
-

## What it costs

**{{project.value}}**, exclusive of VAT.

{{#if project.rate}}Additional work beyond this scope is charged at {{project.rate}} per hour, quoted before it starts.
{{/if}}
Payment terms are {{user.payment_terms}}.

## Timescale

{{#if project.due}}Delivery by {{project.due}}, assuming a start in the next two weeks and prompt feedback at each stage.
{{/if}}
## What is not included

-

_Being explicit here prevents the conversation nobody enjoys later._

## Next step

Reply to confirm and I will send the agreement and the first invoice. This proposal holds for 30 days.

{{user.contact}}
{{user.email}}{{#if user.phone}} · {{user.phone}}{{/if}}
`
  },

  {
    name: 'Scope of work',
    kind: 'scope',
    summary: 'Deliverables, exclusions, assumptions and acceptance — the document that ends arguments.',
    body: `# Scope of work: {{project.name}}

**Client** {{client.company}}
**Supplier** {{user.business_name}}
**Date** {{today}}

## Deliverables

| # | Deliverable | Format | Due |
|---|---|---|---|
| 1 |  |  | {{#if project.due}}{{project.due}}{{/if}} |
| 2 |  |  |  |

## Explicitly not included

-
-

_The most valuable section in the document. Anything not written here is the thing that gets assumed._

## Assumptions

- The Client provides all content, references and approvals within three working days of request.
- Feedback is consolidated into one response per round.
- Work is carried out remotely unless agreed otherwise.

## Revisions

Two rounds per stage are included. Changes to approved work are a variation and are quoted separately.

## Acceptance

A deliverable is accepted when the Client confirms in writing, or after five working days without comment.

## Change control

Any change to this scope is agreed in writing, with its price and its effect on the timescale, before the work starts.

**Fee for the scope above:** {{project.value}}
`
  },

  {
    name: 'Terms and conditions',
    kind: 'terms',
    summary: 'Standing terms to attach to quotes and invoices, so each job needs no new contract.',
    body: `# Terms of business

**{{user.business_name}}**
{{#if user.address}}{{user.address}}
{{/if}}{{user.email}}{{#if user.phone}} · {{user.phone}}{{/if}}
{{#if user.vat_number}}VAT number {{user.vat_number}}
{{/if}}
_Version dated {{today}}. These terms apply to all work unless a signed agreement says otherwise._

## 1. Quotations

Quotations are valid for 30 days and are based on the information supplied at the time. If that information changes, the quotation may change.

## 2. Acceptance

Instructing the work in writing, or paying a deposit, accepts these terms.

## 3. Fees and payment

Invoices are payable within {{user.payment_terms}} of the invoice date, by bank transfer.

Accounts overdue by more than 30 days may be suspended. Interest and fixed compensation may be charged under the Late Payment of Commercial Debts (Interest) Act 1998.

## 4. Deposits

Work over £1,000 may require a deposit of up to 50% before it begins. Deposits are non-refundable once work has started.

## 5. Client responsibilities

The Client supplies accurate materials and timely approvals, and holds the rights to any content they supply.

## 6. Intellectual property

Rights in the delivered work pass to the Client on payment in full. Source files, working assets and the Supplier's own tools are not included unless agreed in writing.

The Supplier may show the work in a portfolio unless asked in writing not to.

## 7. Confidentiality

Each party keeps the other's non-public information confidential and uses it only for the work.

## 8. Data protection

Personal data is processed only as needed for the work, in line with UK GDPR, and is not shared with anyone else without instruction.

## 9. Liability

Total liability is limited to the fee paid for the work concerned. Indirect loss, loss of profit and loss of business are excluded. Nothing here limits liability for death or personal injury caused by negligence, or for fraud.

## 10. Cancellation

Either party may cancel in writing. The Client pays for work done and commitments already made.

## 11. Law

England and Wales.
`
  },

  {
    name: 'Late payment notice',
    kind: 'notice',
    summary: 'The formal letter before action, with the statutory interest and compensation named.',
    body: `# Notice of overdue payment

**To** {{client.contact}}, {{client.company}}
**From** {{user.business_name}}
**Date** {{today}}

Dear {{client.contact}},

Our invoice remains unpaid and is now past its due date. I have written previously and have not had a reply.

**Please pay in full within 7 days of the date of this notice.**

## Statutory rights

Under the Late Payment of Commercial Debts (Interest) Act 1998 I am entitled to charge, on a commercial debt that is overdue:

- **Statutory interest** at 8% above the Bank of England base rate, running from the day after the due date; and
- **Fixed compensation** for the cost of recovering the debt — £40 on a debt under £1,000, £70 between £1,000 and £9,999.99, and £100 on £10,000 or more.

I would much rather not add either. Paying within 7 days settles the matter on the original amount.

## If there is a problem

If there is a dispute about the work, or a difficulty paying, tell me and I will do what I reasonably can. What I cannot do is nothing.

If I have not heard from you within 7 days I will treat the debt as undisputed and may begin recovery proceedings without further notice.

Yours sincerely,

{{user.contact}}
{{user.business_name}}
{{user.email}}{{#if user.phone}} · {{user.phone}}{{/if}}
`
  },

  {
    name: 'Variation request',
    kind: 'variation',
    summary: 'A change to agreed work, priced, so the awkward conversation becomes a document.',
    body: `# Variation to agreed work

**Project** {{project.name}}
**Client** {{client.company}}
**Supplier** {{user.business_name}}
**Date** {{today}}

## What was agreed

The scope agreed on {{#if project.start}}{{project.start}}{{/if}} covered the deliverables in the scope of work, including two rounds of revision at each stage.

## What has been asked for since

_Describe the change plainly and without grievance. This document exists to price a change, not to win an argument._

-

## Why it is a variation

The work above is outside the agreed scope{{#if project.due}}, and cannot be absorbed without moving the completion date of {{project.due}}{{/if}}.

## What it costs

| Item | Basis | Price |
|---|---|---|
|  | {{#if project.rate}}{{project.rate}}/hour{{/if}} |  |
| **Total** |  |  |

## Effect on the timescale

Accepting this variation moves delivery by ___ working days.

## To proceed

Reply confirming this variation and I will carry it out and invoice it with the next stage. Until then I will continue with the originally agreed scope so nothing stalls.

{{user.contact}}
{{user.email}}
`
  }
]

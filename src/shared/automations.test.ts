import { describe, expect, it } from 'vitest'
import { actionAllowedFor, describeRule, fillTokens, type AutomationSubject } from './automations'

const SUBJECT: AutomationSubject = {
  key: 'invoice:1',
  id: 1,
  label: 'INV-014',
  clientName: 'Acme Ltd',
  projectId: 3,
  amount: 120000,
  days: 14
}

describe('filling in the wording', () => {
  it('puts the thing it matched into the sentence', () => {
    expect(fillTokens('Ring {client} about {name}', SUBJECT)).toBe('Ring Acme Ltd about INV-014')
  })

  it('formats money as money', () => {
    expect(fillTokens('Chase {amount}', SUBJECT)).toBe('Chase £1,200.00')
  })

  it('leaves an unknown token exactly as typed', () => {
    // So somebody who writes {clientname} gets a task saying {clientname},
    // sees what went wrong and fixes it — rather than a task that says
    // "Chase undefined" and looks like a bug in the app.
    expect(fillTokens('Chase {clientname}', SUBJECT)).toBe('Chase {clientname}')
  })

  it('tidies up after a token with nothing in it', () => {
    // An internal project has no client. "Invoice for" beats "Invoice for {client}"
    // and also beats "Invoice for  " with two spaces in it.
    const internal = { ...SUBJECT, clientName: null }
    expect(fillTokens('Invoice {client} for {name}', internal)).toBe('Invoice for INV-014')
  })

  it('copes with wording that has no tokens at all', () => {
    expect(fillTokens('Do the thing', SUBJECT)).toBe('Do the thing')
    expect(fillTokens('', SUBJECT)).toBe('')
  })
})

describe('reading a rule back', () => {
  it('says what it will do, as a sentence', () => {
    // The same job the chase-schedule hint does: show what was understood, so
    // a rule that will never fire looks wrong in the form rather than being
    // discovered as silence three weeks later.
    const sentence = describeRule({
      trigger: 'invoice_overdue',
      triggerDays: 14,
      action: 'create_task',
      actionText: 'Ring them'
    })

    expect(sentence).toContain('14 days')
    expect(sentence).toContain('Ring them')
  })

  it('gets the singular right', () => {
    expect(
      describeRule({
        trigger: 'invoice_overdue',
        triggerDays: 1,
        action: 'notify',
        actionText: 'x'
      })
    ).toContain('1 day,')
  })

  it('leaves the days out of a trigger that has none', () => {
    expect(
      describeRule({
        trigger: 'invoice_paid',
        triggerDays: 14,
        action: 'notify',
        actionText: 'Lovely'
      })
    ).not.toContain('14')
  })
})

describe('which actions go with which triggers', () => {
  it('only drafts an invoice off a project', () => {
    // It needs a project to bill and unbilled time to bill for. Offering it
    // elsewhere would be a rule that looks like it works and quietly does not.
    expect(actionAllowedFor('draft_invoice', 'project_completed')).toBe(true)
    expect(actionAllowedFor('draft_invoice', 'invoice_overdue')).toBe(false)
  })

  it('lets the other two go anywhere', () => {
    for (const trigger of ['invoice_overdue', 'invoice_paid', 'document_expiring'] as const) {
      expect(actionAllowedFor('create_task', trigger), trigger).toBe(true)
      expect(actionAllowedFor('notify', trigger), trigger).toBe(true)
    }
  })
})

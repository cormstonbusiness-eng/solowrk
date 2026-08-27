import { describe, expect, it } from 'vitest'
import { fieldsIn, merge, unknownFields, MERGE_FIELDS } from './merge'

/**
 * Merge fields.
 *
 * These end up in a contract somebody sends to a client. The failure that
 * matters is the quiet one — a blank where a name should be, or a deposit
 * clause that survived into a document with no deposit.
 */

describe('filling a template', () => {
  it('puts the value where the field was', () => {
    const result = merge('Between {{user.business_name}} and {{client.company}}.', {
      'user.business_name': 'Blockout Digital',
      'client.company': 'Northgate Studio Ltd'
    })

    expect(result.text).toBe('Between Blockout Digital and Northgate Studio Ltd.')
    expect(result.unresolved).toEqual([])
  })

  it('tolerates the spaces people type', () => {
    expect(merge('{{ client.company }}', { 'client.company': 'Acme' }).text).toBe('Acme')
  })

  it('fills every occurrence, not just the first', () => {
    const result = merge('{{client.company}} … {{client.company}}', { 'client.company': 'Acme' })
    expect(result.text).toBe('Acme … Acme')
  })

  it('leaves an unresolved field standing rather than blank', () => {
    // A contract with an empty space where the client's name should be is a
    // document somebody sends without noticing. One that still says
    // {{client.company}} is not.
    const result = merge('For {{client.company}}.', {})

    expect(result.text).toBe('For {{client.company}}.')
    expect(result.unresolved).toEqual(['client.company'])
  })

  it('treats an empty string as unresolved', () => {
    // A client record with a blank phone number is a missing phone number,
    // not a phone number that is nothing.
    const result = merge('Call {{client.phone}}.', { 'client.phone': '   ' })
    expect(result.unresolved).toEqual(['client.phone'])
  })

  it('names each missing field once, however often it appears', () => {
    const result = merge('{{client.company}} {{client.company}} {{client.email}}', {})
    expect(result.unresolved).toEqual(['client.company', 'client.email'])
  })

  it('says what it did fill in', () => {
    const result = merge('{{client.company}} on {{today}}', { 'client.company': 'Acme' })
    expect(result.filled).toEqual(['client.company'])
    expect(result.unresolved).toEqual(['today'])
  })

  it('takes a number as a value', () => {
    expect(merge('{{project.value}}', { 'project.value': 480_000 }).text).toBe('480000')
  })

  it('leaves braces alone that are not a field', () => {
    const prose = 'Use {{ } and { }} carefully, and {{not a field}} either.'
    expect(merge(prose, {}).text).toBe(prose)
  })

  it('does not go looking for fields in the values it just inserted', () => {
    // Otherwise a client called "{{user.email}} Ltd" reads the user's address
    // book into a document meant for them.
    const result = merge('{{client.company}}', { 'client.company': '{{user.email}} Ltd' })
    expect(result.text).toBe('{{user.email}} Ltd')
  })
})

describe('conditional blocks', () => {
  it('keeps the block when the field has a value', () => {
    const result = merge('Fee.{{#if project.value}} Deposit of {{project.value}}.{{/if}}', {
      'project.value': '£4,800.00'
    })
    expect(result.text).toBe('Fee. Deposit of £4,800.00.')
  })

  it('drops the block when it does not', () => {
    // A deposit clause in a contract with no deposit is worse than no clause.
    const result = merge('Fee.{{#if project.value}} Deposit of {{project.value}}.{{/if}}', {})
    expect(result.text).toBe('Fee.')
  })

  it('does not report a field inside a dropped block as missing', () => {
    // It is not missing. It does not apply.
    const result = merge('{{#if project.value}}{{project.rate}}{{/if}}', {})
    expect(result.unresolved).toEqual([])
  })

  it('treats zero as nothing', () => {
    // A project worth £0 has no deposit to mention.
    const result = merge('{{#if project.value}}Deposit.{{/if}}', { 'project.value': 0 })
    expect(result.text).toBe('')
  })

  it('handles two blocks in one template', () => {
    const template = '{{#if a}}A{{/if}}|{{#if b}}B{{/if}}'
    expect(merge(template, { a: 'yes' }).text).toBe('A|')
    expect(merge(template, { b: 'yes' }).text).toBe('|B')
  })

  it('keeps a block spanning several lines', () => {
    const result = merge('{{#if a}}\nline one\nline two\n{{/if}}', { a: 'yes' })
    expect(result.text).toBe('\nline one\nline two\n')
  })
})

describe('reading a template', () => {
  it('lists what it will ask for', () => {
    expect(fieldsIn('{{client.company}} and {{project.name}}')).toEqual([
      'client.company',
      'project.name'
    ])
  })

  it('counts the field a conditional tests on', () => {
    expect(fieldsIn('{{#if project.value}}x{{/if}}')).toContain('project.value')
  })

  it('catches a field that will never resolve for anybody', () => {
    // A typo is worth saying while somebody is writing the template, not while
    // they are generating a contract for a client who is waiting.
    expect(unknownFields('{{clint.company}}')).toEqual(['clint.company'])
    expect(unknownFields('{{client.company}}')).toEqual([])
  })

  it('has an example for every field it offers', () => {
    // The picker shows these, and a field whose shape is not obvious is a
    // field somebody uses wrongly once and then never again.
    for (const field of MERGE_FIELDS) {
      expect(field.example, field.key).not.toBe('')
      expect(field.label, field.key).not.toBe('')
    }
  })
})

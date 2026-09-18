import { describe, expect, it } from 'vitest'
import { messageFrom, unwrapIpcError } from './ipcError'
import { limitFactsFrom, LimitReachedError } from './limitError'

/**
 * The envelope Electron puts around every rejected `invoke`, and taking it off
 * without breaking the two errors that hide a payload inside their message.
 */

const envelope = (channel: string, message: string): string =>
  `Error invoking remote method '${channel}': Error: ${message}`

describe('taking the envelope off', () => {
  it('leaves only what the main process actually said', () => {
    expect(unwrapIpcError(envelope('auth:signIn', 'That email and password do not match.'))).toBe(
      'That email and password do not match.'
    )
  })

  it('leaves an ordinary message alone', () => {
    // This has to be invisible to anything it does not apply to.
    expect(unwrapIpcError('That email and password do not match.')).toBe(
      'That email and password do not match.'
    )
  })

  it('does not strip "Error:" from a message that never crossed IPC', () => {
    /*
      A message beginning "Error:" outside an envelope meant to. Only the class
      name Electron itself prepended is removed, and only when the envelope
      proves it was Electron that did it.
    */
    expect(unwrapIpcError('Error: the file could not be read')).toBe(
      'Error: the file could not be read'
    )
  })

  it('removes only one leading class name', () => {
    expect(unwrapIpcError(envelope('files:import', 'Error: nested on purpose'))).toBe(
      'Error: nested on purpose'
    )
  })

  it('copes with a channel name containing punctuation', () => {
    expect(unwrapIpcError(envelope('clients:create', 'Nope.'))).toBe('Nope.')
  })
})

describe('the errors that carry a payload', () => {
  it('still yields its facts after the envelope is removed', () => {
    /*
      The reason this is safe at all. `LimitReachedError` hides JSON behind a
      sentinel and `limitFactsFrom` searches for it with `indexOf` rather than
      matching from the start — so a prefix coming off changes nothing about
      whether it can be found. If that ever became a prefix match, this test is
      what would notice.
    */
    const thrown = new LimitReachedError({
      limit: 'clients',
      used: 3,
      cap: 3,
      tier: 'free',
      needs: 'basicPlus'
    })

    const wrapped = envelope('clients:create', thrown.message)

    expect(limitFactsFrom(new Error(wrapped))).toMatchObject({ limit: 'clients', cap: 3 })
    expect(limitFactsFrom(new Error(unwrapIpcError(wrapped)))).toMatchObject({
      limit: 'clients',
      cap: 3
    })
  })
})

describe('messageFrom', () => {
  it('reads an Error, a string, or neither', () => {
    expect(messageFrom(new Error(envelope('auth:signIn', 'Nope.')))).toBe('Nope.')
    expect(messageFrom(envelope('auth:signIn', 'Nope.'))).toBe('Nope.')
    expect(messageFrom(null)).toBe('Something went wrong.')
    expect(messageFrom(undefined, 'Could not save.')).toBe('Could not save.')
  })

  it('falls back when the envelope was all there was', () => {
    // A rejection with an empty message would otherwise render as a blank
    // space where an explanation should be, which reads as the app freezing.
    expect(messageFrom(new Error(envelope('auth:signIn', '')))).toBe('Something went wrong.')
  })
})

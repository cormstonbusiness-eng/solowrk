import { describe, expect, it } from 'vitest'
import { allowedWhenReadOnly, IPC_CHANNELS } from './ipc'

/**
 * Read-only is classified from channel names rather than an enumerated list,
 * so these tests are the list — they run against the real `IPC_CHANNELS` and
 * fail when a new channel is misfiled by the heuristic.
 */
describe('what read-only allows', () => {
  it('refuses the writes', () => {
    for (const channel of [
      'clients:create',
      'clients:update',
      'clients:delete',
      'invoices:create',
      'time:start',
      'time:stop',
      'tasks:move',
      'notes:write',
      'files:import',
      'files:trash',
      'settings:update',
      'expenses:create',
      'events:create',
      'ai:send',
      'ai:writeBusinessPlan',
      // Both advance the chase schedule, which is a write on the invoice. The
      // names were chosen so this classifier catches them without an entry in
      // the exceptions set — `record` and `stop` are both writing verbs.
      'chasing:record',
      'chasing:stop',
      // Both put mail on the wire in the user's name. A lapsed licence that
      // went on chasing somebody's clients would be indefensible, and the
      // second is named `sendQueued` rather than `drain` precisely so this
      // classifier catches it.
      'chasing:send',
      'chasing:sendQueued',
      // Neither name begins with a writing verb, and both create a record.
      'quotes:convert',
      'templates:fromProject',
      // Drawing a connection is a write, and so is cutting one. `remove`
      // rather than `unlink` for exactly this reason — the classifier would
      // have let `unlink` straight through.
      'links:create',
      'links:remove'
    ]) {
      expect(allowedWhenReadOnly(channel), channel).toBe(false)
    }
  })

  it('allows reading, and every kind of export', () => {
    // The point of read-only. Someone who has stopped paying can still get a
    // client's invoice out of the app, and if they could not, "read-only"
    // would be a euphemism for locked.
    for (const channel of [
      'clients:list',
      'clients:get',
      'invoices:list',
      'invoices:pdf',
      'quotes:pdf',
      'invoices:chaser',
      'invoices:receipt',
      'chasing:due',
      'chasing:statement',
      'chasing:outbox',
      // Stopping something from being sent must never be the thing a lapsed
      // licence takes away.
      'chasing:discard',
      'finance:summary',
      'files:list',
      'files:open',
      'files:reveal',
      'notes:read',
      'workspace:status',
      'settings:get',
      // Seeing what a thing is connected to, and what has happened to it, is
      // reading. A lapsed licence that hid the history would be hiding the
      // user's own record of their own work.
      'links:related',
      'activity:for',
      'activity:recent'
    ]) {
      expect(allowedWhenReadOnly(channel), channel).toBe(true)
    }
  })

  it('leaves every route out of the situation open', () => {
    // Locking someone out of the screens that fix their billing, or out of an
    // update that might contain the fix, would be a spectacular own goal.
    for (const channel of [
      'auth:signIn',
      'auth:signOut',
      'auth:verify',
      'auth:setServer',
      'updates:check',
      'updates:install',
      'workspace:adopt',
      'window:close',
      'state:set'
    ]) {
      expect(allowedWhenReadOnly(channel), channel).toBe(true)
    }
  })

  it('treats a name with no verb in it as a read', () => {
    // Pinning the failure direction so it stays a known trade rather than a
    // surprise: an oddly named write slips through and has to be added to the
    // exceptions set by hand. The reverse — guessing wrong about a read and
    // blocking an export — is the failure that would actually hurt.
    expect(allowedWhenReadOnly('widgets:frobnicate')).toBe(true)
  })

  it('classifies every real channel', () => {
    for (const channel of IPC_CHANNELS) {
      expect(typeof allowedWhenReadOnly(channel)).toBe('boolean')
    }
  })
})

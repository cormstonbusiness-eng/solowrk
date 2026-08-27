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
      'calendar:createBlock',
      'calendar:updateSettings',
      // The calendar's writing verbs, every one of which had to be added to
      // the list: `edit`, `schedule` and `adopt` are all writes, and the
      // classifier fails open, so an unrecognised verb would have let them
      // straight through on a lapsed licence.
      'calendar:editOccurrence',
      'calendar:deleteOccurrence',
      'calendar:scheduleTask',
      'calendar:adoptEstimate',
      // Subscribing reaches the network and writes rows; unsubscribing takes
      // them away; copying makes one. `unsubscribe` and `copy` both had to be
      // added to the verb list for the same fail-open reason as the rest.
      'calendar:subscribe',
      'calendar:unsubscribe',
      'calendar:copyToMine',
      'calendar:syncSubscription',
      'calendar:importIcs',
      // A milestone is a date somebody is held to. `reached` had to join
      // the verb list for the usual fail-open reason.
      'milestones:create',
      'milestones:reached',
      'milestones:delete',
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
      'links:remove',
      // A saved view is the user's own arrangement of a screen, but it is
      // still a write, and `save` and `delete` are both writing verbs.
      'views:save',
      'views:delete',
      // Emptying the trash is destructive, filing something away is work, and
      // `purge`, `empty` and `archive` were all added to the verb list so the
      // classifier catches them rather than an exceptions entry doing it.
      'trash:purge',
      'trash:empty',
      'entity:archive',
      'entity:delete',
      // Tags. `recolour` had to be added to the verb list: it is a write, and
      // the classifier fails open, so an unrecognised verb would have let it
      // through on a lapsed licence.
      'tags:add',
      'tags:remove',
      'tags:rename',
      'tags:recolour',
      'tags:delete',
      // Mileage. `setRate` is a write because it re-values every journey in
      // the log — a lapsed licence must not be able to change what past years
      // are worth.
      'mileage:create',
      'mileage:update',
      'mileage:delete',
      'mileage:setRate',
      // The bank import. `ignore` and `unmatch` are writes despite reading
      // like dismissals — both change what the app believes about an invoice.
      'bank:import',
      'bank:matchInvoice',
      'bank:matchExpense',
      'bank:createExpense',
      'bank:ignore',
      'bank:unmatch',
      'bank:forget',
      // Documents. `generate` and `setStatus` both write; `restore` and
      // `restoreVersion` write a new version rather than reading an old one.
      'docTemplates:create',
      'docTemplates:update',
      'docTemplates:delete',
      'docTemplates:restore',
      'documents:generate',
      'documents:save',
      'documents:restoreVersion',
      'documents:setStatus',
      // Filing the review writes a note. `file` is not a write verb the
      // classifier knows, so it is pinned here and added to WRITE_VERBS.
      'review:file',
      // Repair creates folders; applyRename moves files.
      'structure:repair',
      'structure:applyRename',
      // The board. `win` makes a client, so it is a write in the
      // strongest sense — and `move` is one the classifier already knows.
      'leads:create',
      'leads:update',
      'leads:move',
      'leads:win',
      'leads:delete'
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
      'activity:recent',
      // Looking a row up by name is reading, and `find` is not a writing verb.
      'entity:label',
      'entity:find',
      // Reading the views, and asking whether a name is taken.
      'views:list',
      'views:taken',
      // Reading the trash, and taking something back out of it. The second is
      // a write, and it is in the exceptions set on purpose: the trash expires
      // after thirty days, so a lapsed licence that could not restore would
      // lose its own deleted work permanently.
      'trash:list',
      'trash:restore',
      'tags:list',
      'tags:for',
      'tags:matching',
      // The mileage log itself, and the rates it is valued at.
      'mileage:year',
      'mileage:rates',
      // The debtors report reads invoices; chasing one is a separate channel.
      'debtors:aged',
      'bank:list',
      'bank:summary',
      // The year-end pack and the accountant ZIP. Both build a file out of
      // records the user already owns, which read-only must never refuse.
      'yearEnd:accountant',
      // Reading templates, and seeing what one would fill in before
      // committing to generating anything.
      'docTemplates:list',
      'docTemplates:get',
      'docTemplates:preview',
      'documents:get',
      'documents:versions',
      // Reading the review changes nothing.
      'review:week',
      'capacity:defaults',
      // Checking a structure and previewing a rename both only look.
      'structure:check',
      'structure:checkAll',
      'structure:usage',
      'structure:planRename',
      // Reading the board and its report.
      'leads:list',
      'leads:get',
      'leads:report',
      'leads:attention'
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

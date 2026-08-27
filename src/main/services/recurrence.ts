import type { Database } from '../db'
import type { BlockInput, CalendarBlockWithContext, EditScope } from '@shared/types'
import { addMinutes, dayOf, minutesBetween, minutesOf, stampAt } from '@shared/calendar'
import { formatRule, parseRule } from '@shared/rrule'
import { createBlock, getBlock, updateBlock } from './blocks'

/**
 * Changing one repeat of something that repeats.
 *
 * This is the part of a calendar people are most afraid of, and rightly: the
 * difference between "move the Tuesday stand-up to Wednesday" and "move *this*
 * Tuesday's stand-up to Wednesday" is a year of somebody's diary. So the scope
 * is a parameter with no default — the caller has to have asked — and each of
 * the three answers does something structurally different.
 *
 * `one`     materialises the occurrence as its own row and tells the series to
 *           skip that day.
 * `future`  ends the old series the day before and starts a new one.
 * `all`     edits the series itself. A move applies the same shift to every
 *           occurrence rather than pinning them all to one day.
 */

/** Which day of the series is being edited, and the series it belongs to. */
export interface OccurrenceRef {
  /** The series master's id. */
  id: number
  /** `yyyy-mm-dd` of the occurrence being changed. */
  day: string
}

function addExdate(db: Database, id: number, day: string): void {
  const master = getBlock(db, id)
  if (master.recurrenceExdates.includes(day)) return
  const next = [...master.recurrenceExdates, day].sort().join(',')
  db.run(
    `UPDATE calendar_blocks SET recurrence_exdates = ?, updated_at = datetime('now') WHERE id = ?`,
    [next, id]
  )
}

/** Everything about a block that a materialised exception should inherit. */
function inherited(master: CalendarBlockWithContext): Omit<BlockInput, 'startsAt' | 'endsAt'> {
  return {
    title: master.title,
    description: master.description,
    location: master.location,
    blockType: master.blockType,
    allDay: master.allDay,
    timezone: master.timezone,
    projectId: master.projectId,
    clientId: master.clientId,
    taskId: master.taskId,
    colour: master.colour,
    billable: master.billable,
    meetingUrl: master.meetingUrl,
    reminderMinutes: master.reminderMinutes
  }
}

/** The span this occurrence has before anybody changes it. */
function spanOn(master: CalendarBlockWithContext, day: string): { startsAt: string; endsAt: string } {
  const startsAt = stampAt(day, minutesOf(master.startsAt))
  return {
    startsAt,
    endsAt: addMinutes(startsAt, minutesBetween(master.startsAt, master.endsAt))
  }
}

/**
 * Apply a change to one, some or all of a series.
 *
 * Returns the block that now represents what the user was looking at — the new
 * exception, the new series, or the edited master — so the caller can keep it
 * selected rather than having it vanish.
 */
export function editOccurrence(
  db: Database,
  ref: OccurrenceRef,
  scope: EditScope,
  patch: Partial<BlockInput>
): CalendarBlockWithContext {
  const master = getBlock(db, ref.id)
  if (!master.recurrenceRule) {
    // Not a series at all. Nothing to scope, and refusing would be pedantic.
    return updateBlock(db, ref.id, patch)
  }

  const original = spanOn(master, ref.day)

  if (scope === 'one') {
    addExdate(db, master.id, ref.day)
    return createBlock(db, {
      ...inherited(master),
      ...original,
      ...patch,
      // The exception is a plain block. It repeats nothing: it is the one
      // that got away from the series.
      recurrenceRule: null,
      recurrenceParentId: master.id
    })
  }

  if (scope === 'future') {
    const rule = parseRule(master.recurrenceRule)

    if (ref.day === dayOf(master.startsAt)) {
      // "This and everything after" starting from the first occurrence is
      // just "all of it", and splitting would leave an empty series behind.
      return applyToAll(db, master, patch)
    }

    // The old series stops the day before. COUNT cannot survive a split — the
    // count belonged to the whole run — so it becomes an end date, which says
    // the same thing about the part that is left.
    if (rule) {
      const ended = { ...rule, count: undefined, until: previousDay(ref.day) }
      db.run(
        `UPDATE calendar_blocks SET recurrence_rule = ?, updated_at = datetime('now') WHERE id = ?`,
        [formatRule(ended), master.id]
      )
    }

    const next = { ...original, ...patch }
    return createBlock(db, {
      ...inherited(master),
      ...next,
      // The new series keeps the shape of the old one but starts here, so its
      // weekday and month-day defaults follow whatever it was moved to.
      recurrenceRule: master.recurrenceRule,
      // Exceptions after the split belong to the new series' skipped days.
      recurrenceExdates: master.recurrenceExdates.filter((day) => day >= ref.day)
    })
  }

  return applyToAll(db, master, patch, original)
}

/**
 * Editing the whole series.
 *
 * A time change is applied as a *shift* rather than as a value. Somebody
 * dragging one occurrence half an hour later and choosing "all" means "half an
 * hour later, every week" — pinning every occurrence to that one date would
 * collapse a year of Tuesdays onto a single afternoon.
 */
function applyToAll(
  db: Database,
  master: CalendarBlockWithContext,
  patch: Partial<BlockInput>,
  original?: { startsAt: string; endsAt: string }
): CalendarBlockWithContext {
  const shifted: Partial<BlockInput> = { ...patch }

  if (original && (patch.startsAt !== undefined || patch.endsAt !== undefined)) {
    const startDelta = patch.startsAt ? minutesBetween(original.startsAt, patch.startsAt) : 0
    const endDelta = patch.endsAt ? minutesBetween(original.endsAt, patch.endsAt) : 0

    shifted.startsAt = addMinutes(master.startsAt, startDelta)
    shifted.endsAt = addMinutes(master.endsAt, endDelta)
  }

  return updateBlock(db, master.id, shifted)
}

function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10)
}

/**
 * Remove one, some or all of a series.
 *
 * Deleting a whole series goes through the trash like anything else — that is
 * the caller's job, via `entity:delete`. What lives here is the other two,
 * which are edits to the rule rather than deletions of a row.
 */
export function deleteOccurrence(db: Database, ref: OccurrenceRef, scope: EditScope): void {
  const master = getBlock(db, ref.id)
  if (!master.recurrenceRule) throw new Error('That block does not repeat')

  if (scope === 'one') {
    addExdate(db, master.id, ref.day)
    return
  }

  if (scope === 'future') {
    if (ref.day === dayOf(master.startsAt)) {
      throw new Error('Deleting from the first occurrence removes the whole series')
    }
    const rule = parseRule(master.recurrenceRule)
    if (!rule) return
    const ended = { ...rule, count: undefined, until: previousDay(ref.day) }
    db.run(
      `UPDATE calendar_blocks SET recurrence_rule = ?, updated_at = datetime('now') WHERE id = ?`,
      [formatRule(ended), master.id]
    )
    return
  }

  throw new Error('Deleting a whole series goes through the trash')
}

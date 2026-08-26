import type { Database, Row } from '../db'
import type { CalendarSettings } from '@shared/types'

/**
 * How this person works.
 *
 * One row, kept one row by a CHECK on the primary key. Its own table rather
 * than more columns on `settings` because everything here is a shape — hours,
 * days, capacity — that only the calendar reads, and because the calendar asks
 * for all of it on every render.
 */

interface SettingsRow extends Row {
  working_hours_start: number
  working_hours_end: number
  working_days: number
  daily_capacity_minutes: number
  weekly_billable_target: number
  default_block_minutes: number
  snap_minutes: number
  week_starts_on: number
  default_view: string
  show_weekends: number
  hour_height: number
}

function toSettings(row: SettingsRow): CalendarSettings {
  return {
    workingHoursStart: row.working_hours_start,
    workingHoursEnd: row.working_hours_end,
    workingDays: row.working_days,
    dailyCapacityMinutes: row.daily_capacity_minutes,
    weeklyBillableTarget: row.weekly_billable_target,
    defaultBlockMinutes: row.default_block_minutes,
    snapMinutes: row.snap_minutes,
    weekStartsOn: row.week_starts_on,
    defaultView: row.default_view,
    showWeekends: row.show_weekends === 1,
    hourHeight: row.hour_height
  }
}

export function getCalendarSettings(db: Database): CalendarSettings {
  const row = db.get<SettingsRow>('SELECT * FROM calendar_settings WHERE id = 1')
  if (!row) throw new Error('Calendar settings are missing')
  return toSettings(row)
}

const UPDATABLE: Record<string, string> = {
  workingHoursStart: 'working_hours_start',
  workingHoursEnd: 'working_hours_end',
  workingDays: 'working_days',
  dailyCapacityMinutes: 'daily_capacity_minutes',
  weeklyBillableTarget: 'weekly_billable_target',
  defaultBlockMinutes: 'default_block_minutes',
  snapMinutes: 'snap_minutes',
  weekStartsOn: 'week_starts_on',
  defaultView: 'default_view',
  showWeekends: 'show_weekends',
  hourHeight: 'hour_height'
}

export function updateCalendarSettings(
  db: Database,
  patch: Partial<CalendarSettings>
): CalendarSettings {
  const assignments: string[] = []
  const values: (string | number)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = UPDATABLE[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number))
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE calendar_settings SET ${assignments.join(', ')}, updated_at = datetime('now')
        WHERE id = 1`,
      values
    )
  }

  return getCalendarSettings(db)
}

// `isWorkingDay` lives in @shared/calendar: the grid shades non-working days
// and the capacity maths skips them, and a copy on each side of the bridge
// would eventually disagree about which day Sunday is.
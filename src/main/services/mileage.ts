import type { Database, Row } from '../db'
import type {
  MileageInput,
  MileageRateRow,
  MileageWithValue,
  MileageYear,
  Pence,
  Vehicle
} from '@shared/types'
import { VEHICLES, valueYear, type MileageRate } from '@shared/mileage'
import { addDays, taxYearFor, today, type TaxYear } from '@shared/taxYear'
import { getSettings } from './settings'

/**
 * The mileage log.
 *
 * Read a tax year at a time, because that is the unit HMRC's 10,000-mile
 * threshold works in and there is no honest way to value a journey without
 * knowing what came before it. Everything is ordered by date and then by id,
 * so two journeys on the same day are counted in the order they were entered
 * and the answer is stable.
 */

interface MileageRow extends Row {
  id: number
  date: string
  from_place: string
  to_place: string
  purpose: string
  tenths: number
  vehicle: Vehicle
  client_id: number | null
  project_id: number | null
  rebillable: number
  invoice_line_id: number | null
  created_at: string
  updated_at: string
  project_name: string | null
  client_name: string | null
}

function toEntry(row: MileageRow): Omit<MileageWithValue, 'amount' | 'atFirstRate' | 'atSecondRate' | 'rate'> {
  return {
    id: row.id,
    date: row.date,
    fromPlace: row.from_place,
    toPlace: row.to_place,
    purpose: row.purpose,
    tenths: row.tenths,
    vehicle: row.vehicle,
    clientId: row.client_id,
    projectId: row.project_id,
    rebillable: row.rebillable === 1,
    invoiceLineId: row.invoice_line_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectName: row.project_name,
    clientName: row.client_name
  }
}

/* ------------------------------------------------------------------ *
 * Rates
 * ------------------------------------------------------------------ */

export function getRates(db: Database): Record<Vehicle, MileageRate> {
  const rows = db.all<Row & MileageRateRowShape>('SELECT * FROM mileage_rates')

  const rates = {} as Record<Vehicle, MileageRate>
  for (const vehicle of VEHICLES) {
    const row = rows.find((one) => one.vehicle === vehicle)
    // The table is seeded by the migration, so a missing row means somebody
    // deleted one. Zero is the safe reading: it under-claims rather than
    // inventing an allowance nobody is entitled to.
    rates[vehicle] = {
      vehicle,
      firstRate: row?.first_rate ?? 0,
      secondRate: row?.second_rate ?? 0,
      thresholdTenths: row?.threshold_tenths ?? 0
    }
  }
  return rates
}

interface MileageRateRowShape {
  vehicle: Vehicle
  first_rate: number
  second_rate: number
  threshold_tenths: number
}

export function listRates(db: Database): MileageRateRow[] {
  const rates = getRates(db)
  return VEHICLES.map((vehicle) => ({
    vehicle,
    firstRate: rates[vehicle].firstRate,
    secondRate: rates[vehicle].secondRate,
    thresholdTenths: rates[vehicle].thresholdTenths
  }))
}

export function setRate(db: Database, patch: MileageRateRow): MileageRateRow[] {
  db.run(
    `UPDATE mileage_rates
        SET first_rate = ?, second_rate = ?, threshold_tenths = ?, updated_at = datetime('now')
      WHERE vehicle = ?`,
    [
      Math.max(0, Math.round(patch.firstRate)),
      Math.max(0, Math.round(patch.secondRate)),
      Math.max(0, Math.round(patch.thresholdTenths)),
      patch.vehicle
    ]
  )
  return listRates(db)
}

/* ------------------------------------------------------------------ *
 * The log
 * ------------------------------------------------------------------ */

function taxYearOf(db: Database, date: string): TaxYear {
  const settings = getSettings(db)
  return taxYearFor(date, {
    day: settings.taxYearStartDay,
    month: settings.taxYearStartMonth
  })
}

/**
 * Every journey in the tax year containing `date`, valued in order.
 *
 * The whole year is read even when the caller only wants to show part of it:
 * the value of March's driving depends on April's, so a query narrowed to a
 * month would quietly report the wrong rate.
 */
export function mileageYear(db: Database, date: string = today()): MileageYear {
  const taxYear = taxYearOf(db, date)

  const rows = db.all<MileageRow>(
    `SELECT m.*, p.name AS project_name, c.name AS client_name
       FROM mileage m
       LEFT JOIN projects p ON p.id = m.project_id
       LEFT JOIN clients  c ON c.id = m.client_id
      WHERE m.archived = 0 AND m.date >= ? AND m.date <= ?
      ORDER BY m.date ASC, m.id ASC`,
    [taxYear.start, taxYear.end]
  )

  const rates = getRates(db)
  const valued = valueYear(rows.map(toEntry), rates) as MileageWithValue[]

  const drivenTenths = {} as Record<Vehicle, number>
  for (const vehicle of VEHICLES) drivenTenths[vehicle] = 0
  for (const entry of valued) drivenTenths[entry.vehicle] += entry.tenths

  const carThreshold = rates.car.thresholdTenths
  const remaining = carThreshold - drivenTenths.car

  return {
    taxYear: { start: taxYear.start, end: taxYear.end, label: taxYear.label },
    // Newest first for reading, having been valued oldest first.
    entries: valued.slice().reverse(),
    drivenTenths,
    total: valued.reduce((sum, entry) => sum + entry.amount, 0),
    untilThresholdTenths: carThreshold > 0 && remaining > 0 ? remaining : null
  }
}

export function createMileage(db: Database, input: MileageInput): MileageYear {
  const date = input.date ?? today()

  db.run(
    `INSERT INTO mileage (date, from_place, to_place, purpose, tenths, vehicle,
                          client_id, project_id, rebillable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      date,
      input.fromPlace ?? '',
      input.toPlace ?? '',
      input.purpose ?? '',
      Math.max(0, Math.round(input.tenths ?? 0)),
      input.vehicle ?? 'car',
      input.clientId ?? null,
      input.projectId ?? null,
      input.rebillable ? 1 : 0
    ]
  )

  return mileageYear(db, date)
}

export function updateMileage(db: Database, id: number, patch: MileageInput): MileageYear {
  const current = db.get<Row & { date: string }>('SELECT date FROM mileage WHERE id = ?', [id])
  if (!current) throw new Error(`No mileage entry with id ${id}`)

  const columns: Record<string, string> = {
    date: 'date',
    fromPlace: 'from_place',
    toPlace: 'to_place',
    purpose: 'purpose',
    vehicle: 'vehicle',
    clientId: 'client_id',
    projectId: 'project_id'
  }

  const assignments: string[] = []
  const values: (string | number | null)[] = []

  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key]
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    values.push(value as string | number | null)
  }

  if (patch.tenths !== undefined) {
    assignments.push('tenths = ?')
    values.push(Math.max(0, Math.round(patch.tenths)))
  }
  if (patch.rebillable !== undefined) {
    assignments.push('rebillable = ?')
    values.push(patch.rebillable ? 1 : 0)
  }

  if (assignments.length > 0) {
    db.run(
      `UPDATE mileage SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    )
  }

  // Moving a journey between tax years has to leave the caller looking at the
  // year they can still see it in.
  return mileageYear(db, patch.date ?? current.date)
}

export function deleteMileage(db: Database, id: number): MileageYear {
  const row = db.get<Row & { date: string }>('SELECT date FROM mileage WHERE id = ?', [id])
  db.run('DELETE FROM mileage WHERE id = ?', [id])
  return mileageYear(db, row?.date ?? today())
}

/**
 * What the mileage in a date range is worth.
 *
 * Used by the finance summary, where mileage is an allowable expense like any
 * other — leaving it out overstates profit, and therefore overstates the tax
 * somebody is told to set aside.
 *
 * The range is filtered *after* valuing the year, never inside the query, so
 * that a journey in the range is still valued against the miles that preceded
 * it rather than as though the year began at `from`.
 */
export function mileageValueIn(db: Database, from: string, to: string): Pence {
  return mileageEntriesIn(db, from, to).reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * The journeys in a date range, each carrying the value it actually earned.
 *
 * A range can straddle a tax-year boundary — a calendar year always does — so
 * every year it touches is valued in full and then filtered. Walked year by
 * year rather than taking just the two ends, since a range can be longer than
 * one.
 */
export function mileageEntriesIn(db: Database, from: string, to: string): MileageWithValue[] {
  const found: MileageWithValue[] = []
  let year = taxYearOf(db, from)

  while (year.start <= to) {
    for (const entry of mileageYear(db, year.start).entries) {
      if (entry.date >= from && entry.date <= to) found.push(entry)
    }
    // The day after this year ends is the first day of the next.
    year = taxYearOf(db, addDays(year.end, 1))
  }

  // Oldest first, the order a claim is read in. Sorted rather than reversed:
  // each year arrives newest-first but the years themselves arrive oldest-
  // first, so reversing the whole list would put the years backwards.
  return found.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
}

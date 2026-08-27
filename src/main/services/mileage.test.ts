import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn()
}))

const { Database } = await import('../db')
const {
  createMileage,
  deleteMileage,
  mileageValueIn,
  mileageYear,
  setRate,
  updateMileage
} = await import('./mileage')

/**
 * The mileage log against a real database.
 *
 * `mileage.test.ts` in `shared` proves the arithmetic. This proves the thing
 * that arithmetic is useless without: that journeys are counted in date order
 * across the *tax* year, so a back-dated entry re-rates everything after it and
 * 5 April does not leak into 6 April.
 */

const MILE = 10

describe('the log', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  const drive = (date: string, miles: number, extra = {}): void => {
    createMileage(db, { date, tenths: miles * MILE, vehicle: 'car', ...extra })
  }

  it('values a journey at the approved rate', () => {
    drive('2026-06-01', 20)
    const year = mileageYear(db, '2026-06-01')

    expect(year.entries).toHaveLength(1)
    expect(year.entries[0]!.amount).toBe(900)
    expect(year.entries[0]!.rate).toBe(45)
    expect(year.total).toBe(900)
  })

  it('reads back the places and the reason', () => {
    createMileage(db, {
      date: '2026-06-01',
      fromPlace: 'Home',
      toPlace: 'Leeds',
      purpose: 'Site visit',
      tenths: 42 * MILE
    })

    expect(mileageYear(db, '2026-06-01').entries[0]).toMatchObject({
      fromPlace: 'Home',
      toPlace: 'Leeds',
      purpose: 'Site visit',
      tenths: 420
    })
  })

  it('drops to the lower rate once the year passes ten thousand miles', () => {
    drive('2026-05-01', 6_000)
    drive('2026-09-01', 6_000)

    const year = mileageYear(db, '2026-09-01')
    // Newest first, so the September trip is the one that straddles.
    expect(year.entries[0]!.amount).toBe(4_000 * 45 + 2_000 * 25)
    expect(year.entries[0]!.rate).toBeNull()
    expect(year.untilThresholdTenths).toBeNull()
  })

  it('says how far there is left at the higher rate', () => {
    drive('2026-05-01', 400)
    expect(mileageYear(db, '2026-05-01').untilThresholdTenths).toBe(9_600 * MILE)
  })

  it('starts the allowance again in the next tax year', () => {
    // 5 April and 6 April are different years, and this is the boundary that
    // decides whether somebody's allowance resets or does not.
    drive('2027-04-05', 9_000)
    drive('2027-04-06', 5_000)

    const before = mileageYear(db, '2027-04-05')
    const after = mileageYear(db, '2027-04-06')

    expect(before.total).toBe(9_000 * 45)
    // The new year knows nothing about the old one's 9,000 miles.
    expect(after.total).toBe(5_000 * 45)
    expect(after.entries).toHaveLength(1)
  })

  it('re-rates later journeys when an earlier one is added afterwards', () => {
    // Nothing is stored, so this must happen without anything being rewritten.
    drive('2026-09-01', 4_000)
    expect(mileageYear(db, '2026-09-01').entries[0]!.amount).toBe(4_000 * 45)

    drive('2026-05-01', 8_000)

    const year = mileageYear(db, '2026-09-01')
    const september = year.entries.find((entry) => entry.date === '2026-09-01')!
    expect(september.amount).toBe(2_000 * 45 + 2_000 * 25)
  })

  it('re-rates them again when the earlier one is deleted', () => {
    drive('2026-05-01', 8_000)
    drive('2026-09-01', 4_000)

    const may = mileageYear(db, '2026-05-01').entries.find((one) => one.date === '2026-05-01')!
    deleteMileage(db, may.id)

    const september = mileageYear(db, '2026-09-01').entries[0]!
    expect(september.amount).toBe(4_000 * 45)
  })

  it('re-rates when a journey is moved to a different date', () => {
    drive('2026-05-01', 8_000)
    drive('2026-09-01', 4_000)

    const september = mileageYear(db, '2026-09-01').entries.find(
      (one) => one.date === '2026-09-01'
    )!
    // Moved to before the long trip, so it is now entirely at the higher rate.
    updateMileage(db, september.id, { date: '2026-04-10' })

    const moved = mileageYear(db, '2026-04-10').entries.find((one) => one.id === september.id)!
    expect(moved.amount).toBe(4_000 * 45)
  })

  it('follows a journey that is moved into another tax year', () => {
    drive('2026-09-01', 100)
    const entry = mileageYear(db, '2026-09-01').entries[0]!

    const year = updateMileage(db, entry.id, { date: '2027-09-01' })

    // The caller is left looking at the year they can still see it in.
    expect(year.taxYear.label).toBe('2027/28')
    expect(year.entries).toHaveLength(1)
    expect(mileageYear(db, '2026-09-01').entries).toHaveLength(0)
  })

  it('keeps each vehicle s allowance to itself', () => {
    drive('2026-05-01', 10_000)
    createMileage(db, { date: '2026-06-01', tenths: 10 * MILE, vehicle: 'bicycle' })

    const ride = mileageYear(db, '2026-06-01').entries.find((one) => one.vehicle === 'bicycle')!
    expect(ride.amount).toBe(200)
    expect(ride.rate).toBe(20)
  })

  it('uses a rate somebody has changed', () => {
    setRate(db, { vehicle: 'car', firstRate: 50, secondRate: 30, thresholdTenths: 5_000 * MILE })
    drive('2026-06-01', 6_000)

    expect(mileageYear(db, '2026-06-01').total).toBe(5_000 * 50 + 1_000 * 30)
  })

  it('orders same-day journeys by the order they were entered', () => {
    // Two trips on one day have to be counted in *some* order, and it has to
    // be stable — otherwise the total changes between two reads of the log.
    drive('2026-06-01', 9_995)
    drive('2026-06-01', 10)

    const first = mileageYear(db, '2026-06-01').total
    const second = mileageYear(db, '2026-06-01').total
    expect(first).toBe(second)
    expect(first).toBe(9_995 * 45 + 5 * 45 + 5 * 25)
  })
})

describe('what a range is worth', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('counts only the journeys inside it', () => {
    createMileage(db, { date: '2026-06-01', tenths: 100 * MILE })
    createMileage(db, { date: '2026-08-01', tenths: 100 * MILE })

    expect(mileageValueIn(db, '2026-06-01', '2026-06-30')).toBe(100 * 45)
  })

  it('still values them against the whole year before them', () => {
    // The August trip is worth 25p a mile because of what came before it in
    // April — which a query narrowed to August would never see.
    createMileage(db, { date: '2026-04-10', tenths: 10_000 * MILE })
    createMileage(db, { date: '2026-08-01', tenths: 100 * MILE })

    expect(mileageValueIn(db, '2026-08-01', '2026-08-31')).toBe(100 * 25)
  })

  it('adds up a range that crosses the tax-year boundary', () => {
    // A calendar year always crosses one, and both halves must be counted.
    createMileage(db, { date: '2026-06-01', tenths: 100 * MILE })
    createMileage(db, { date: '2027-02-01', tenths: 100 * MILE })
    createMileage(db, { date: '2027-06-01', tenths: 100 * MILE })

    expect(mileageValueIn(db, '2026-01-01', '2026-12-31')).toBe(100 * 45)
    expect(mileageValueIn(db, '2026-01-01', '2027-12-31')).toBe(3 * 100 * 45)
  })

  it('is nothing when nobody has driven anywhere', () => {
    expect(mileageValueIn(db, '2026-01-01', '2026-12-31')).toBe(0)
  })
})

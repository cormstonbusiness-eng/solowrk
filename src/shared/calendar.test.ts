import { describe, expect, it } from 'vitest'
import {
  addMinutes,
  addMonths,
  daysBetween,
  daysCovered,
  describeSpan,
  minutesBetween,
  minutesOf,
  monthGrid,
  occursOn,
  placeOverlapping,
  segmentOn,
  snapMinutes,
  stampAt,
  startOfWeek,
  weekDays
} from './calendar'

describe('stamps', () => {
  it('reads minutes since midnight', () => {
    expect(minutesOf('2026-08-16T00:00')).toBe(0)
    expect(minutesOf('2026-08-16T09:30')).toBe(570)
    expect(minutesOf('2026-08-16T23:45')).toBe(1425)
  })

  it('treats a bare date as midnight', () => {
    expect(minutesOf('2026-08-16')).toBe(0)
  })

  it('rolls over midnight when adding minutes', () => {
    expect(addMinutes('2026-08-16T23:30', 45)).toBe('2026-08-17T00:15')
    expect(addMinutes('2026-08-17T00:15', -45)).toBe('2026-08-16T23:30')
  })

  it('builds a stamp from minutes past midnight', () => {
    expect(stampAt('2026-08-16', 570)).toBe('2026-08-16T09:30')
    expect(stampAt('2026-08-16', 1500)).toBe('2026-08-17T01:00')
  })

  it('measures minutes across a day boundary', () => {
    expect(minutesBetween('2026-08-16T23:00', '2026-08-17T01:30')).toBe(150)
  })
})

describe('day arithmetic', () => {
  it('counts whole days regardless of month length', () => {
    expect(daysBetween('2026-08-16', '2026-08-19')).toBe(3)
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
    // 2028 is a leap year, so February has 29 days.
    expect(daysBetween('2028-02-27', '2028-03-02')).toBe(4)
  })

  it('survives the spring clock change, when a day is 23 hours long', () => {
    // UK clocks go forward on 29 March 2026. Measuring in whole hours would
    // make this 2.958 days and round to 2.
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3)
  })

  it('clamps when adding months to the 31st', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-08-16', -1)).toBe('2026-07-16')
  })
})

describe('weeks and month grids', () => {
  it('starts weeks on Monday', () => {
    // 16 August 2026 is a Sunday, so its week began on the 10th.
    expect(startOfWeek('2026-08-16')).toBe('2026-08-10')
    expect(startOfWeek('2026-08-10')).toBe('2026-08-10')
  })

  it('returns seven consecutive days for a week', () => {
    expect(weekDays('2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16'
    ])
  })

  it('always produces 42 days starting on a Monday', () => {
    for (const month of ['2026-01-15', '2026-02-15', '2026-08-15', '2028-02-15']) {
      const grid = monthGrid(month)
      expect(grid).toHaveLength(42)
      expect(grid[0]).toBe(startOfWeek(`${month.slice(0, 7)}-01`))
    }
  })

  it('leads with the previous month when the 1st is not a Monday', () => {
    // 1 August 2026 is a Saturday, so the grid opens on 27 July.
    expect(monthGrid('2026-08-16')[0]).toBe('2026-07-27')
  })

  it('opens on the 1st when the month starts on a Monday', () => {
    // 1 June 2026 is a Monday.
    expect(monthGrid('2026-06-10')[0]).toBe('2026-06-01')
  })
})

describe('spanning days', () => {
  const span = { startsAt: '2026-08-16T22:00', endsAt: '2026-08-18T03:00' }

  it('lists every day an event touches', () => {
    expect(daysCovered(span)).toEqual(['2026-08-16', '2026-08-17', '2026-08-18'])
    expect(daysCovered({ startsAt: '2026-08-16T09:00', endsAt: '2026-08-16T10:00' })).toEqual([
      '2026-08-16'
    ])
  })

  it('knows which days it occurs on', () => {
    expect(occursOn(span, '2026-08-17')).toBe(true)
    expect(occursOn(span, '2026-08-19')).toBe(false)
  })

  it('clips each day to that day', () => {
    expect(segmentOn(span, '2026-08-16')).toEqual({ start: 1320, end: 1440 })
    expect(segmentOn(span, '2026-08-17')).toEqual({ start: 0, end: 1440 })
    expect(segmentOn(span, '2026-08-18')).toEqual({ start: 0, end: 180 })
  })

  it('gives a zero-length event enough height to be clickable', () => {
    const instant = { startsAt: '2026-08-16T09:00', endsAt: '2026-08-16T09:00' }
    expect(segmentOn(instant, '2026-08-16')).toEqual({ start: 540, end: 555 })
  })

  it('flags an overnight event in its description', () => {
    expect(describeSpan({ startsAt: '2026-08-16T09:00', endsAt: '2026-08-16T10:30' })).toBe(
      '09:00 – 10:30'
    )
    expect(describeSpan(span)).toBe('22:00 – 03:00, +2d')
  })
})

describe('placeOverlapping', () => {
  const bounds = (item: { start: number; end: number }): { start: number; end: number } => item

  it('gives a lone event the full width', () => {
    const [placed] = placeOverlapping([{ start: 540, end: 600 }], bounds)
    expect(placed).toMatchObject({ column: 0, columns: 1 })
  })

  it('keeps sequential events at full width', () => {
    const placed = placeOverlapping(
      [
        { start: 540, end: 600 },
        { start: 600, end: 660 }
      ],
      bounds
    )
    expect(placed.map((p) => p.columns)).toEqual([1, 1])
  })

  it('splits two overlapping events into two columns', () => {
    const placed = placeOverlapping(
      [
        { start: 540, end: 660 },
        { start: 600, end: 720 }
      ],
      bounds
    )
    expect(placed.map((p) => [p.column, p.columns])).toEqual([
      [0, 2],
      [1, 2]
    ])
  })

  it('reuses a column once the earlier event has finished', () => {
    // 9–10 and 10–11 can share column 0; 9:30–10:30 needs column 1 throughout.
    const placed = placeOverlapping(
      [
        { start: 540, end: 600 },
        { start: 570, end: 630 },
        { start: 600, end: 660 }
      ],
      bounds
    )
    expect(placed.map((p) => p.column)).toEqual([0, 1, 0])
  })

  it('sizes a whole cluster together, so widths do not jump mid-column', () => {
    // An all-morning block overlaps both meetings, chaining them into one
    // cluster even though the two meetings never overlap each other.
    const placed = placeOverlapping(
      [
        { start: 540, end: 720 },
        { start: 555, end: 600 },
        { start: 660, end: 700 }
      ],
      bounds
    )
    expect(placed.every((p) => p.columns === 2)).toBe(true)
  })

  it('separates clusters that do not touch', () => {
    const placed = placeOverlapping(
      [
        { start: 540, end: 600 },
        { start: 550, end: 610 },
        { start: 900, end: 960 }
      ],
      bounds
    )
    expect(placed.map((p) => p.columns)).toEqual([2, 2, 1])
  })

  it('puts the longer event in column 0 when two start together', () => {
    const placed = placeOverlapping(
      [
        { start: 540, end: 570 },
        { start: 540, end: 720 }
      ],
      bounds
    )
    expect(placed[0]).toMatchObject({ item: { start: 540, end: 720 }, column: 0 })
  })

  it('does not lose or duplicate events', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      start: index * 20,
      end: index * 20 + 90
    }))
    expect(placeOverlapping(items, bounds)).toHaveLength(20)
  })

  describe('widening into empty columns', () => {
    it('gives a lone block in a wide cluster the whole width', () => {
      // The 9–12 block forces three columns. The 3pm block is in the same
      // cluster only by being chained to it, and nothing sits beside it — so
      // it should not be drawn at a third of the width with two empty stripes.
      const placed = placeOverlapping(
        [
          { start: 540, end: 720 },
          { start: 555, end: 600 },
          { start: 570, end: 630 },
          { start: 700, end: 900 }
        ],
        bounds
      )

      const lone = placed.find((p) => p.item.start === 700)
      expect(lone).toMatchObject({ column: 1, columns: 3, span: 2 })
    })

    it('stops at the first column with something in the way', () => {
      const placed = placeOverlapping(
        [
          { start: 540, end: 720 },
          { start: 540, end: 600 },
          { start: 540, end: 600 }
        ],
        bounds
      )
      expect(placed.map((p) => p.span)).toEqual([1, 1, 1])
    })

    it('treats touching as clear, not as overlapping', () => {
      // Two 9–10s fill columns 1 and 2. The 10–12 block takes the first of
      // those back and should widen over the second: a block ending at 10:00
      // and one starting at 10:00 never cover each other.
      const placed = placeOverlapping(
        [
          { start: 540, end: 720 },
          { start: 540, end: 600 },
          { start: 540, end: 600 },
          { start: 600, end: 720 }
        ],
        bounds
      )

      const later = placed.find((p) => p.item.start === 600)
      expect(later).toMatchObject({ column: 1, columns: 3, span: 2 })
    })

    it('never widens leftward, so nothing already placed has to move', () => {
      const placed = placeOverlapping(
        [
          { start: 540, end: 600 },
          { start: 550, end: 700 },
          { start: 610, end: 640 }
        ],
        bounds
      )
      // The 10:10 block sits in column 0, freed by the first block ending, and
      // widens right only as far as the still-running column-1 block allows.
      expect(placed.find((p) => p.item.start === 610)).toMatchObject({ column: 0, span: 1 })
    })

    it('leaves a lone block alone', () => {
      const [placed] = placeOverlapping([{ start: 540, end: 600 }], bounds)
      expect(placed).toMatchObject({ column: 0, columns: 1, span: 1 })
    })
  })
})

describe('snapMinutes', () => {
  it('rounds to the nearest quarter hour', () => {
    expect(snapMinutes(547)).toBe(540)
    expect(snapMinutes(553)).toBe(555)
    expect(snapMinutes(0)).toBe(0)
  })

  it('honours a different step', () => {
    expect(snapMinutes(547, 30)).toBe(540)
    expect(snapMinutes(556, 30)).toBe(570)
  })
})
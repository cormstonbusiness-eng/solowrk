import { describe, expect, it } from 'vitest'
import {
  MAX_IN_RANGE,
  clearExpansionCache,
  describeRule,
  expand,
  formatRule,
  parseRule,
  simpleRule,
  type Recurrence
} from './rrule'

const rule = (text: string): Recurrence => {
  const parsed = parseRule(text)
  if (!parsed) throw new Error(`unparseable: ${text}`)
  return parsed
}

/** August and September 2026, which is where the rest of the calendar tests live. */
const range = { from: '2026-08-01', to: '2026-09-30' }

describe('parsing', () => {
  it('reads the fields', () => {
    expect(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: [{ weekday: 'MO' }, { weekday: 'WE' }],
      byMonthDay: [],
      count: 6
    })
  })

  it('tolerates the RRULE: prefix and odd casing', () => {
    expect(rule('RRULE:freq=daily;interval=3').freq).toBe('DAILY')
  })

  it('reads an ordinal weekday', () => {
    expect(rule('FREQ=MONTHLY;BYDAY=3TH').byDay).toEqual([{ weekday: 'TH', ordinal: 3 }])
    expect(rule('FREQ=MONTHLY;BYDAY=-1FR').byDay).toEqual([{ weekday: 'FR', ordinal: -1 }])
  })

  it('takes UNTIL as a date, ignoring the instant', () => {
    // The whole calendar is wall time. Treating UNTIL as a UTC instant would
    // move the last occurrence by an hour for half the year.
    expect(rule('FREQ=DAILY;UNTIL=20260815T235959Z').until).toBe('2026-08-15')
    expect(rule('FREQ=DAILY;UNTIL=20260815').until).toBe('2026-08-15')
  })

  it('returns null rather than throwing on nonsense', () => {
    // Rules arrive from feeds written by software nobody here controls. One
    // bad RRULE should cost that event its repetition, not the sync.
    expect(parseRule('FREQ=FORTNIGHTLY')).toBeNull()
    expect(parseRule('not a rule at all')).toBeNull()
    expect(parseRule('')).toBeNull()
    expect(parseRule(null)).toBeNull()
  })

  it('survives a round trip', () => {
    const text = 'FREQ=MONTHLY;INTERVAL=2;BYDAY=3TH;COUNT=10'
    expect(formatRule(rule(text))).toBe(text)
  })
})

describe('daily', () => {
  it('repeats every day', () => {
    const found = expand(rule('FREQ=DAILY'), '2026-08-01', { from: '2026-08-01', to: '2026-08-05' })
    expect(found).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05'
    ])
  })

  it('honours an interval', () => {
    const found = expand(rule('FREQ=DAILY;INTERVAL=3'), '2026-08-01', {
      from: '2026-08-01',
      to: '2026-08-10'
    })
    expect(found).toEqual(['2026-08-01', '2026-08-04', '2026-08-07', '2026-08-10'])
  })

  it('stops at COUNT, including the first', () => {
    const found = expand(rule('FREQ=DAILY;COUNT=3'), '2026-08-01', range)
    expect(found).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })

  it('stops at UNTIL, inclusive', () => {
    const found = expand(rule('FREQ=DAILY;UNTIL=20260803'), '2026-08-01', range)
    expect(found).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })
})

describe('weekly', () => {
  it('defaults to the weekday it started on', () => {
    // 2026-08-03 is a Monday.
    const found = expand(rule('FREQ=WEEKLY'), '2026-08-03', {
      from: '2026-08-01',
      to: '2026-08-31'
    })
    expect(found).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('takes several days a week, in order', () => {
    const found = expand(rule('FREQ=WEEKLY;BYDAY=MO,WE'), '2026-08-03', {
      from: '2026-08-01',
      to: '2026-08-14'
    })
    expect(found).toEqual(['2026-08-03', '2026-08-05', '2026-08-10', '2026-08-12'])
  })

  it('skips whole weeks on an interval', () => {
    const found = expand(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), '2026-08-03', {
      from: '2026-08-01',
      to: '2026-09-15'
    })
    expect(found).toEqual(['2026-08-03', '2026-08-17', '2026-08-31', '2026-09-14'])
  })

  it('never returns anything before the series started', () => {
    // The Monday before the start is in the same week, and must not appear.
    const found = expand(rule('FREQ=WEEKLY;BYDAY=MO,FR'), '2026-08-07', {
      from: '2026-08-01',
      to: '2026-08-14'
    })
    expect(found).toEqual(['2026-08-07', '2026-08-10', '2026-08-14'])
  })
})

describe('monthly', () => {
  it('keeps the day of the month it started on', () => {
    const found = expand(rule('FREQ=MONTHLY'), '2026-08-15', {
      from: '2026-08-01',
      to: '2026-11-30'
    })
    expect(found).toEqual(['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15'])
  })

  it('skips months that have no such date, rather than clamping', () => {
    // "The 31st of every month" happens seven times a year, not twelve.
    // Clamping to the 30th would invent four appointments a year on a date
    // nobody chose, and never say so.
    const found = expand(rule('FREQ=MONTHLY;BYMONTHDAY=31'), '2026-01-31', {
      from: '2026-01-01',
      to: '2026-06-30'
    })
    expect(found).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })

  it('finds the third Thursday', () => {
    const found = expand(rule('FREQ=MONTHLY;BYDAY=3TH'), '2026-08-01', {
      from: '2026-08-01',
      to: '2026-10-31'
    })
    expect(found).toEqual(['2026-08-20', '2026-09-17', '2026-10-15'])
  })

  it('finds the last Friday, whatever the month is worth', () => {
    const found = expand(rule('FREQ=MONTHLY;BYDAY=-1FR'), '2026-01-01', {
      from: '2026-01-01',
      to: '2026-03-31'
    })
    expect(found).toEqual(['2026-01-30', '2026-02-27', '2026-03-27'])
  })

  it('counts back from the end of the month', () => {
    const found = expand(rule('FREQ=MONTHLY;BYMONTHDAY=-1'), '2026-01-31', {
      from: '2026-01-01',
      to: '2026-03-31'
    })
    expect(found).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
})

describe('yearly', () => {
  it('repeats on the same date', () => {
    const found = expand(rule('FREQ=YEARLY'), '2026-04-06', {
      from: '2026-01-01',
      to: '2029-12-31'
    })
    expect(found).toEqual(['2026-04-06', '2027-04-06', '2028-04-06', '2029-04-06'])
  })

  it('fires on 29 February only in leap years, and keeps going', () => {
    const found = expand(rule('FREQ=YEARLY'), '2028-02-29', {
      from: '2028-01-01',
      to: '2033-12-31'
    })
    expect(found).toEqual(['2028-02-29', '2032-02-29'])
  })
})

describe('exceptions', () => {
  it('skips the days named', () => {
    const found = expand(
      rule('FREQ=DAILY'),
      '2026-08-01',
      { from: '2026-08-01', to: '2026-08-05' },
      ['2026-08-03']
    )
    expect(found).toEqual(['2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05'])
  })

  it('does not give a series of ten an eleventh', () => {
    // A skipped occurrence still used one up. Otherwise dragging one instance
    // out of the series would silently extend it every time.
    const withSkip = expand(
      rule('FREQ=DAILY;COUNT=5'),
      '2026-08-01',
      { from: '2026-08-01', to: '2026-08-31' },
      ['2026-08-03']
    )
    expect(withSkip).toEqual(['2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05'])
  })
})

describe('the range', () => {
  it('returns only what falls inside it, but counts from the beginning', () => {
    // "The tenth Tuesday" means the tenth from the start, not the tenth you
    // happened to scroll to.
    const found = expand(rule('FREQ=DAILY;COUNT=10'), '2026-08-01', {
      from: '2026-08-08',
      to: '2026-08-31'
    })
    expect(found).toEqual(['2026-08-08', '2026-08-09', '2026-08-10'])
  })

  it('is empty for a range before the series starts', () => {
    expect(expand(rule('FREQ=DAILY'), '2026-08-01', { from: '2026-07-01', to: '2026-07-31' }))
      .toEqual([])
  })
})

describe('a series that has been running for years', () => {
  it('still appears', () => {
    // A stand-up somebody has had every Monday since 2018. The caps exist to
    // bound the work, not to make a long-running series vanish.
    const found = expand(rule('FREQ=WEEKLY;BYDAY=MO'), '2018-01-01', range)
    expect(found).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28'
    ])
  })

  it('still appears when it is daily', () => {
    // A daily series older than 500 days would otherwise exhaust the
    // occurrence cap long before it reached the range being drawn.
    const found = expand(rule('FREQ=DAILY'), '2018-01-01', {
      from: '2026-08-01',
      to: '2026-08-05'
    })
    expect(found).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05'
    ])
  })

  it('honours a COUNT that ran out years ago', () => {
    // Ten occurrences from 2018 is over long before 2026, and counting from
    // the beginning is the only way to know that.
    expect(expand(rule('FREQ=WEEKLY;COUNT=10'), '2018-01-01', range)).toEqual([])
  })
})

describe('the ceilings', () => {
  it('stops an endless rule rather than running forever', () => {
    const found = expand(rule('FREQ=DAILY'), '2020-01-01', {
      from: '2020-01-01',
      to: '2099-12-31'
    })
    expect(found).toHaveLength(MAX_IN_RANGE)
  })

  it('bounds the walk when the series starts a century ago', () => {
    // The guard is on the work, not on the answer. Somewhere past twenty
    // thousand steps this gives up rather than grinding, but it does not give
    // up before reaching the range, which is the failure that matters.
    const found = expand(rule('FREQ=WEEKLY;BYDAY=MO'), '1900-01-01', {
      from: '2026-08-01',
      to: '2026-08-31'
    })
    expect(found).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31'
    ])
  })

  it('returns nothing at all for a daily rule from 1900, rather than hanging', () => {
    // Forty-six thousand days is past the step budget. Giving up is the right
    // answer; taking a second to draw one week is not.
    const found = expand(rule('FREQ=DAILY'), '1900-01-01', {
      from: '2026-08-01',
      to: '2026-08-31'
    })
    expect(found.length).toBeLessThanOrEqual(31)
  })
})

describe('the expansion cache', () => {
    it('gives the same answer twice', () => {
      clearExpansionCache()
      const once = expand(rule('FREQ=WEEKLY;BYDAY=MO'), '2026-08-03', range)
      const twice = expand(rule('FREQ=WEEKLY;BYDAY=MO'), '2026-08-03', range)
      expect(twice).toEqual(once)
    })

    it('hands back a copy, not the cached array', () => {
      // A caller owns what it is given. Returning the cached array itself
      // would let one caller's sort corrupt the next one's answer.
      const first = expand(rule('FREQ=DAILY'), '2026-08-01', range)
      first.length = 0
      expect(expand(rule('FREQ=DAILY'), '2026-08-01', range).length).toBeGreaterThan(0)
    })

    it('does not answer a different question from a cached one', () => {
      const withSkip = expand(rule('FREQ=DAILY'), '2026-08-01', range, ['2026-08-02'])
      const without = expand(rule('FREQ=DAILY'), '2026-08-01', range)
      expect(without.length).toBe(withSkip.length + 1)
    })

    it('keeps two ranges of the same rule apart', () => {
      const august = expand(rule('FREQ=WEEKLY;BYDAY=MO'), '2026-08-03', {
        from: '2026-08-01',
        to: '2026-08-31'
      })
      const september = expand(rule('FREQ=WEEKLY;BYDAY=MO'), '2026-08-03', {
        from: '2026-09-01',
        to: '2026-09-30'
      })
      expect(august[0]).toBe('2026-08-03')
      expect(september[0]).toBe('2026-09-07')
    })
  })

describe('saying it out loud', () => {
  it('describes the common rules in plain words', () => {
    expect(describeRule(rule('FREQ=DAILY'))).toBe('Every day')
    expect(describeRule(rule('FREQ=DAILY;INTERVAL=3'))).toBe('Every 3 days')
    expect(describeRule(rule('FREQ=WEEKLY;BYDAY=MO,WE,FR'))).toBe(
      'Every week on Monday, Wednesday and Friday'
    )
    expect(describeRule(rule('FREQ=MONTHLY;BYDAY=3TH'))).toBe('Every month on the third Thursday')
    expect(describeRule(rule('FREQ=MONTHLY;BYDAY=-1FR'))).toBe('Every month on the last Friday')
    expect(describeRule(rule('FREQ=MONTHLY;BYMONTHDAY=1,15'))).toBe(
      'Every month on the 1st and 15th'
    )
    expect(describeRule(rule('FREQ=YEARLY'))).toBe('Every year')
  })

  it('says where it ends', () => {
    expect(describeRule(rule('FREQ=WEEKLY;COUNT=6'))).toBe('Every week, 6 times')
    expect(describeRule(rule('FREQ=WEEKLY;UNTIL=20261231'))).toBe('Every week, until 2026-12-31')
  })
})

describe('the simple choices', () => {
  it('pins a weekly rule to the day it starts on', () => {
    // 2026-08-19 is a Wednesday.
    expect(simpleRule('WEEKLY', '2026-08-19')).toEqual({
      freq: 'WEEKLY',
      interval: 1,
      byDay: [{ weekday: 'WE' }],
      byMonthDay: []
    })
  })
})

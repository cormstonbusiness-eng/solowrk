import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './quickAdd'

/**
 * Reading a typed sentence as a task.
 *
 * The failure that matters is not "it did not understand" — that leaves the
 * words in the title and costs a click. It is understanding *wrongly*: a
 * deadline a week out, a task on the wrong project, a date in the past that
 * arrives already overdue. Most of what follows is about those.
 *
 * Wednesday 26 August 2026 throughout, so "friday" and "next friday" have
 * somewhere definite to land.
 */
const TODAY = '2026-08-26'

describe('what is left over is the title', () => {
  it('keeps a plain sentence intact', () => {
    const parsed = parseQuickAdd('Call Dana about the logo', TODAY)

    expect(parsed.title).toBe('Call Dana about the logo')
    expect(parsed.dueAt).toBeNull()
    expect(parsed.spans).toEqual([])
  })

  it('takes the tokens out and tidies the gap they leave', () => {
    const parsed = parseQuickAdd('Call Dana tomorrow 2pm #Rebrand', TODAY)

    expect(parsed.title).toBe('Call Dana')
    expect(parsed.dueAt).toBe('2026-08-27')
    expect(parsed.dueMinutes).toBe(14 * 60)
    expect(parsed.project).toBe('Rebrand')
  })

  it('reports where each token was, so the input can underline it', () => {
    const parsed = parseQuickAdd('Ring them tomorrow', TODAY)

    const [span] = parsed.spans
    expect(span!.kind).toBe('date')
    expect('Ring them tomorrow'.slice(span!.start, span!.end)).toBe('tomorrow')
  })

  it('leaves a word it does not know in the title rather than guessing', () => {
    // The whole bargain: not understanding costs a click, understanding
    // wrongly costs a missed deadline.
    const parsed = parseQuickAdd('Ring them whenever', TODAY)

    expect(parsed.title).toBe('Ring them whenever')
    expect(parsed.dueAt).toBeNull()
  })
})

describe('dates', () => {
  it('reads today and tomorrow', () => {
    expect(parseQuickAdd('x today', TODAY).dueAt).toBe('2026-08-26')
    expect(parseQuickAdd('x tomorrow', TODAY).dueAt).toBe('2026-08-27')
  })

  it('reads a bare weekday as the next one coming', () => {
    // Wednesday. "Friday" is in two days.
    expect(parseQuickAdd('x friday', TODAY).dueAt).toBe('2026-08-28')
  })

  it('reads the same weekday as a week away, not today', () => {
    // Said on a Wednesday, "Wednesday" is not this morning.
    expect(parseQuickAdd('x wednesday', TODAY).dueAt).toBe('2026-09-02')
  })

  it('reads "next friday" as the one after this one', () => {
    // The difference between this and the last test is a week, and it is the
    // single most expensive thing this parser can get wrong.
    expect(parseQuickAdd('x next friday', TODAY).dueAt).toBe('2026-09-04')
  })

  it('reads "next week" as seven days out', () => {
    expect(parseQuickAdd('x next week', TODAY).dueAt).toBe('2026-09-02')
  })

  it('counts days and weeks forward', () => {
    expect(parseQuickAdd('x in 3 days', TODAY).dueAt).toBe('2026-08-29')
    expect(parseQuickAdd('x in 2 weeks', TODAY).dueAt).toBe('2026-09-09')
  })

  it('reads a day and month', () => {
    expect(parseQuickAdd('x 12 sep', TODAY).dueAt).toBe('2026-09-12')
    expect(parseQuickAdd('x 3rd september', TODAY).dueAt).toBe('2026-09-03')
  })

  it('rolls a past day and month into next year', () => {
    // Typing "3 jan" in August means the January coming. A task dated in the
    // past arrives already overdue, which is nobody's intention.
    expect(parseQuickAdd('x 3 jan', TODAY).dueAt).toBe('2027-01-03')
  })

  it('reads a slashed date day first', () => {
    // British app. Reading 03/04 as the fourth of March would put a deadline
    // four weeks out roughly half the time.
    expect(parseQuickAdd('x 03/09', TODAY).dueAt).toBe('2026-09-03')
    expect(parseQuickAdd('x 03/09/2027', TODAY).dueAt).toBe('2027-09-03')
    expect(parseQuickAdd('x 03/09/27', TODAY).dueAt).toBe('2027-09-03')
  })

  it('ignores a slashed date that is not one', () => {
    const parsed = parseQuickAdd('Split the 50/80 test', TODAY)
    expect(parsed.dueAt).toBeNull()
    expect(parsed.title).toBe('Split the 50/80 test')
  })
})

describe('times', () => {
  it('reads a twelve-hour time', () => {
    expect(parseQuickAdd('x tomorrow 2pm', TODAY).dueMinutes).toBe(14 * 60)
    expect(parseQuickAdd('x tomorrow 9.30am', TODAY).dueMinutes).toBe(9 * 60 + 30)
    expect(parseQuickAdd('x tomorrow 12pm', TODAY).dueMinutes).toBe(12 * 60)
    expect(parseQuickAdd('x tomorrow 12am', TODAY).dueMinutes).toBe(0)
  })

  it('reads a twenty-four hour time', () => {
    expect(parseQuickAdd('x tomorrow 14:30', TODAY).dueMinutes).toBe(14 * 60 + 30)
  })

  it('ignores a time with no day to hang it on', () => {
    // "Ring them 2pm" with no date is a task due at two o'clock on no
    // particular day, which is not a thing.
    const parsed = parseQuickAdd('Ring them 2pm', TODAY)
    expect(parsed.dueMinutes).toBeNull()
    expect(parsed.title).toBe('Ring them 2pm')
  })

  it('ignores an hour that is not one', () => {
    const parsed = parseQuickAdd('x tomorrow 19pm', TODAY)
    expect(parsed.dueMinutes).toBeNull()
  })
})

describe('tags', () => {
  it('reads a project, a client and a category', () => {
    const parsed = parseQuickAdd('Draw it #Rebrand @Acme ~Design', TODAY)

    expect(parsed.project).toBe('Rebrand')
    expect(parsed.client).toBe('Acme')
    expect(parsed.category).toBe('Design')
    expect(parsed.title).toBe('Draw it')
  })

  it('stops an unquoted tag at the first space', () => {
    // It has to: there is no way to tell where "#Rebrand tomorrow Call Dana"
    // stops being a project name, and a greedy tag eats the whole sentence.
    const parsed = parseQuickAdd('#Rebrand tomorrow Call Dana', TODAY)

    expect(parsed.project).toBe('Rebrand')
    expect(parsed.title).toBe('Call Dana')
  })

  it('takes a multi-word tag in quotes', () => {
    expect(parseQuickAdd('Draw it #"Acme rebrand 2026"', TODAY).project).toBe('Acme rebrand 2026')
  })

  it('leaves a two-word project to the caller to match', () => {
    // Nobody types quotes. The answer for "Acme rebrand 2026" is that #Acme is
    // matched against the projects that exist, not that the parser guesses.
    expect(parseQuickAdd('Draw it #Acme', TODAY).project).toBe('Acme')
  })

  it('does not read a date out of a project name', () => {
    // A project called "Friday launch" must not book the task for Friday.
    // Tagged tokens are taken out first for exactly this.
    const parsed = parseQuickAdd('Ship it #Friday', TODAY)

    expect(parsed.project).toBe('Friday')
    expect(parsed.dueAt).toBeNull()
  })

  it('reads a priority by number or by name', () => {
    expect(parseQuickAdd('x !2', TODAY).priority).toBe(2)
    expect(parseQuickAdd('x !urgent', TODAY).priority).toBe(3)
    expect(parseQuickAdd('x !low', TODAY).priority).toBe(0)
  })

  it('leaves a priority that is not one alone', () => {
    const parsed = parseQuickAdd('Fix bug !9', TODAY)
    expect(parsed.priority).toBeNull()
    expect(parsed.spans.filter((span) => span.kind === 'priority')).toEqual([])
  })

  it('does not mistake an email address for a client', () => {
    // Not supported, and it must not half-work: a title containing an address
    // should keep it.
    const parsed = parseQuickAdd('Email dana@acme.co.uk', TODAY)
    expect(parsed.title).toContain('dana')
  })
})

describe('all of it at once', () => {
  it('reads the sentence from the spec', () => {
    const parsed = parseQuickAdd('Call Dana tomorrow 2pm #Rebrand !2 ~Admin @Acme', TODAY)

    expect(parsed).toMatchObject({
      title: 'Call Dana',
      dueAt: '2026-08-27',
      dueMinutes: 840,
      project: 'Rebrand',
      client: 'Acme',
      category: 'Admin',
      priority: 2
    })
  })

  it('does not care what order they come in', () => {
    const parsed = parseQuickAdd('#Rebrand tomorrow Call Dana', TODAY)

    expect(parsed.title).toBe('Call Dana')
    expect(parsed.project).toBe('Rebrand')
    expect(parsed.dueAt).toBe('2026-08-27')
  })

  it('copes with nothing but tokens', () => {
    const parsed = parseQuickAdd('#Rebrand tomorrow', TODAY)
    expect(parsed.title).toBe('')
  })

  it('copes with nothing at all', () => {
    expect(parseQuickAdd('', TODAY).title).toBe('')
  })
})

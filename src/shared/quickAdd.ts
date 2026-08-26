import { addDays } from './calendar'

/**
 * Reading "Call Dana tomorrow 2pm #Rebrand !2" as a task.
 *
 * The same bargain as `parseLoggedTime`: the sentence is the feature, and
 * anything it is not sure about is left in the title rather than guessed at.
 * A quick-add that silently books a task to the wrong project is worse than
 * one that leaves you to pick the project yourself.
 *
 * What it does *not* do is decide which project `#Rebrand` means. That needs
 * the workspace, and this file has no database — it returns the words and the
 * caller matches them against what actually exists, which is also what lets
 * the UI show "→ Acme rebrand" before anything is created.
 *
 * Every token reports the span it came from, so the input can underline what
 * it understood as you type. Somebody who can see that `tomorrow` was read as
 * a date does not have to submit the thing to find out.
 */

export interface Span {
  start: number
  end: number
}

export interface QuickAdd {
  /** What is left once the tokens are taken out. */
  title: string
  /** `yyyy-mm-dd`, or null when no date was written. */
  dueAt: string | null
  /** Minutes past midnight, or null. Only ever set alongside a date. */
  dueMinutes: number | null
  /** The words after `#`, for the caller to match against real projects. */
  project: string | null
  /** The words after `@`, for a client. */
  client: string | null
  /** The words after `~`, for a task category. */
  category: string | null
  /** 0–3, matching the task priority column. Null when unwritten. */
  priority: number | null
  /** Every recognised token, so the input can show what it read. */
  spans: (Span & { kind: 'date' | 'time' | 'project' | 'client' | 'category' | 'priority' })[]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * The words worth supporting, and no more.
 *
 * "Next Tuesday" and "in 3 days" are what people type. "The Tuesday after
 * next" is a date picker's job, and getting it subtly wrong puts a deadline in
 * the wrong week — which is exactly the failure this feature must not have.
 */
const RELATIVE: Record<string, number> = {
  today: 0,
  tonight: 0,
  tomorrow: 1,
  tmw: 1
}

const PRIORITIES: Record<string, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
}

/**
 * Match a token, record its span, and blank it out of the working text.
 *
 * Blanking rather than removing keeps every later index pointing at the same
 * character of the original string, which is what makes the reported spans
 * line up with what the user typed.
 */
function take(
  text: string,
  pattern: RegExp,
  onMatch: (match: RegExpExecArray) => void
): { text: string; span: Span | null } {
  const match = pattern.exec(text)
  if (!match) return { text, span: null }

  onMatch(match)

  // A leading space in the pattern belongs to the separator, not the token.
  const lead = match[0].length - match[0].trimStart().length
  const start = match.index + lead
  const end = match.index + match[0].length

  return {
    text: text.slice(0, start) + ' '.repeat(end - start) + text.slice(end),
    span: { start, end }
  }
}

/**
 * A tag is one word, or several inside quotes.
 *
 * Unquoted tags stop at the first space, and they have to: `#Rebrand tomorrow
 * Call Dana` has no way to tell where the project name ends, and a greedy tag
 * swallows the entire sentence. Nobody types quotes, so the answer for a
 * two-word project is not to quote it — it is that the caller matches this
 * hint against the projects that actually exist, and `#Acme` finds "Acme
 * rebrand 2026" on its own.
 *
 * Written out three times rather than built from a string. A template literal
 * eats a lone backslash — \\s inside one becomes a plain "s" — and the
 * pattern then silently stops matching a space.
 */
const TAGS = {
  project: /(?:^|\s)#(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}'&-]*))/u,
  // The leading separator is what keeps an email address out of this: the @ in
  // "dana@acme.co.uk" has a word character before it, not a space.
  client: /(?:^|\s)@(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}'&-]*))/u,
  category: /(?:^|\s)~(?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}'&-]*))/u
} as const

function tagValue(match: RegExpExecArray): string | null {
  const value = (match[1] ?? match[2] ?? '').trim()
  return value === '' ? null : value
}

export function parseQuickAdd(input: string, today: string): QuickAdd {
  const result: QuickAdd = {
    title: '',
    dueAt: null,
    dueMinutes: null,
    project: null,
    client: null,
    category: null,
    priority: null,
    spans: []
  }

  let text = input

  const record = (span: Span | null, kind: QuickAdd['spans'][number]['kind']): void => {
    if (span) result.spans.push({ ...span, kind })
  }

  // Tagged tokens first: they are unambiguous, and taking them out stops a
  // project called "Friday launch" being read as a date.
  {
    const taken = take(text, TAGS.project, (match) => {
      result.project = tagValue(match)
    })
    text = taken.text
    record(taken.span, 'project')
  }
  {
    const taken = take(text, TAGS.client, (match) => {
      result.client = tagValue(match)
    })
    text = taken.text
    record(taken.span, 'client')
  }
  {
    const taken = take(text, TAGS.category, (match) => {
      result.category = tagValue(match)
    })
    text = taken.text
    record(taken.span, 'category')
  }
  {
    const taken = take(text, /(?:^|\s)!(\d|low|normal|high|urgent)\b/i, (match) => {
      result.priority = PRIORITIES[match[1]!.toLowerCase()] ?? null
    })
    text = taken.text
    // A `!9` is not a priority; do not underline it as one.
    record(result.priority === null ? null : taken.span, 'priority')
  }

  // Then the date, longest and most specific forms first so "next friday" is
  // not consumed by the bare "friday" rule.
  text = takeDate(text, today, result, record)

  // Time last: it only means something once there is a day to hang it on, and
  // "2pm" with no date is a task due at two o'clock on no particular day.
  if (result.dueAt) {
    const taken = take(text, /(?:^|\s)(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|(?:^|\s)(\d{1,2}):(\d{2})\b/i,
      (match) => {
        const meridiem = match[3]?.toLowerCase()
        if (meridiem) {
          const hour = Number(match[1])
          if (hour < 1 || hour > 12) return
          const base = hour === 12 ? 0 : hour
          result.dueMinutes = (meridiem === 'pm' ? base + 12 : base) * 60 + Number(match[2] ?? 0)
        } else {
          const hour = Number(match[4])
          const minute = Number(match[5])
          if (hour > 23 || minute > 59) return
          result.dueMinutes = hour * 60 + minute
        }
      }
    )
    if (result.dueMinutes !== null) {
      text = taken.text
      record(taken.span, 'time')
    }
  }

  result.title = text.replace(/\s+/g, ' ').trim()
  result.spans.sort((a, b) => a.start - b.start)
  return result
}

function takeDate(
  text: string,
  today: string,
  result: QuickAdd,
  record: (span: Span | null, kind: 'date') => void
): string {
  // "in 3 days" / "in 2 weeks"
  {
    const taken = take(text, /(?:^|\s)in (\d{1,3}) (day|days|week|weeks)\b/i, (match) => {
      const count = Number(match[1])
      result.dueAt = addDays(today, match[2]!.toLowerCase().startsWith('week') ? count * 7 : count)
    })
    if (taken.span) {
      record(taken.span, 'date')
      return taken.text
    }
  }

  // "next monday", "next week"
  {
    const taken = take(text, /(?:^|\s)next (week|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b/i,
      (match) => {
        const word = match[1]!.toLowerCase()
        if (word === 'week') {
          result.dueAt = addDays(today, 7)
          return
        }
        result.dueAt = nextWeekday(today, word, true)
      }
    )
    if (taken.span) {
      record(taken.span, 'date')
      return taken.text
    }
  }

  // "today", "tomorrow"
  {
    const taken = take(text, /(?:^|\s)(today|tonight|tomorrow|tmw)\b/i, (match) => {
      result.dueAt = addDays(today, RELATIVE[match[1]!.toLowerCase()] ?? 0)
    })
    if (taken.span) {
      record(taken.span, 'date')
      return taken.text
    }
  }

  // A bare weekday means the next one coming, which is how people use it.
  {
    const taken = take(text, /(?:^|\s)(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b/i,
      (match) => {
        result.dueAt = nextWeekday(today, match[1]!.toLowerCase(), false)
      }
    )
    if (taken.span) {
      record(taken.span, 'date')
      return taken.text
    }
  }

  // "12 aug", "12 august", "3 mar"
  {
    const taken = take(
      text,
      /(?:^|\s)(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
      (match) => {
        result.dueAt = onOrAfter(today, Number(match[1]), MONTHS[match[2]!.toLowerCase()]!)
      }
    )
    if (taken.span) {
      record(taken.span, 'date')
      return taken.text
    }
  }

  // "12/08" and "12/08/2026" — day first, because this is a British app and
  // reading 03/04 as the third of April is the only answer that will not
  // occasionally put a deadline four weeks out.
  {
    const taken = take(text, /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (match) => {
      const day = Number(match[1])
      const month = Number(match[2])
      if (day < 1 || day > 31 || month < 1 || month > 12) return
      if (match[3]) {
        const year = Number(match[3])
        result.dueAt = iso(year < 100 ? 2000 + year : year, month, day)
      } else {
        result.dueAt = onOrAfter(today, day, month)
      }
    })
    if (result.dueAt) {
      record(taken.span, 'date')
      return taken.text
    }
  }

  return text
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * A day and month with no year means the next one that has not happened.
 *
 * Typing "3 jan" in December means the January coming, not the one eleven
 * months gone — and a task dated in the past is a task that shows up as
 * already overdue the moment it is made.
 */
function onOrAfter(today: string, day: number, month: number): string {
  const year = Number(today.slice(0, 4))
  const candidate = iso(year, month, day)
  return candidate >= today ? candidate : iso(year + 1, month, day)
}

/**
 * The next Friday. "Next Friday" on a Wednesday means the one in nine days,
 * not the one in two — that is what people mean by "next", and the difference
 * is a week.
 */
function nextWeekday(today: string, word: string, skipAWeek: boolean): string {
  const target = WEEKDAYS.findIndex((name) => name.startsWith(word.slice(0, 3)))
  if (target === -1) return today

  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  const current = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  let ahead = (target - current + 7) % 7
  // Today is not "on Friday" when said on a Friday; it means the next one.
  if (ahead === 0) ahead = 7
  if (skipAWeek && ahead <= 7 && target > current) ahead += 7

  return addDays(today, ahead)
}

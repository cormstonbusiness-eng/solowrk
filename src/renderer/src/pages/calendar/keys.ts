/**
 * What a keystroke means in the calendar.
 *
 * A pure function from an event to an intention, separate from anything that
 * acts on it, because "the calendar must be fully operable without a mouse"
 * is a claim about forty key combinations and their interactions — which
 * modifiers suppress which, what happens with a block focused versus without,
 * what must never fire while somebody is typing a title. That is a table, and
 * a table is worth testing rather than clicking.
 *
 * The one rule that matters more than the rest: **nothing fires while the
 * caret is in a field.** The grid grew an inline title input, so a shortcut
 * that ignored that would rename a block to "Ne" and then open a new one.
 */

export type View = 'month' | 'week' | 'day' | 'agenda'
export type Lens = 'time' | 'money' | 'capacity' | 'actual' | 'client'

export type CalendarAction =
  | { kind: 'step'; direction: 1 | -1 }
  | { kind: 'today' }
  | { kind: 'view'; view: View }
  | { kind: 'lens'; lens: Lens }
  | { kind: 'new' }
  | { kind: 'toggleRail' }
  | { kind: 'open' }
  | { kind: 'select' }
  | { kind: 'nudge'; minutes: -1 | 1 }
  | { kind: 'resize'; minutes: -1 | 1 }
  | { kind: 'shiftDays'; days: -1 | 1 }
  | { kind: 'delete' }
  | { kind: 'duplicate' }
  | { kind: 'zoom'; direction: 1 | -1 }
  | { kind: 'focusMode' }
  | { kind: 'ghostWeek'; average: boolean }
  | { kind: 'scenario' }
  | { kind: 'availability' }
  | { kind: 'goToDate' }
  | { kind: 'escape' }

export interface KeyContext {
  /** Whether a block currently has keyboard focus. Several keys depend on it. */
  hasFocus: boolean
}

const VIEW_KEYS: Record<string, View> = {
  d: 'day',
  w: 'week',
  m: 'month',
  a: 'agenda',
  // `L` for list, which is the agenda under another name. Both are in the
  // specification's table and both should work.
  l: 'agenda'
}

const LENS_KEYS: Record<string, Lens> = {
  '1': 'time',
  '2': 'money',
  '3': 'capacity',
  '4': 'actual',
  '5': 'client'
}

/**
 * Whether the event came from somewhere a keystroke means text.
 *
 * Checked on the event target rather than on a "modal is open" flag: the
 * calendar has an input sitting *on* the grid, and a flag would have to be
 * remembered in a place that does not know the input exists.
 */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/**
 * Read one key press.
 *
 * Returns null for anything unclaimed, which is most of them — the browser and
 * the rest of the app keep everything this does not name.
 */
export function interpret(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target'>,
  context: KeyContext
): CalendarAction | null {
  if (isTyping(event.target)) return null

  const control = event.ctrlKey || event.metaKey
  const key = event.key
  const lower = key.toLowerCase()

  if (key === 'Escape') return { kind: 'escape' }

  /* --- combinations first, so a bare letter cannot swallow them --- */

  if (control && event.shiftKey) {
    if (lower === 's') return { kind: 'scenario' }
    if (lower === 'c') return { kind: 'availability' }
    return null
  }

  if (control) {
    if (lower === 'd') return { kind: 'duplicate' }
    // Only meaningful with something focused; otherwise the browser keeps it.
    if (key === 'ArrowLeft' && context.hasFocus) return { kind: 'shiftDays', days: -1 }
    if (key === 'ArrowRight' && context.hasFocus) return { kind: 'shiftDays', days: 1 }
    return null
  }

  if (event.shiftKey) {
    // Resizing, and only with a block focused — otherwise Shift+Arrow is a
    // text selection somewhere and none of our business.
    if (key === 'ArrowUp' && context.hasFocus) return { kind: 'resize', minutes: -1 }
    if (key === 'ArrowDown' && context.hasFocus) return { kind: 'resize', minutes: 1 }
    if (lower === 'g') return { kind: 'ghostWeek', average: true }
    return null
  }

  /* --- bare keys --- */

  if (key === 'ArrowLeft') return { kind: 'step', direction: -1 }
  if (key === 'ArrowRight') return { kind: 'step', direction: 1 }

  // Up and down move the focused block, and mean nothing without one — the
  // page has to keep its scroll.
  if (key === 'ArrowUp' && context.hasFocus) return { kind: 'nudge', minutes: -1 }
  if (key === 'ArrowDown' && context.hasFocus) return { kind: 'nudge', minutes: 1 }

  if (key === 'Enter' && context.hasFocus) return { kind: 'open' }
  if (key === ' ' && context.hasFocus) return { kind: 'select' }
  if ((key === 'Delete' || key === 'Backspace') && context.hasFocus) return { kind: 'delete' }

  if (LENS_KEYS[key]) return { kind: 'lens', lens: LENS_KEYS[key]! }
  if (VIEW_KEYS[lower]) return { kind: 'view', view: VIEW_KEYS[lower]! }

  if (lower === 't') return { kind: 'today' }
  if (lower === 'n') return { kind: 'new' }
  if (lower === 'u') return { kind: 'toggleRail' }
  if (lower === 'f' && context.hasFocus) return { kind: 'focusMode' }
  if (lower === 'g') return { kind: 'ghostWeek', average: false }

  // `+` arrives as `=` on most layouts unshifted, and `−` can be either.
  if (key === '+' || key === '=') return { kind: 'zoom', direction: 1 }
  if (key === '-' || key === '_') return { kind: 'zoom', direction: -1 }

  return null
}

/**
 * Whether an action should stop the browser doing its own thing.
 *
 * Arrows scroll, Space scrolls, Backspace navigates back in some hosts. Every
 * action we claim has to say so, and the ones we do not claim must be left
 * entirely alone — a calendar that swallowed Ctrl+F would be worse than one
 * with no shortcuts at all.
 */
export function claimsKey(action: CalendarAction): boolean {
  return action.kind !== 'escape'
}

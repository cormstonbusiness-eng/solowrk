import { describe, expect, it } from 'vitest'
import { interpret, isTyping, type CalendarAction, type KeyContext } from './keys'

type Press = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
}

const read = (press: Press, context: KeyContext = { hasFocus: false }): CalendarAction | null =>
  interpret(
    {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: null,
      ...press
    } as Parameters<typeof interpret>[0],
    context
  )

const focused: KeyContext = { hasFocus: true }

/** A stand-in for the caret being somewhere it matters. */
const field = (tagName: string): EventTarget =>
  ({ tagName, isContentEditable: false }) as unknown as EventTarget

describe('while somebody is typing', () => {
  it('claims nothing at all', () => {
    // The grid has an inline title input sitting on it. A shortcut that
    // ignored this would rename a block to "Ne" and then open a new one.
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(read({ key: 'n', target: field(tag) })).toBeNull()
      expect(read({ key: 'Delete', target: field(tag) }, focused)).toBeNull()
      expect(read({ key: 'ArrowRight', target: field(tag) })).toBeNull()
    }
  })

  it('recognises a contenteditable too', () => {
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget
    expect(isTyping(editable)).toBe(true)
    expect(read({ key: 't', target: editable })).toBeNull()
  })

  it('does not mistake the grid itself for a field', () => {
    expect(isTyping(field('DIV'))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

describe('moving about', () => {
  it('steps a period with the arrows', () => {
    expect(read({ key: 'ArrowLeft' })).toEqual({ kind: 'step', direction: -1 })
    expect(read({ key: 'ArrowRight' })).toEqual({ kind: 'step', direction: 1 })
  })

  it('jumps to today', () => {
    expect(read({ key: 't' })).toEqual({ kind: 'today' })
    expect(read({ key: 'T' })).toEqual({ kind: 'today' })
  })

  it('switches view', () => {
    expect(read({ key: 'd' })).toEqual({ kind: 'view', view: 'day' })
    expect(read({ key: 'w' })).toEqual({ kind: 'view', view: 'week' })
    expect(read({ key: 'm' })).toEqual({ kind: 'view', view: 'month' })
    expect(read({ key: 'a' })).toEqual({ kind: 'view', view: 'agenda' })
    // `L` for list, which is the same view under the other name the
    // specification uses for it.
    expect(read({ key: 'l' })).toEqual({ kind: 'view', view: 'agenda' })
  })

  it('switches lens on the number row', () => {
    expect(read({ key: '1' })).toEqual({ kind: 'lens', lens: 'time' })
    expect(read({ key: '2' })).toEqual({ kind: 'lens', lens: 'money' })
    expect(read({ key: '3' })).toEqual({ kind: 'lens', lens: 'capacity' })
    expect(read({ key: '4' })).toEqual({ kind: 'lens', lens: 'actual' })
    expect(read({ key: '5' })).toEqual({ kind: 'lens', lens: 'client' })
    expect(read({ key: '6' })).toBeNull()
  })
})

describe('keys that need a block', () => {
  it('do nothing without one', () => {
    // Up and down have to keep scrolling the page when nothing is focused.
    expect(read({ key: 'ArrowUp' })).toBeNull()
    expect(read({ key: 'ArrowDown' })).toBeNull()
    expect(read({ key: 'Enter' })).toBeNull()
    expect(read({ key: ' ' })).toBeNull()
    expect(read({ key: 'Delete' })).toBeNull()
    expect(read({ key: 'f' })).toBeNull()
  })

  it('act once there is one', () => {
    expect(read({ key: 'ArrowUp' }, focused)).toEqual({ kind: 'nudge', minutes: -1 })
    expect(read({ key: 'ArrowDown' }, focused)).toEqual({ kind: 'nudge', minutes: 1 })
    expect(read({ key: 'Enter' }, focused)).toEqual({ kind: 'open' })
    expect(read({ key: ' ' }, focused)).toEqual({ kind: 'select' })
    expect(read({ key: 'Delete' }, focused)).toEqual({ kind: 'delete' })
    expect(read({ key: 'f' }, focused)).toEqual({ kind: 'focusMode' })
  })

  it('treats Backspace as Delete, which is what a Mac has', () => {
    expect(read({ key: 'Backspace' }, focused)).toEqual({ kind: 'delete' })
  })

  it('resizes with Shift held', () => {
    expect(read({ key: 'ArrowUp', shiftKey: true }, focused)).toEqual({
      kind: 'resize',
      minutes: -1
    })
    expect(read({ key: 'ArrowDown', shiftKey: true }, focused)).toEqual({
      kind: 'resize',
      minutes: 1
    })
  })

  it('leaves Shift+Arrow alone when nothing is focused', () => {
    // It is a text selection somewhere and none of our business.
    expect(read({ key: 'ArrowUp', shiftKey: true })).toBeNull()
  })

  it('moves by a day with Ctrl held', () => {
    expect(read({ key: 'ArrowLeft', ctrlKey: true }, focused)).toEqual({
      kind: 'shiftDays',
      days: -1
    })
    expect(read({ key: 'ArrowRight', ctrlKey: true }, focused)).toEqual({
      kind: 'shiftDays',
      days: 1
    })
  })

  it('does not step the week when Ctrl+Arrow has nothing to move', () => {
    // Ctrl+Arrow is a word jump in most hosts. Claiming it for nothing would
    // be worse than not claiming it.
    expect(read({ key: 'ArrowLeft', ctrlKey: true })).toBeNull()
  })
})

describe('the combinations', () => {
  it('does not let a bare letter swallow its modified form', () => {
    // `D` is the day view and Ctrl+D is duplicate. Reading them in the wrong
    // order would make one of the two unreachable.
    expect(read({ key: 'd' })).toEqual({ kind: 'view', view: 'day' })
    expect(read({ key: 'd', ctrlKey: true })).toEqual({ kind: 'duplicate' })
  })

  it('keeps Ghost week and its average apart', () => {
    expect(read({ key: 'g' })).toEqual({ kind: 'ghostWeek', average: false })
    expect(read({ key: 'g', shiftKey: true })).toEqual({ kind: 'ghostWeek', average: true })
  })

  it('reads the two three-key gestures', () => {
    expect(read({ key: 's', ctrlKey: true, shiftKey: true })).toEqual({ kind: 'scenario' })
    expect(read({ key: 'c', ctrlKey: true, shiftKey: true })).toEqual({ kind: 'availability' })
  })

  it('treats Cmd as Ctrl, because half the world is on a Mac', () => {
    expect(read({ key: 'd', metaKey: true })).toEqual({ kind: 'duplicate' })
  })

  it('leaves everything it has not claimed alone', () => {
    // A calendar that swallowed Ctrl+F would be worse than one with no
    // shortcuts at all.
    expect(read({ key: 'f', ctrlKey: true })).toBeNull()
    expect(read({ key: 'p', ctrlKey: true })).toBeNull()
    expect(read({ key: 'z', ctrlKey: true })).toBeNull()
    expect(read({ key: 'q' })).toBeNull()
  })
})

describe('zoom', () => {
  it('takes the shifted and unshifted forms of both', () => {
    // `+` is Shift+= on most layouts, so both have to work.
    expect(read({ key: '+' })).toEqual({ kind: 'zoom', direction: 1 })
    expect(read({ key: '=' })).toEqual({ kind: 'zoom', direction: 1 })
    expect(read({ key: '-' })).toEqual({ kind: 'zoom', direction: -1 })
    expect(read({ key: '_' })).toEqual({ kind: 'zoom', direction: -1 })
  })
})

describe('Escape', () => {
  it('is left to the field it was pressed in', () => {
    // The inline title input cancels itself on Escape. Claiming it here
    // would close the drawer behind somebody mid-word instead.
    expect(read({ key: 'Escape', target: field('INPUT') })).toBeNull()
  })

  it('is claimed everywhere else', () => {
    expect(read({ key: 'Escape' })).toEqual({ kind: 'escape' })
  })
})

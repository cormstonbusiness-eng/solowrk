import { describe, expect, it } from 'vitest'
import {
  emptySelection,
  resolveClick,
  resolveToggleAll,
  type SelectionState
} from './useSelection'

/** Six rows, as they appear on screen. */
const order = [10, 20, 30, 40, 50, 60]

const state = (selected: number[], anchor: number | null = null): SelectionState => ({
  selected: new Set(selected),
  anchor
})

const ids = (next: SelectionState): number[] => [...next.selected].sort((a, b) => a - b)

describe('a plain click', () => {
  it('selects one row and anchors there', () => {
    const next = resolveClick(emptySelection, 30, order)
    expect(ids(next)).toEqual([30])
    expect(next.anchor).toBe(30)
  })

  it('replaces whatever was selected', () => {
    const next = resolveClick(state([10, 20], 10), 50, order)
    expect(ids(next)).toEqual([50])
  })

  it('clears when it is the only row already selected', () => {
    // What every list in every OS does, and the only way to deselect without
    // reaching for a modifier.
    const next = resolveClick(state([30], 30), 30, order)
    expect(ids(next)).toEqual([])
    expect(next.anchor).toBeNull()
  })

  it('does not clear when it is one of several', () => {
    const next = resolveClick(state([10, 30], 10), 30, order)
    expect(ids(next)).toEqual([30])
  })
})

describe('toggling one row', () => {
  it('adds without disturbing the rest', () => {
    const next = resolveClick(state([10], 10), 40, order, { toggle: true })
    expect(ids(next)).toEqual([10, 40])
  })

  it('removes one that was in', () => {
    const next = resolveClick(state([10, 40], 10), 40, order, { toggle: true })
    expect(ids(next)).toEqual([10])
  })

  it('moves the anchor even when removing', () => {
    // The next range should run from the row last touched, whatever happened
    // to it — otherwise a toggle-off leaves the anchor somewhere invisible.
    const next = resolveClick(state([10, 40], 10), 40, order, { toggle: true })
    expect(next.anchor).toBe(40)
  })
})

describe('Shift ranges', () => {
  it('runs from the anchor forwards', () => {
    const next = resolveClick(state([20], 20), 50, order, { shift: true })
    expect(ids(next)).toEqual([20, 30, 40, 50])
  })

  it('runs backwards just as readily', () => {
    // The bug every hand-rolled list ships with: an anchor compared the wrong
    // way round selects nothing at all when you Shift-click upward.
    const next = resolveClick(state([50], 50), 20, order, { shift: true })
    expect(ids(next)).toEqual([20, 30, 40, 50])
  })

  it('does not move the anchor, so it can be redrawn', () => {
    // Repeated Shift-clicks redraw from a fixed point rather than creeping
    // down the list one row per click.
    const first = resolveClick(state([20], 20), 40, order, { shift: true })
    expect(first.anchor).toBe(20)

    const second = resolveClick(first, 60, order, { shift: true })
    expect(second.anchor).toBe(20)
    expect(ids(second)).toEqual([20, 30, 40, 50, 60])
  })

  it('builds up when somebody draws two ranges', () => {
    const first = resolveClick(state([10], 10), 20, order, { shift: true })
    const moved = resolveClick(first, 50, order, { toggle: true })
    const second = resolveClick(moved, 60, order, { shift: true })
    expect(ids(second)).toEqual([10, 20, 50, 60])
  })

  it('is a plain click when there is no anchor yet', () => {
    const next = resolveClick(emptySelection, 30, order, { shift: true })
    expect(ids(next)).toEqual([30])
  })

  it('is a plain click when the anchor has been filtered away', () => {
    // An index of -1 would otherwise slice the whole list and select all of
    // it, which is a startling thing to happen after changing a filter.
    const next = resolveClick(state([99], 99), 30, order, { shift: true })
    expect(ids(next)).toEqual([30])
  })

  it('selects the single row when both ends are the same', () => {
    const next = resolveClick(state([30], 30), 30, order, { shift: true })
    expect(ids(next)).toEqual([30])
  })

  it('follows the order on screen, not the numbers', () => {
    // A list sorted by name is not sorted by id, and the range is what you
    // can see between two rows.
    const shown = [60, 10, 40, 20]
    const next = resolveClick(state([60], 60), 40, shown, { shift: true })
    expect(ids(next)).toEqual([10, 40, 60])
  })
})

describe('select all', () => {
  it('takes everything on screen', () => {
    const next = resolveToggleAll(emptySelection, order)
    expect(ids(next)).toEqual(order)
  })

  it('clears when everything already is', () => {
    const next = resolveToggleAll(state(order, 10), order)
    expect(ids(next)).toEqual([])
  })

  it('selects the rest when only some are', () => {
    const next = resolveToggleAll(state([10, 20], 10), order)
    expect(ids(next)).toEqual(order)
  })

  it('takes only what is on screen, never what a filter is hiding', () => {
    const shown = [10, 20]
    const next = resolveToggleAll(emptySelection, shown)
    expect(ids(next)).toEqual([10, 20])
  })

  it('does nothing to an empty list', () => {
    const current = state([10], 10)
    expect(resolveToggleAll(current, [])).toBe(current)
  })
})

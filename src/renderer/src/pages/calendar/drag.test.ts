import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD,
  MIN_BLOCK_MINUTES,
  cancel,
  createSpan,
  drag,
  edgesOn,
  idle,
  moveSpan,
  press,
  release,
  resizeSpan,
  snapTo,
  type DragState,
  type GridPoint,
  type SnapOptions
} from './drag'

const grid: SnapOptions = { step: 15, edges: [] }
const free: SnapOptions = { step: 1, edges: [] }

const at = (day: string, minutes: number): GridPoint => ({ day, minutes })

/** 10:00–11:00 on the 17th, the block most of these move about. */
const meeting = {
  id: 1,
  startsAt: '2026-08-17T10:00',
  endsAt: '2026-08-17T11:00'
}

describe('the click / drag threshold', () => {
  it('stays a press until the pointer has actually travelled', () => {
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const nudged = drag(pressed, { x: 102, y: 101 }, at('2026-08-17', 602), grid)

    expect(nudged.phase).toBe('pending')
    // Identity, not just equality: the grid uses this to skip a re-render on
    // every one of the hundred pointermoves a slow hand produces.
    expect(nudged).toBe(pressed)
  })

  it('becomes a drag once past the threshold', () => {
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const moved = drag(pressed, { x: 100, y: 100 + DRAG_THRESHOLD }, at('2026-08-17', 615), grid)

    expect(moved.phase).toBe('dragging')
  })

  it('opens the block when the press never became a drag', () => {
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const nudged = drag(pressed, { x: 101, y: 101 }, at('2026-08-17', 601), grid)

    expect(release(nudged)).toEqual({ kind: 'click', subject: meeting })
  })

  it('writes nothing when a drag ends exactly where it started', () => {
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const moved = drag(pressed, { x: 100, y: 140 }, at('2026-08-17', 600), grid)

    expect(moved.phase).toBe('dragging')
    expect(release(moved)).toEqual({ kind: 'none' })
  })
})

describe('Esc', () => {
  it('gives back nothing at all', () => {
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const moved = drag(pressed, { x: 100, y: 200 }, at('2026-08-19', 900), grid)
    expect(moved.phase).toBe('dragging')

    const cancelled = cancel()
    expect(cancelled).toEqual(idle)
    // The state carries the only route to a write, so an idle state is the
    // guarantee: there is nothing left for a caller to commit.
    expect(release(cancelled)).toEqual({ kind: 'none' })
  })
})

describe('moving', () => {
  it('keeps the grab offset', () => {
    // Grabbed at 10:45, three quarters of the way down, and dropped at 15:45.
    // The point grabbed is the point dropped, so the block starts at 15:00.
    const span = moveSpan(meeting, at('2026-08-17', 645), at('2026-08-17', 945), grid)
    expect(span).toEqual({ startsAt: '2026-08-17T15:00', endsAt: '2026-08-17T16:00' })
  })

  it('keeps its length when it changes column', () => {
    const span = moveSpan(meeting, at('2026-08-17', 600), at('2026-08-20', 840), grid)
    expect(span).toEqual({ startsAt: '2026-08-20T14:00', endsAt: '2026-08-20T15:00' })
  })

  it('keeps its length rather than squashing against midnight', () => {
    const span = moveSpan(meeting, at('2026-08-17', 600), at('2026-08-17', 1410), grid)
    expect(span).toEqual({ startsAt: '2026-08-17T23:30', endsAt: '2026-08-18T00:30' })
  })

  it('will not start before midnight', () => {
    const span = moveSpan(meeting, at('2026-08-17', 600), at('2026-08-17', -300), grid)
    expect(span.startsAt).toBe('2026-08-17T00:00')
  })

  it('snaps to the step', () => {
    const span = moveSpan(meeting, at('2026-08-17', 600), at('2026-08-17', 610), grid)
    expect(span.startsAt).toBe('2026-08-17T10:15')
  })

  it('lands on the exact minute while Alt is held', () => {
    const span = moveSpan(meeting, at('2026-08-17', 600), at('2026-08-17', 607), free)
    expect(span.startsAt).toBe('2026-08-17T10:07')
  })
})

describe('resizing', () => {
  it('holds the opposite edge', () => {
    const span = resizeSpan(meeting, at('2026-08-17', 660), at('2026-08-17', 750), grid)
    expect(span).toEqual({ startsAt: '2026-08-17T10:00', endsAt: '2026-08-17T12:30' })
  })

  it('collapses rather than inverting when dragged past its own start', () => {
    const span = resizeSpan(meeting, at('2026-08-17', 660), at('2026-08-17', 300), grid)
    expect(span.startsAt).toBe('2026-08-17T10:00')
    expect(span.endsAt).toBe('2026-08-17T10:15')
  })

  it('never moves the block it is next to', () => {
    // There is no push: growing a block simply overlaps whatever is below,
    // and the overlap layout draws them side by side.
    const span = resizeSpan(meeting, at('2026-08-17', 660), at('2026-08-17', 900), {
      step: 15,
      edges: [720]
    })
    expect(span.startsAt).toBe('2026-08-17T10:00')
  })
})

describe('drawing a new block', () => {
  it('runs from the press to the release', () => {
    const span = createSpan(at('2026-08-17', 540), at('2026-08-17', 630), grid)
    expect(span).toEqual({ startsAt: '2026-08-17T09:00', endsAt: '2026-08-17T10:30' })
  })

  it('inverts when drawn upward', () => {
    // Dragging up is not a mistake — it is "make it start earlier".
    const span = createSpan(at('2026-08-17', 630), at('2026-08-17', 540), grid)
    expect(span).toEqual({ startsAt: '2026-08-17T09:00', endsAt: '2026-08-17T10:30' })
  })

  it('gives a stationary drag the minimum length rather than nothing', () => {
    const span = createSpan(at('2026-08-17', 540), at('2026-08-17', 542), grid)
    expect(span).toEqual({
      startsAt: '2026-08-17T09:00',
      endsAt: `2026-08-17T09:${MIN_BLOCK_MINUTES}`
    })
  })

  it('stays in the column it started in', () => {
    // A new block is drawn down a single day. Dragging sideways mid-draw would
    // otherwise silently move the whole thing to another column.
    const span = createSpan(at('2026-08-17', 540), at('2026-08-19', 630), grid)
    expect(span.startsAt.slice(0, 10)).toBe('2026-08-17')
  })

  it('comes back as a create, never as a change to something', () => {
    const pressed = press('create', at('2026-08-17', 540), { x: 40, y: 40 })
    const drawn = drag(pressed, { x: 40, y: 120 }, at('2026-08-17', 660), grid)

    expect(release(drawn)).toEqual({
      kind: 'create',
      span: { startsAt: '2026-08-17T09:00', endsAt: '2026-08-17T11:00' }
    })
  })
})

describe('snapping to a neighbour', () => {
  it('prefers a nearby edge to the grid', () => {
    // 10:20 is not on a 15-minute grid, but it is where the block above ends,
    // and butting up against it is what somebody dragging there means.
    expect(snapTo(618, { step: 15, edges: [620] })).toBe(620)
  })

  it('falls back to the grid when nothing is near', () => {
    expect(snapTo(604, { step: 15, edges: [700] })).toBe(600)
  })

  it('takes the nearer of two edges', () => {
    expect(snapTo(620, { step: 15, edges: [618, 624] })).toBe(618)
  })

  it('is bypassed along with the grid while Alt is held', () => {
    // Alt is passed through as a step of 1 and no edges, so the two ways of
    // being helpful switch off together — half-free snapping would be worse
    // than either.
    expect(snapTo(618, free)).toBe(618)
  })

  it('ignores the block being dragged, which would otherwise pin it', () => {
    const blocks = [meeting, { id: 2, startsAt: '2026-08-17T14:00', endsAt: '2026-08-17T15:00' }]
    expect(edgesOn(blocks, '2026-08-17', 1)).toEqual([840, 900])
  })

  it('collects both edges of everything else on the day', () => {
    const blocks = [meeting, { id: 2, startsAt: '2026-08-18T14:00', endsAt: '2026-08-18T15:00' }]
    expect(edgesOn(blocks, '2026-08-17', null)).toEqual([600, 660])
  })
})

describe('Ctrl to duplicate', () => {
  it('marks the drag as a copy', () => {
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const moved = drag(pressed, { x: 100, y: 200 }, at('2026-08-17', 720), grid, {
      duplicate: true
    })

    expect(release(moved)).toMatchObject({ kind: 'commit', duplicate: true })
  })

  it('duplicates even when the copy lands where the original is', () => {
    // Normally an unchanged span writes nothing. A Ctrl-drag that ends where
    // it began still means "give me another one", so it is not "no change".
    const pressed = press('move', at('2026-08-17', 600), { x: 100, y: 100 }, meeting)
    const moved = drag(pressed, { x: 100, y: 140 }, at('2026-08-17', 600), grid, {
      duplicate: true
    })

    expect(release(moved)).toMatchObject({ kind: 'commit', duplicate: true })
  })

  it('does not apply to a resize', () => {
    const pressed = press('resize', at('2026-08-17', 660), { x: 100, y: 100 }, meeting)
    const moved = drag(pressed, { x: 100, y: 200 }, at('2026-08-17', 780), grid, {
      duplicate: true
    })

    expect(release(moved)).toMatchObject({ kind: 'commit', duplicate: false })
  })
})

describe('an idle machine', () => {
  it('ignores a move it never saw the press for', () => {
    const state: DragState = idle
    expect(drag(state, { x: 0, y: 0 }, at('2026-08-17', 600), grid)).toBe(state)
    expect(release(state)).toEqual({ kind: 'none' })
  })
})
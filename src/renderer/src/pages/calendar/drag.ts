import { MINUTES_PER_DAY, clamp, dayOf, minutesBetween, minutesOf, stampAt } from '@shared/calendar'

/**
 * What happens between pressing on the grid and letting go.
 *
 * Pure, and in its own module, because dragging is where a calendar is either
 * trusted or not, and the rules are too fiddly to verify by moving a mouse:
 * a press that never becomes a drag must not write; Esc must revert without
 * writing; the grab offset must survive a move across three columns; a resize
 * must hold the opposite edge exactly. Every one of those is a sentence about
 * state, so it is tested as state, and `TimeGrid` only has to turn pixels into
 * minutes and draw what comes back.
 */

/** §6.2: four pixels of travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 4

/** Nothing may be dragged shorter than this. */
export const MIN_BLOCK_MINUTES = 15

/** How close another block's edge has to be, in minutes, to win over the grid. */
export const EDGE_SNAP_MINUTES = 6

export type DragMode = 'create' | 'move' | 'resize'

/** Where the pointer is, in calendar terms rather than pixels. */
export interface GridPoint {
  day: string
  /** Minutes past midnight, unsnapped. */
  minutes: number
}

export interface Span {
  startsAt: string
  endsAt: string
}

export interface DragSubject extends Span {
  /**
   * What is being dragged, which is not always a row.
   *
   * `12@2026-08-17` for one occurrence of a weekly series. Using the row id
   * here would make every occurrence of a series look like the same subject,
   * so dragging one would move all of them on screen and commit to whichever
   * the list happened to hold first.
   */
  key: string
}

export interface Pixels {
  x: number
  y: number
}

export interface SnapOptions {
  /** Grid step in minutes. 1 while Alt is held, which is what bypasses it. */
  step: number
  /**
   * Other blocks' edges on the target day, in minutes past midnight.
   *
   * These beat the grid when they are close enough: butting a block up
   * against the one before it is a thing people mean to do, and a 15-minute
   * grid cannot express "exactly where that one ended" when that one ends at
   * 10:20 because it came from someone else's calendar.
   */
  edges: number[]
}

export type DragState =
  | { phase: 'idle' }
  | {
      phase: 'pending'
      mode: DragMode
      /** null when creating: there is nothing there yet. */
      subject: DragSubject | null
      origin: GridPoint
      pressedAt: Pixels
    }
  | {
      phase: 'dragging'
      mode: DragMode
      subject: DragSubject | null
      origin: GridPoint
      pressedAt: Pixels
      span: Span
      /** Ctrl held: leave the original where it is and make a copy. */
      duplicate: boolean
    }

export const idle: DragState = { phase: 'idle' }

/**
 * What a release means. `click` is the important one: a press that never
 * crossed the threshold is not a tiny drag, it is somebody opening a block,
 * and treating it as a drag would write a new time on every open.
 */
export type DragResult =
  | { kind: 'none' }
  | { kind: 'click'; subject: DragSubject }
  | { kind: 'create'; span: Span }
  | { kind: 'commit'; subject: DragSubject; span: Span; duplicate: boolean }

export function press(
  mode: DragMode,
  origin: GridPoint,
  pressedAt: Pixels,
  subject: DragSubject | null = null
): DragState {
  return { phase: 'pending', mode, subject, origin, pressedAt }
}

/**
 * Snap a minute to the grid, or to a neighbouring edge if one is nearer.
 *
 * Edges are checked first and win outright rather than being weighed against
 * the grid: the point of edge snapping is that 10:20 is reachable at all, and
 * a rule that only used it when it also happened to be the closer answer would
 * make it fire almost never.
 */
export function snapTo(minutes: number, options: SnapOptions): number {
  let nearest: number | null = null
  let distance = Infinity

  for (const edge of options.edges) {
    const gap = Math.abs(edge - minutes)
    if (gap <= EDGE_SNAP_MINUTES && gap < distance) {
      nearest = edge
      distance = gap
    }
  }

  if (nearest !== null) return nearest
  return Math.round(minutes / options.step) * options.step
}

/**
 * Where a moved block lands.
 *
 * The delta is measured from where the pointer went down, not from the block's
 * own start, so grabbing a two-hour block by its last ten minutes and dropping
 * it at 3pm puts those ten minutes at 3pm. Grabbing it anywhere else and
 * dropping it in the same place moves it the same distance — which is the
 * whole of what "direct manipulation" means here.
 */
export function moveSpan(
  subject: Span,
  origin: GridPoint,
  point: GridPoint,
  options: SnapOptions
): Span {
  const duration = minutesBetween(subject.startsAt, subject.endsAt)
  const shifted = minutesOf(subject.startsAt) + (point.minutes - origin.minutes)
  const start = clamp(snapTo(shifted, options), 0, MINUTES_PER_DAY - MIN_BLOCK_MINUTES)

  return {
    startsAt: stampAt(point.day, start),
    // `stampAt` rolls past midnight into the next day, so a block dragged to
    // 23:30 keeps its length rather than being squashed against the boundary.
    endsAt: stampAt(point.day, start + duration)
  }
}

/**
 * Where a resized block ends.
 *
 * The start is returned untouched and the end never crosses it — resizing
 * holds the opposite edge, and a block dragged past its own start collapses to
 * the minimum rather than inverting. Nothing else moves: no pushing.
 */
export function resizeSpan(
  subject: Span,
  origin: GridPoint,
  point: GridPoint,
  options: SnapOptions
): Span {
  const day = dayOf(subject.startsAt)
  const startMinutes = minutesOf(subject.startsAt)
  const dragged = minutesBetween(subject.startsAt, subject.endsAt) + (point.minutes - origin.minutes)
  const duration = Math.max(MIN_BLOCK_MINUTES, snapTo(startMinutes + dragged, options) - startMinutes)

  return {
    startsAt: subject.startsAt,
    endsAt: stampAt(day, startMinutes + duration)
  }
}

/**
 * The span being drawn out on empty grid.
 *
 * Dragging upward is not a mistake to be corrected — it is how you say "make
 * it start earlier" — so the two ends swap rather than the drag being ignored.
 */
export function createSpan(origin: GridPoint, point: GridPoint, options: SnapOptions): Span {
  const day = origin.day
  const from = snapTo(origin.minutes, options)
  const to = snapTo(point.day === day ? point.minutes : origin.minutes, options)

  const start = Math.min(from, to)
  const end = Math.max(start + MIN_BLOCK_MINUTES, Math.max(from, to))

  return { startsAt: stampAt(day, start), endsAt: stampAt(day, end) }
}

/**
 * The pointer moved. Below the threshold this is still a press.
 *
 * Returns the state unchanged where nothing has changed, so a caller can use
 * identity to decide whether to re-render — a pointermove fires far more often
 * than the grid needs to redraw.
 */
export function drag(
  state: DragState,
  at: Pixels,
  point: GridPoint,
  options: SnapOptions,
  modifiers: { duplicate?: boolean } = {}
): DragState {
  if (state.phase === 'idle') return state

  const travelled = Math.hypot(at.x - state.pressedAt.x, at.y - state.pressedAt.y)
  if (state.phase === 'pending' && travelled < DRAG_THRESHOLD) return state

  const span =
    state.mode === 'create'
      ? createSpan(state.origin, point, options)
      : state.mode === 'resize'
        ? resizeSpan(state.subject!, state.origin, point, options)
        : moveSpan(state.subject!, state.origin, point, options)

  return {
    phase: 'dragging',
    mode: state.mode,
    subject: state.subject,
    origin: state.origin,
    pressedAt: state.pressedAt,
    span,
    // Only a move can duplicate. Ctrl-resizing a copy is not a thing anybody
    // means, and creating one is what the drag already does.
    duplicate: state.mode === 'move' && modifiers.duplicate === true
  }
}

/**
 * Let go.
 *
 * A drag that ended exactly where it started returns `none` rather than
 * `commit`: writing an identical row would put a pointless entry in the
 * timeline and burn an undo on nothing.
 */
export function release(state: DragState): DragResult {
  if (state.phase === 'idle') return { kind: 'none' }

  if (state.phase === 'pending') {
    return state.subject ? { kind: 'click', subject: state.subject } : { kind: 'none' }
  }

  if (state.mode === 'create') return { kind: 'create', span: state.span }

  const subject = state.subject!
  const unchanged =
    state.span.startsAt === subject.startsAt && state.span.endsAt === subject.endsAt
  if (unchanged && !state.duplicate) return { kind: 'none' }

  return { kind: 'commit', subject, span: state.span, duplicate: state.duplicate }
}

/**
 * Esc.
 *
 * Returns to idle and gives back nothing, which is the point: a cancelled drag
 * must leave no trace, including no write to undo afterwards.
 */
export function cancel(): DragState {
  return idle
}

/**
 * The edges a drag on a given day can snap to.
 *
 * The block being dragged is excluded, or it would snap to where it already
 * is and refuse to move.
 */
export function edgesOn(
  blocks: { key: string; startsAt: string; endsAt: string }[],
  day: string,
  exclude: string | null
): number[] {
  const edges: number[] = []
  for (const block of blocks) {
    if (block.key === exclude) continue
    if (dayOf(block.startsAt) === day) edges.push(minutesOf(block.startsAt))
    if (dayOf(block.endsAt) === day) edges.push(minutesOf(block.endsAt))
  }
  return edges
}
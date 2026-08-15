import { describe, expect, it } from 'vitest'
import {
  CARD_WIDTH,
  GAP,
  MARGIN,
  TOP_INSET,
  placeCard,
  type Rect,
  type Viewport
} from './placement'

const viewport: Viewport = { width: 1360, height: 900 }
const CARD_HEIGHT = 190

/** The sidebar: tall, narrow, hard against the left edge. */
const sidebar: Rect = { top: 32, left: 0, width: 212, height: 868 }

describe('placeCard', () => {
  it('centres the card when a step has no target', () => {
    const { top, left } = placeCard(null, undefined, viewport, CARD_HEIGHT)
    expect(left).toBe(viewport.width / 2 - CARD_WIDTH / 2)
    expect(top).toBe(viewport.height / 2 - CARD_HEIGHT / 2)
  })

  it('places a card to the right of the sidebar, vertically centred on it', () => {
    const { top, left } = placeCard(sidebar, 'right', viewport, CARD_HEIGHT)
    expect(left).toBe(sidebar.left + sidebar.width + GAP)
    expect(top).toBe(sidebar.top + sidebar.height / 2 - CARD_HEIGHT / 2)
  })

  it('falls back when the preferred side does not fit', () => {
    // Hard against the right edge, so 'right' is impossible.
    const rect: Rect = { top: 100, left: 1200, width: 140, height: 60 }
    const { left } = placeCard(rect, 'right', viewport, CARD_HEIGHT)
    expect(left + CARD_WIDTH).toBeLessThanOrEqual(viewport.width - MARGIN)
  })

  it('never covers the titlebar', () => {
    const rect: Rect = { top: 34, left: 600, width: 200, height: 40 }
    const { top } = placeCard(rect, 'top', viewport, CARD_HEIGHT)
    expect(top).toBeGreaterThanOrEqual(TOP_INSET)
  })

  it('keeps the card fully on screen for targets at every edge', () => {
    const edges: Rect[] = [
      { top: 32, left: 0, width: 120, height: 40 },
      { top: 32, left: 1240, width: 120, height: 40 },
      { top: 850, left: 0, width: 120, height: 40 },
      { top: 850, left: 1240, width: 120, height: 40 },
      { top: 400, left: 600, width: 160, height: 80 }
    ]

    for (const rect of edges) {
      for (const preference of ['right', 'left', 'top', 'bottom'] as const) {
        const { top, left } = placeCard(rect, preference, viewport, CARD_HEIGHT)
        expect(left).toBeGreaterThanOrEqual(MARGIN)
        expect(left + CARD_WIDTH).toBeLessThanOrEqual(viewport.width - MARGIN)
        expect(top).toBeGreaterThanOrEqual(TOP_INSET)
        expect(top + CARD_HEIGHT).toBeLessThanOrEqual(viewport.height - MARGIN)
      }
    }
  })

  it('survives a window smaller than the card without producing negatives', () => {
    const tiny: Viewport = { width: 300, height: 200 }
    const { top, left } = placeCard(sidebar, 'right', tiny, CARD_HEIGHT)
    expect(left).toBeGreaterThanOrEqual(MARGIN)
    expect(top).toBeGreaterThanOrEqual(TOP_INSET)
  })
})
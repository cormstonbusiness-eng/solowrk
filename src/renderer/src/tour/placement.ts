/**
 * Where the tour card sits relative to the element being highlighted.
 *
 * Kept free of React so it can be tested directly — the failure mode here is a
 * card half off screen, which is easy to miss by eye on one window size and
 * obvious in a test.
 */

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export type Placement = 'right' | 'bottom' | 'top' | 'left'

export const CARD_WIDTH = 330
/** Gap between the highlighted element and the card. */
export const GAP = 14
/** Keep the card off the window edges. */
export const MARGIN = 16
/** Height of the custom titlebar, which the card must not cover. */
export const TOP_INSET = 40

export interface Viewport {
  width: number
  height: number
}

/**
 * Honour `preference` when the card fits there, otherwise fall back through the
 * remaining sides, then clamp into the viewport. With no rect (a centred step)
 * the card is centred.
 */
export function placeCard(
  rect: Rect | null,
  preference: Placement | undefined,
  viewport: Viewport,
  cardHeight: number
): { top: number; left: number } {
  if (!rect) {
    return {
      top: Math.max(TOP_INSET, viewport.height / 2 - cardHeight / 2),
      left: viewport.width / 2 - CARD_WIDTH / 2
    }
  }

  const fits: Record<Placement, boolean> = {
    right: rect.left + rect.width + GAP + CARD_WIDTH + MARGIN <= viewport.width,
    left: rect.left - GAP - CARD_WIDTH - MARGIN >= 0,
    bottom: rect.top + rect.height + GAP + cardHeight + MARGIN <= viewport.height,
    top: rect.top - GAP - cardHeight - MARGIN >= TOP_INSET
  }

  const order: Placement[] = preference
    ? [preference, 'right', 'bottom', 'top', 'left']
    : ['right', 'bottom', 'top', 'left']
  const placement = order.find((option) => fits[option]) ?? 'bottom'

  let top: number
  let left: number

  if (placement === 'right' || placement === 'left') {
    left = placement === 'right' ? rect.left + rect.width + GAP : rect.left - GAP - CARD_WIDTH
    // Centre on the target vertically — top-aligning against something tall
    // like the sidebar leaves the card stranded at the top of the screen.
    top = rect.top + rect.height / 2 - cardHeight / 2
  } else {
    top = placement === 'bottom' ? rect.top + rect.height + GAP : rect.top - GAP - cardHeight
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2
  }

  return {
    top: Math.min(Math.max(top, TOP_INSET), Math.max(TOP_INSET, viewport.height - cardHeight - MARGIN)),
    left: Math.min(Math.max(left, MARGIN), Math.max(MARGIN, viewport.width - CARD_WIDTH - MARGIN))
  }
}
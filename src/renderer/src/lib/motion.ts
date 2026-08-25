import type { Transition, Variants } from 'motion/react'

/**
 * Every animation in SoloWrk pulls from this file. Components should not invent
 * their own durations or easing curves — if something needs a new one, add it
 * here so the whole app keeps a single sense of timing.
 *
 * Reduced motion is handled globally by <MotionConfig reducedMotion="user">
 * in App.tsx, so nothing below needs to check for it.
 */

/** The house curve: fast out, long gentle settle. */
export const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Nothing here exceeds 250ms, deliberately. Slow animation is the strongest
 * single signal of amateur software, and every value above is one somebody
 * would notice waiting for rather than feel.
 */
export const DURATION = {
  /** Hover and press. */
  press: 0.12,
  /** A single digit changing in a live figure. */
  flip: 0.15,
  /** The default for anything that is not an entrance. */
  standard: 0.18,
  /** Entrances and page transitions. */
  page: 0.2,
  modal: 0.18,
  /** A row opening or closing, and the tick drawing on a checkbox. */
  expand: 0.2
} as const

export const transition = {
  press: { duration: DURATION.press, ease: EASE },
  standard: { duration: DURATION.standard, ease: EASE },
  page: { duration: DURATION.page, ease: EASE },
  modal: { duration: DURATION.modal, ease: EASE },
  /**
   * The sidebar's active indicator, at 180ms.
   *
   * A duration rather than the spring it used to be: a spring overshoots, and
   * on a 3px bar against a hard edge the overshoot reads as the bar coming
   * loose rather than as bounce.
   */
  layout: { duration: DURATION.standard, ease: EASE },
  expand: { duration: DURATION.expand, ease: EASE },
  flip: { duration: DURATION.flip, ease: EASE }
} satisfies Record<string, Transition>

/**
 * Page transitions: an 8px rise with a fade. `mode="wait"` in AnimatePresence
 * means the outgoing page finishes leaving before the next one arrives, which
 * keeps the shell from feeling like two screens fighting.
 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transition.page },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: EASE } }
}

/**
 * Staggered entrance, 40ms between siblings in DOM order.
 *
 * The stagger is capped so a 200-row invoice table does not take eight seconds
 * to appear — after ~12 items everything lands at once. Cards on a dashboard
 * never reach the cap; long lists always do, which is the point.
 */
export const STAGGER_STEP = 0.04
export const STAGGER_MAX_ITEMS = 12

export const listVariants: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: STAGGER_STEP, delayChildren: 0.02 }
  }
}

export const listItemVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transition.page }
}

/** Delay for item `index`, flattening once the list gets long. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP
}

/**
 * Standard press feedback for anything clickable.
 *
 * Scale only — opacity and transform are the only two properties anything in
 * this app animates, because they are the two the compositor can do without
 * touching layout.
 */
export const pressable = {
  whileTap: { scale: 0.98 },
  transition: transition.press
} as const
/**
 * A row opening or closing.
 *
 * Two elements rather than one, and that is the whole point. The outer element
 * animates height; the inner one fades its content in 80ms later, once there is
 * somewhere for it to be. Fading both together is what makes an accordion look
 * cheap: the text arrives at full size inside a box still growing around it,
 * and appears to be squeezed through a letterbox.
 *
 * Closing runs the other way round. The content fades first and quickly, so the
 * height collapses over an empty box rather than crushing readable text.
 *
 * `height: 'auto'` is the one exception to the transform-and-opacity rule
 * elsewhere in this file. There is no way to open a row to a height nobody has
 * measured, and the alternative — measuring it and animating a transform — is
 * worse the moment the content reflows.
 */
export const expandVariants: Variants = {
  initial: { height: 0 },
  animate: { height: 'auto', transition: transition.expand },
  exit: { height: 0, transition: transition.expand }
}

export const expandContentVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12, ease: EASE, delay: 0.08 } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE } }
}

/**
 * Swapping a panel's content for its empty state, and back.
 *
 * Deliberately not a crossfade. Two different things occupying the same space
 * at half opacity reads as a rendering fault, and an empty state that arrives
 * on top of the list it replaced is briefly a lie. So the outgoing content
 * leaves completely, there is a beat of nothing, and then the new thing
 * arrives — which is also how it reads in words: that has gone, and now this is
 * here instead.
 */
export const swapVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.page, ease: EASE, delay: 0.05 } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE } }
}

/**
 * How long a ticked task keeps its place before the list moves it.
 *
 * The tick draws in 200ms and the strike crosses it out in another 200. A
 * refetch comes back in a fraction of that, and the row was being lifted out
 * from under the one animation that was the whole reward for clicking it. So
 * the write goes immediately — nothing is at risk — and only the reshuffle
 * waits.
 *
 * Milliseconds, not seconds, because it is passed to setTimeout rather than to
 * motion.
 */
export const TICK_SETTLE_MS = 400

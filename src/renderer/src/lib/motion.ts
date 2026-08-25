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
  /** The default for anything that is not an entrance. */
  standard: 0.18,
  /** Entrances and page transitions. */
  page: 0.2,
  modal: 0.18
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
  layout: { duration: DURATION.standard, ease: EASE }
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
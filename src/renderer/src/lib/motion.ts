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
export const EASE = [0.32, 0.72, 0, 1] as const

export const DURATION = {
  press: 0.15,
  page: 0.22,
  modal: 0.32
} as const

export const transition = {
  press: { duration: DURATION.press, ease: EASE },
  page: { duration: DURATION.page, ease: EASE },
  modal: { duration: DURATION.modal, ease: EASE },
  /** For layout shifts — springs read better than durations when things move. */
  layout: { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
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
 * Staggered list entrance. The stagger is capped so a 200-row invoice table
 * doesn't take four seconds to appear — after ~12 items everything lands at once.
 */
export const STAGGER_STEP = 0.02
export const STAGGER_MAX_ITEMS = 12

export const listVariants: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: STAGGER_STEP, delayChildren: 0.02 }
  }
}

export const listItemVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: transition.page }
}

/** Delay for item `index`, flattening once the list gets long. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP
}

/** Standard press feedback for anything clickable. */
export const pressable = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.97 },
  transition: transition.press
} as const
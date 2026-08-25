/**
 * Splitting a live figure into the slots that animate and the ones that do not.
 *
 * Pulled out of the component because the keying rule is the only thing here
 * worth arguing about, and an argument that lives inside JSX cannot be tested.
 */

const DIGIT = /[0-9]/

export interface TickerSlot {
  /** Stable across renders for the same position in the figure. */
  key: string
  character: string
  /** Punctuation holds still; digits roll over. */
  animated: boolean
}

/**
 * Slots are keyed from the **right**.
 *
 * A clock counts up, so it grows on the left: 59:59 becomes 1:00:00 and every
 * character shifts along by one. Keyed from the left, every slot would then
 * hold a different character and the whole figure would animate at once —
 * the seconds appearing to change when they did not. Keyed from the right, the
 * seconds stay the seconds, and only the new leading digit arrives.
 *
 * Punctuation is excluded from the animation entirely. A colon in a fixed-width
 * digit box sits wrong, because tabular figures are equal width and punctuation
 * is not.
 */
export function tickerSlots(value: string): TickerSlot[] {
  const characters = [...value]

  return characters.map((character, index) => {
    const fromRight = characters.length - index
    const animated = DIGIT.test(character)

    return {
      key: animated ? String(fromRight) : `fixed-${fromRight}`,
      character,
      animated
    }
  })
}

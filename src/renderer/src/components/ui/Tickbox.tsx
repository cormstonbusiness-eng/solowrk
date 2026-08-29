import { motion } from 'motion/react'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The checkbox on a task.
 *
 * Ticking something off is the smallest good moment in the app, and it was
 * being thrown away: the tick appeared as a finished glyph at the same instant
 * the row moved to the Done list, so the one thing worth watching happened
 * somewhere your eye was not.
 *
 * So the tick is drawn rather than shown. `pathLength` from 0 to 1 animates the
 * stroke the way a pen would, short leg first — 200ms, which is long enough to
 * register as something you did and short enough that a list of twenty does not
 * become a chore.
 *
 * The tick is a hand-written path rather than the one from the icon set because
 * `pathLength` needs a single continuous line, and it needs to start at the end
 * a pen would start at. Lucide's Check is the right shape but makes no promise
 * about which end of it comes first.
 */
export function Tickbox({
  done,
  onToggle,
  label,
  size = 17,
  className
}: {
  done: boolean
  onToggle: () => void
  /** What this is ticking off, for anyone using a screen reader. */
  label: string
  /** The box, in pixels. 17 on a task row, 15 on a subtask. */
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Mark ${label} as not done` : `Mark ${label} as done`}
      onClick={onToggle}
      style={{ width: size, height: size, borderRadius: Math.round(size / 3.4) }}
      className={cn(
        'grid shrink-0 place-items-center border transition-colors duration-expand ease-solo',
        done ? 'border-success bg-success text-white' : 'border-line-strong hover:border-muted',
        className
      )}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: Math.round(size * 0.65), height: Math.round(size * 0.65) }}
        className="overflow-visible"
        aria-hidden
      >
        <motion.path
          d="M3 8.5 L6.5 12 L13 4.5"
          initial={false}
          animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
          transition={transition.expand}
        />
      </svg>
    </button>
  )
}

/**
 * Task text that strikes itself through when the task is done.
 *
 * `text-decoration: line-through` cannot be animated — it is on or it is off —
 * so the line is a real element that grows from the left at the speed somebody
 * would draw it. Which is the point: the strike is the app agreeing with what
 * you just did, and agreement that arrives instantly reads as the text having
 * always been that way.
 *
 * The line is `currentColor` at half strength rather than a fixed grey, so it
 * follows the text through its colour change instead of crossing it.
 *
 * **`block` is load-bearing.** This used to be an inline span carrying
 * `truncate`, and `overflow: hidden` does not apply to an inline non-replaced
 * box — so it silently never clipped, and a long title painted straight across
 * whatever sat beside it. It only showed up on the board, where the column is
 * narrow enough that most titles are long ones.
 */
export function StruckText({
  done,
  children,
  wrap = false,
  className
}: {
  done: boolean
  children: React.ReactNode
  /** Let the text run onto more lines instead of clipping it to one. */
  wrap?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'relative block text-left transition-colors duration-expand ease-solo',
        // `break-words` rather than plain wrapping: a pasted URL is one word,
        // and one word is allowed to be wider than the box it is in.
        wrap ? 'break-words' : 'truncate',
        done ? 'text-faint' : 'text-ink',
        // The drawn line is one rule across the whole block, which strikes the
        // middle line of a three-line title and misses the other two. Wrapped
        // text gives up the animation for a rule that follows every line.
        done && wrap && 'line-through',
        className
      )}
    >
      {children}
      {!wrap && (
        <motion.span
          aria-hidden
          initial={false}
          animate={{ scaleX: done ? 1 : 0 }}
          transition={transition.expand}
          style={{ originX: 0 }}
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-current opacity-60"
        />
      )}
    </span>
  )
}

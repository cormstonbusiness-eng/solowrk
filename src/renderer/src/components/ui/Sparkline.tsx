import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/**
 * Six periods, as a line that draws itself.
 *
 * The point of a sparkline on a stat card is not decoration: one number says
 * what is true, and the line under it says whether that is normal. It is the
 * first question anybody has about a figure and nothing else in the app
 * answers it.
 *
 * Rendered as a `viewBox` of the natural size and stretched, so the component
 * never needs to know its own pixel width — which means it survives a resized
 * window without a measurement pass.
 */
const WIDTH = 100
const HEIGHT = 32

export function Sparkline({
  values,
  colour,
  className
}: {
  values: number[]
  /** A concrete colour, not a token name — this goes into `stroke`. */
  colour: string
  className?: string
}): React.JSX.Element {
  const gradientId = useId()
  const reduced = useReducedMotion()

  const usable = values.length >= 2 ? values : []

  /**
   * A flat dashed baseline when there is nothing to draw.
   *
   * A zero-height line along the bottom would read as a real measurement of
   * nothing, which is worse than admitting there is no history yet.
   */
  if (usable.length === 0 || usable.every((value) => value === 0)) {
    return (
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden
        className={className}
      >
        <line
          x1="0"
          y1={HEIGHT - 1}
          x2={WIDTH}
          y2={HEIGHT - 1}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
          className="text-line-strong"
        />
      </svg>
    )
  }

  const top = Math.max(...usable)
  const bottom = Math.min(...usable, 0)
  // Guarded: a flat non-zero series would otherwise divide by zero and put
  // every point at NaN, which silently renders nothing at all.
  const span = top - bottom || 1

  const points = usable.map((value, index) => {
    const x = (index / (usable.length - 1)) * WIDTH
    // Inset by a stroke width top and bottom so the peak is not clipped.
    const y = HEIGHT - 2 - ((value - bottom) / span) * (HEIGHT - 4)
    return [x, y] as const
  })

  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const fill = `${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity={0.22} />
          <stop offset="100%" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* The fill arrives after the line has finished drawing, so the shape
          fills in behind a line that is already there rather than the two
          racing each other. */}
      <motion.path
        d={fill}
        fill={`url(#${gradientId})`}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.5 }}
      />

      <motion.path
        d={line}
        fill="none"
        stroke={colour}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Non-scaling so the stroke stays 1.5px however wide the card is —
        // without it, stretching a 100-unit viewBox to 300px would give a
        // horizontally squashed line three times too thin.
        vectorEffect="non-scaling-stroke"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  )
}

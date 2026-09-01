import wordmark from '@/assets/wordmark.png'

/**
 * The brand wordmark, as supplied.
 *
 * Given a height rather than a width, because every place it appears is a row
 * of things that have to share a baseline — a title bar, a lockup above a
 * heading — and height is the dimension those rows are built from. The aspect
 * comes from the source file so no caller has to know it, and the intrinsic
 * `width`/`height` are set so nothing reflows as the image decodes.
 *
 * The artwork is off-white with the full stop in accent orange, so it wants a
 * dark ground and no colour of its own. It cannot be recoloured — anywhere it
 * needs to be quieter, lower its opacity rather than reaching for a token.
 */
const ASPECT = 2730 / 600

export function Wordmark({
  height = 24,
  className
}: {
  height?: number
  className?: string
}): React.JSX.Element {
  return (
    <img
      src={wordmark}
      alt="SoloWork"
      width={Math.round(height * ASPECT)}
      height={height}
      draggable={false}
      className={className}
    />
  )
}

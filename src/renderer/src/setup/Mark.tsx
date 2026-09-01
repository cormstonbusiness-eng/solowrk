/**
 * The SoloWrk mark: a folder, open, drawn in one stroke.
 *
 * The same geometry as the installer icon and the website favicon, so the
 * thing somebody double-clicked and the thing that greets them are visibly
 * one object. Stroked rather than filled, and `currentColor` rather than a
 * hex, so it inherits whatever it is placed on.
 *
 * `strokeWidth` stays fixed at the 32-unit scale rather than scaling with
 * `size`, which is what keeps a 56px mark from looking like a thickened
 * 16px one.
 */
export function Mark({
  size = 32,
  className
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M7 11.5a2.5 2.5 0 0 1 2.5-2.5h3.9l1.8 2.2h7.3A2.5 2.5 0 0 1 25 13.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 7 21.5z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

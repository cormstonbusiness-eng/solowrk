/**
 * Seasonal artwork, as inline SVG.
 *
 * Vectors rather than images, for the same reason the rest of the chrome is:
 * they scale to any window, they take their colour from the theme through
 * `currentColor`, and they add nothing to the installer. Every one of these is
 * decorative, so they are all `aria-hidden` — a screen reader announcing
 * "ghost, ghost, pumpkin" over someone's invoice list would be a bug.
 */

type SpriteProps = { className?: string; style?: React.CSSProperties }

export function Ghost({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 32 40" className={className} style={style} aria-hidden fill="currentColor">
      <path d="M16 1C8.8 1 3 6.8 3 14v23.2c0 1.3 1.5 2 2.5 1.2l3.2-2.6a2 2 0 0 1 2.5 0l2.5 2a2 2 0 0 0 2.5 0l2.5-2a2 2 0 0 1 2.5 0l3.2 2.6c1 .8 2.6.1 2.6-1.2V14C29 6.8 23.2 1 16 1Z" />
      <circle cx="11" cy="15" r="2.4" fill="#0b0714" />
      <circle cx="21" cy="15" r="2.4" fill="#0b0714" />
      <ellipse cx="16" cy="22" rx="2.6" ry="3.4" fill="#0b0714" />
    </svg>
  )
}

export function Pumpkin({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 44 38" className={className} style={style} aria-hidden>
      <g fill="currentColor">
        <ellipse cx="22" cy="24" rx="20" ry="14" />
        <ellipse cx="10" cy="24" rx="8" ry="14" opacity="0.55" />
        <ellipse cx="34" cy="24" rx="8" ry="14" opacity="0.55" />
      </g>
      <path d="M22 10c0-4 2-7 5-8-1 3-1 6 0 8Z" fill="#4a7c2f" />
      {/* The face is punched out in the ground colour, so a lit pumpkin reads
          as carved rather than as a sticker. */}
      <g fill="#0c0910">
        <path d="M14 20l4 5h-8Z" />
        <path d="M30 20l4 5h-8Z" />
        <path d="M12 29c3 3 17 3 20 0-1.6 4-18.4 4-20 0Z" />
      </g>
    </svg>
  )
}

export function Cobweb({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 80 80"
      className={className}
      style={style}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M0 0 L0 80 M0 0 L80 0 M0 0 L56 56 M0 0 L26 74 M0 0 L74 26" />
      <path d="M18 0a18 18 0 0 1-18 18 M34 0a34 34 0 0 1-34 34 M52 0a52 52 0 0 1-52 52 M70 0a70 70 0 0 1-70 70" />
    </svg>
  )
}

export function Bat({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 40 16" className={className} style={style} aria-hidden fill="currentColor">
      <path d="M20 4c1.6 0 2.6 1.2 3 2.4C24.6 3.6 27.6 1 31 1c-1.4 2-1 4.2-.4 5.6C32.4 5.2 35 4.4 39 4.6c-3 1.4-4.6 3.6-5.6 5.8-1 2.2-3 3.6-5.4 3.6-2.8 0-4.6-1.6-8-1.6s-5.2 1.6-8 1.6c-2.4 0-4.4-1.4-5.4-3.6C5.6 8.2 4 6 1 4.6c4-.2 6.6.6 8.4 2C10 5.2 10.4 3 9 1c3.4 0 6.4 2.6 8 5.4C17.4 5.2 18.4 4 20 4Z" />
    </svg>
  )
}

export function Snowflake({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      style={style}
      aria-hidden
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    >
      <path d="M8 1v14M2 4.5l12 7M14 4.5l-12 7" />
      <path d="M5.5 2.6 8 4l2.5-1.4M5.5 13.4 8 12l2.5 1.4" />
    </svg>
  )
}

export function FairyLights({ className, style }: SpriteProps): React.JSX.Element {
  // One repeating span, tiled across the window by CSS so it fits any width.
  return (
    <svg viewBox="0 0 240 28" className={className} style={style} aria-hidden preserveAspectRatio="none">
      <path
        d="M0 2 Q30 22 60 4 Q90 22 120 4 Q150 22 180 4 Q210 22 240 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.5"
      />
      {[
        [30, 15, '#e8b757'],
        [60, 6, '#e23b3b'],
        [90, 15, '#2fa35b'],
        [120, 6, '#e8b757'],
        [150, 15, '#e23b3b'],
        [180, 6, '#2fa35b'],
        [210, 15, '#e8b757']
      ].map(([x, y, colour], index) => (
        <circle
          key={index}
          cx={x as number}
          cy={y as number}
          r="3"
          fill={colour as string}
          className="seasonal-bulb"
          style={{ animationDelay: `${index * 0.35}s` }}
        />
      ))}
    </svg>
  )
}

export function Confetti({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 8 12" className={className} style={style} aria-hidden fill="currentColor">
      <rect width="8" height="12" rx="1.5" />
    </svg>
  )
}

export function Sparkle({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className={className} style={style} aria-hidden fill="currentColor">
      <path d="M8 0c.6 4.4 3 6.8 8 8-5 1.2-7.4 3.6-8 8-.6-4.4-3-6.8-8-8 5-1.2 7.4-3.6 8-8Z" />
    </svg>
  )
}

export function Petal({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 10" className={className} style={style} aria-hidden fill="currentColor">
      <path d="M1 5C1 1.5 4.5 0 7 0s6 1.5 6 5-3.5 5-6 5-6-1.5-6-5Z" />
    </svg>
  )
}

export function Seed({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" className={className} style={style} aria-hidden>
      <g stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.85">
        <path d="M7 7 1 3M7 7 3 1M7 7l4-6M7 7l6 4M7 7 3 13M7 7l6-2" />
      </g>
      <circle cx="7" cy="7" r="1.2" fill="currentColor" />
    </svg>
  )
}

export function Sun({ className, style }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 200 200" className={className} style={style} aria-hidden>
      <defs>
        <radialGradient id="solowrk-sun">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="100" fill="url(#solowrk-sun)" />
    </svg>
  )
}

/* Characters for empty states — bigger, friendlier, and drawn to sit alone. */

export function GhostFriendly({ className }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 40 44" className={className} aria-hidden fill="currentColor">
      <path d="M20 2C11.7 2 5 8.7 5 17v22.5c0 1.4 1.6 2.1 2.6 1.2l3.4-3a2 2 0 0 1 2.7 0l2.6 2.3a2 2 0 0 0 2.6 0l2.4-2.1a2 2 0 0 1 2.6 0l2.5 2.2a2 2 0 0 0 2.6 0l3.4-3c1-.9 2.6-.2 2.6 1.2V17C35 8.7 28.3 2 20 2Z" />
      <circle cx="14" cy="18" r="2.6" fill="#0b0714" />
      <circle cx="26" cy="18" r="2.6" fill="#0b0714" />
      <path d="M16 26c1.4 1.6 6.6 1.6 8 0" stroke="#0b0714" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function Snowman({ className }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 40 46" className={className} aria-hidden>
      <g fill="currentColor">
        <circle cx="20" cy="34" r="11" />
        <circle cx="20" cy="18" r="8" />
      </g>
      <g fill="#0a1210">
        <circle cx="17" cy="16" r="1.3" />
        <circle cx="23" cy="16" r="1.3" />
        <circle cx="20" cy="29" r="1.2" />
        <circle cx="20" cy="34" r="1.2" />
      </g>
      <path d="M20 19l6 1.5-6 1.5Z" fill="#d2691e" />
      <path d="M12 10h16v3H12zM15 3h10v7H15z" fill="#2f3d5c" />
    </svg>
  )
}

export function Chick({ className }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 40 42" className={className} aria-hidden>
      <g fill="currentColor">
        <ellipse cx="20" cy="26" rx="13" ry="12" />
        <circle cx="20" cy="13" r="9" />
      </g>
      <g fill="#18251a">
        <circle cx="16.5" cy="12" r="1.4" />
        <circle cx="23.5" cy="12" r="1.4" />
      </g>
      <path d="M20 15l4 2-4 2Z" fill="#e8a020" />
      <path d="M14 38h4M22 38h4" stroke="#e8a020" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function Firework({ className }: SpriteProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M20 20V4M20 20v16M20 20H4M20 20h16M20 20 8.7 8.7M20 20l11.3 11.3M20 20 31.3 8.7M20 20 8.7 31.3" />
      <circle cx="20" cy="20" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
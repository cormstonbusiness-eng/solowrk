import { useMemo } from 'react'
import { decorFor, themeById, type DecorKind } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import {
  Bat,
  Cobweb,
  Confetti,
  FairyLights,
  Ghost,
  Petal,
  Pumpkin,
  Seed,
  Snowflake,
  Sparkle,
  Sun
} from './sprites'

/**
 * The ambient decoration behind the app.
 *
 * One rule governs everything here: it sits behind the content, it is never
 * clickable, and it never covers what someone is reading. This is the screen
 * people do their invoicing on — a ghost drifting over a column of figures
 * would be a bug, not a feature.
 *
 * Positions and timings are randomised once and memoised. Re-rolling them on
 * every render would make the whole layer twitch each time a query settled.
 */

/** A deterministic shuffle, so a given theme always lays out the same way. */
function seeded(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

interface Piece {
  key: string
  style: React.CSSProperties
  className: string
  kind: string
}

function build(kind: DecorKind, counts: Record<string, number>): Piece[] {
  // Seeded on the decoration set, so the same theme always looks the same and
  // switching back and forth does not reshuffle the room.
  const random = seeded(kind.length * 7919)
  const pieces: Piece[] = []

  const take = (howMany: number, make: (index: number) => Piece): void => {
    for (let index = 0; index < howMany; index++) pieces.push(make(index))
  }

  const between = (min: number, max: number): number => min + random() * (max - min)

  take(counts.ghost ?? 0, (index) => ({
    key: `ghost-${index}`,
    kind: 'ghost',
    className: 'seasonal-ghost',
    style: {
      left: `${between(4, 92)}%`,
      width: `${between(22, 40)}px`,
      animationDuration: `${between(26, 44)}s`,
      animationDelay: `-${between(0, 30)}s`,
      ['--peak' as string]: String(between(0.07, 0.14))
    }
  }))

  take(counts.pumpkin ?? 0, (index) => ({
    key: `pumpkin-${index}`,
    kind: 'pumpkin',
    className: 'seasonal-pumpkin',
    style: {
      left: `${between(3, 90)}%`,
      width: `${between(34, 58)}px`,
      animationDuration: `${between(4, 9)}s`,
      animationDelay: `-${between(0, 5)}s`,
      ['--peak' as string]: String(between(0.24, 0.4))
    }
  }))

  take(counts.cobweb ?? 0, (index) => ({
    key: `cobweb-${index}`,
    kind: 'cobweb',
    className: 'seasonal-cobweb',
    style: { width: '110px', opacity: 0.13 }
  }))

  take(counts.bat ?? 0, (index) => ({
    key: `bat-${index}`,
    kind: 'bat',
    className: 'seasonal-bat',
    style: {
      top: `${between(8, 45)}%`,
      width: `${between(20, 34)}px`,
      animationDuration: `${between(14, 26)}s`,
      animationDelay: `-${between(0, 20)}s`,
      ['--peak' as string]: String(between(0.14, 0.24))
    }
  }))

  take(counts.snowflake ?? 0, (index) => ({
    key: `snow-${index}`,
    kind: 'snowflake',
    className: 'seasonal-fall seasonal-snowflake',
    style: {
      left: `${between(0, 98)}%`,
      width: `${between(7, 16)}px`,
      animationDuration: `${between(14, 30)}s`,
      animationDelay: `-${between(0, 25)}s`,
      ['--drift' as string]: `${between(-5, 6)}rem`,
      ['--spin' as string]: `${between(120, 400)}deg`,
      ['--peak' as string]: String(between(0.35, 0.7))
    }
  }))

  take(counts.lights ?? 0, (index) => ({
    key: `lights-${index}`,
    kind: 'lights',
    className: 'seasonal-lights',
    style: {}
  }))

  take(counts.drift ?? 0, (index) => ({
    key: `drift-${index}`,
    kind: 'drift',
    className: 'seasonal-drift',
    style: {}
  }))

  const CONFETTI_COLOURS = ['#e3c078', '#f2566b', '#6ba3f5', '#3fb185', '#eef2fb']
  take(counts.confetti ?? 0, (index) => ({
    key: `confetti-${index}`,
    kind: 'confetti',
    className: 'seasonal-fall seasonal-confetti',
    style: {
      left: `${between(0, 98)}%`,
      width: `${between(5, 9)}px`,
      color: CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
      animationDuration: `${between(9, 20)}s`,
      animationDelay: `-${between(0, 18)}s`,
      ['--drift' as string]: `${between(-7, 8)}rem`,
      ['--spin' as string]: `${between(220, 720)}deg`,
      ['--peak' as string]: String(between(0.4, 0.75))
    }
  }))

  take(counts.sparkle ?? 0, (index) => ({
    key: `sparkle-${index}`,
    kind: 'sparkle',
    className: 'seasonal-sparkle',
    style: {
      left: `${between(5, 92)}%`,
      top: `${between(8, 80)}%`,
      width: `${between(10, 20)}px`,
      animationDuration: `${between(3.5, 7)}s`,
      animationDelay: `-${between(0, 6)}s`,
      ['--peak' as string]: String(between(0.3, 0.6))
    }
  }))

  take(counts.petal ?? 0, (index) => ({
    key: `petal-${index}`,
    kind: 'petal',
    className: 'seasonal-fall seasonal-petal',
    style: {
      left: `${between(0, 98)}%`,
      width: `${between(9, 16)}px`,
      animationDuration: `${between(13, 26)}s`,
      animationDelay: `-${between(0, 22)}s`,
      ['--drift' as string]: `${between(-8, 9)}rem`,
      ['--spin' as string]: `${between(180, 540)}deg`,
      ['--peak' as string]: String(between(0.35, 0.6))
    }
  }))

  take(counts.sun ?? 0, (index) => ({
    key: `sun-${index}`,
    kind: 'sun',
    className: 'seasonal-sun',
    style: { ['--peak' as string]: '0.5' }
  }))

  take(counts.seed ?? 0, (index) => ({
    key: `seed-${index}`,
    kind: 'seed',
    className: 'seasonal-seed',
    style: {
      top: `${between(20, 85)}%`,
      width: `${between(10, 18)}px`,
      animationDuration: `${between(28, 52)}s`,
      animationDelay: `-${between(0, 40)}s`,
      ['--peak' as string]: String(between(0.2, 0.4))
    }
  }))

  return pieces
}

const SPRITES: Record<string, (props: { className?: string; style?: React.CSSProperties }) => React.JSX.Element> = {
  ghost: Ghost,
  pumpkin: Pumpkin,
  cobweb: Cobweb,
  bat: Bat,
  snowflake: Snowflake,
  lights: FairyLights,
  confetti: Confetti,
  sparkle: Sparkle,
  petal: Petal,
  sun: Sun,
  seed: Seed
}

export function SeasonalLayer(): React.JSX.Element | null {
  const { themeId, decorIntensity } = useTheme()
  const decor = decorFor(themeById(themeId), decorIntensity)

  const pieces = useMemo(
    () => (decor ? build(decor.kind, decor.counts) : []),
    // The counts object is derived from these two, so they are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decor?.kind, decorIntensity]
  )

  // Nothing rendered at all when it is off, rather than an invisible layer:
  // "off" should mean the DOM is clean.
  if (!decor) return null

  return (
    <div className="seasonal-layer" aria-hidden>
      {pieces.map((piece) => {
        // The snow drift is a gradient rather than a sprite, so it is checked
        // before the lookup that would otherwise reject it.
        if (piece.kind === 'drift') {
          return <div key={piece.key} className={piece.className} style={piece.style} />
        }

        const Sprite = SPRITES[piece.kind]
        if (!Sprite) return null

        return (
          <span
            key={piece.key}
            className={piece.className}
            style={piece.style}
            data-side={piece.kind === 'cobweb' && piece.key.endsWith('-1') ? 'right' : undefined}
          >
            <Sprite />
          </span>
        )
      })}
    </div>
  )
}
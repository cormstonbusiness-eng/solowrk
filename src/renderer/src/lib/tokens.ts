import { useEffect, useState } from 'react'
import { useTheme } from '@/hooks/useTheme'

/**
 * The design tokens, as concrete colour strings.
 *
 * Everything in the app that can take a CSS variable should take one. This is
 * for the handful of places that cannot: Recharts wants a real colour for a
 * stroke, an SVG gradient stop wants a hex, and `canvas` wants neither a
 * variable nor a `color-mix`.
 *
 * Read from the document at runtime rather than imported from `@shared/themes`
 * so it reflects whatever is actually applied — including the derived
 * `color-mix` values, which only the browser can resolve. Re-read when the
 * theme changes, which is the one time these can move.
 */
const NAMES = [
  'ground',
  'ground-end',
  'sidebar',
  'surface',
  'surface-hover',
  'raised',
  'overlay',
  'hover',
  'line',
  'line-strong',
  'line-top',
  'ink',
  'muted',
  'faint',
  'disabled',
  'accent',
  'accent-hover',
  'accent-press',
  'accent-ink',
  'accent-subtle',
  'success',
  'warning',
  'danger',
  'info'
] as const

export type TokenName = (typeof NAMES)[number]

export type Tokens = Record<TokenName, string>

function read(): Tokens {
  const styles = getComputedStyle(document.documentElement)
  return Object.fromEntries(
    NAMES.map((name) => [name, styles.getPropertyValue(`--color-${name}`).trim()])
  ) as Tokens
}

export function useTokens(): Tokens {
  const { themeId } = useTheme()
  const [tokens, setTokens] = useState<Tokens>(read)

  useEffect(() => {
    // The theme writes its variables in an effect of its own. Reading on the
    // next frame rather than immediately means this never races it and comes
    // back with the outgoing theme's palette.
    const frame = requestAnimationFrame(() => setTokens(read()))
    return () => cancelAnimationFrame(frame)
  }, [themeId])

  return tokens
}

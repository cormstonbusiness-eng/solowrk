import { createContext, useContext, useEffect, useState } from 'react'
import {
  DEFAULT_DECOR_INTENSITY,
  DEFAULT_THEME_ID,
  themeById,
  themeVariables,
  type DecorIntensity
} from '@shared/themes'

/**
 * Applies the chosen theme's tokens to the document root.
 *
 * The whole app is built on those tokens, so this is all a theme has to do —
 * no component knows a theme exists, and none of them need to.
 *
 * Both the theme and how much decoration to draw are kept in `app_state`, which
 * belongs to the workspace: they are preferences about how you like to work, and
 * they travel with the workspace to a new machine along with everything else.
 */
const THEME_KEY = 'theme'
const DECOR_KEY = 'theme.decor'

const INTENSITIES: DecorIntensity[] = ['off', 'subtle', 'festive']

export interface ThemeContextValue {
  themeId: string
  setThemeId: (id: string) => void
  decorIntensity: DecorIntensity
  setDecorIntensity: (intensity: DecorIntensity) => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {},
  decorIntensity: DEFAULT_DECOR_INTENSITY,
  setDecorIntensity: () => {}
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/** Reads the stored preferences, applies them, and returns setters that persist. */
export function useThemeState(ready: boolean): ThemeContextValue {
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID)
  const [decorIntensity, setDecorIntensity] = useState<DecorIntensity>(DEFAULT_DECOR_INTENSITY)

  useEffect(() => {
    if (!ready) return

    void window.solo
      .invoke('state:get', { key: THEME_KEY })
      .then((stored) => stored && setThemeId(stored))
      .catch(() => {
        // No workspace yet, or a corrupt value. The default is a fine answer.
      })

    void window.solo
      .invoke('state:get', { key: DECOR_KEY })
      .then((stored) => {
        // Validated rather than trusted: a stale value from a future version
        // would otherwise reach the count table and read as undefined.
        if (stored && INTENSITIES.includes(stored as DecorIntensity)) {
          setDecorIntensity(stored as DecorIntensity)
        }
      })
      .catch(() => {})
  }, [ready])

  useEffect(() => {
    const theme = themeById(themeId)
    const root = document.documentElement

    for (const [name, value] of Object.entries(themeVariables(theme))) {
      root.style.setProperty(name, value)
    }

    // Lets the odd thing that cannot be expressed as a token — scrollbars, the
    // native date picker — react to the theme being light.
    root.dataset.theme = theme.id
    root.style.colorScheme = theme.light ? 'light' : 'dark'
  }, [themeId])

  return {
    themeId,
    setThemeId: (id) => {
      setThemeId(id)
      // Fire and forget: the theme is already applied, and failing to record a
      // preference should not interrupt anything.
      void window.solo.invoke('state:set', { key: THEME_KEY, value: id }).catch(() => {})
    },
    decorIntensity,
    setDecorIntensity: (intensity) => {
      setDecorIntensity(intensity)
      void window.solo.invoke('state:set', { key: DECOR_KEY, value: intensity }).catch(() => {})
    }
  }
}
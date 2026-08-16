import { createContext, useContext, useEffect, useState } from 'react'
import { DEFAULT_THEME_ID, themeById, themeVariables } from '@shared/themes'

/**
 * Applies the chosen theme's tokens to the document root.
 *
 * The whole app is built on those tokens, so this is all a theme has to do —
 * no component knows a theme exists, and none of them need to.
 *
 * The choice is kept in `app_state`, which belongs to the workspace: it is a
 * preference about how you like to work, and it travels with the workspace to
 * a new machine along with everything else.
 */
const STATE_KEY = 'theme'

export interface ThemeContextValue {
  themeId: string
  setThemeId: (id: string) => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {}
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/** Reads the stored theme, applies it, and hands back a setter that persists. */
export function useThemeState(ready: boolean): ThemeContextValue {
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID)

  useEffect(() => {
    if (!ready) return
    void window.solo
      .invoke('state:get', { key: STATE_KEY })
      .then((stored) => stored && setThemeId(stored))
      .catch(() => {
        // No workspace yet, or a corrupt value. The default is a fine answer.
      })
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
      void window.solo.invoke('state:set', { key: STATE_KEY, value: id }).catch(() => {})
    }
  }
}

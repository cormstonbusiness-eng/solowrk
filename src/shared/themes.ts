/**
 * Theme templates.
 *
 * The app was built on tokens rather than hard-coded colours, so a theme is
 * nothing more than a different set of values for those tokens — no component
 * knows a theme exists. That is the whole reason this is a small file instead
 * of a rewrite.
 *
 * A theme must define every token it changes. Partial themes that inherit half
 * their palette from the default produce combinations nobody looked at, which
 * is how you end up with grey text on a grey card.
 */

export interface ThemeTokens {
  ground: string
  surface: string
  raised: string
  overlay: string
  hover: string
  line: string
  lineStrong: string
  ink: string
  muted: string
  faint: string
  accent: string
  accentHover: string
  accentPress: string
  accentInk: string
  success: string
  warning: string
  danger: string
  info: string
}

export interface Theme {
  id: string
  name: string
  description: string
  /** Light themes need a different scrollbar and image treatment. */
  light: boolean
  /** CSS font stack for the UI. */
  fontSans: string
  /** Monospace stack, used for figures so columns align. */
  fontMono: string
  /** Corner radius on cards, in pixels. Controls take 2px less. */
  radius: number
  tokens: ThemeTokens
}

/** Fonts are system stacks: bundling more webfonts would bloat the installer. */
const INTER = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace"
const GEOMETRIC = "'Segoe UI Variable Display', 'Segoe UI', 'Inter', system-ui, sans-serif"
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif"

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'The original. Near-black, one violet accent, quiet everywhere else.',
    light: false,
    fontSans: INTER,
    fontMono: MONO,
    radius: 10,
    tokens: {
      ground: '#0a0a0b',
      surface: '#141416',
      raised: '#1c1c1f',
      overlay: '#232327',
      hover: '#2a2a2f',
      line: '#26262a',
      lineStrong: '#35353b',
      ink: '#ededef',
      muted: '#8a8a93',
      faint: '#5a5a63',
      accent: '#6e56cf',
      accentHover: '#7c66dd',
      accentPress: '#5d47b8',
      accentInk: '#ffffff',
      success: '#30a46c',
      warning: '#f5a623',
      danger: '#e5484d',
      info: '#3b82f6'
    }
  },

  {
    id: 'daylight',
    name: 'Daylight',
    description: 'Clean and bright, for working in a sunlit room.',
    light: true,
    fontSans: INTER,
    fontMono: MONO,
    radius: 10,
    tokens: {
      ground: '#f7f7f8',
      surface: '#ffffff',
      raised: '#f1f1f3',
      overlay: '#ffffff',
      hover: '#e8e8ec',
      line: '#e2e2e6',
      lineStrong: '#c9c9d0',
      ink: '#1a1a1f',
      muted: '#61616b',
      faint: '#8e8e99',
      accent: '#5b46b8',
      accentHover: '#4c3aa0',
      accentPress: '#3f2f88',
      accentInk: '#ffffff',
      success: '#1a7f4b',
      warning: '#a86400',
      danger: '#c62a2f',
      info: '#1d5fd0'
    }
  },

  {
    id: 'citrus',
    name: 'Citrus',
    description: 'Warm and high-contrast, with an orange accent. Bright without being loud.',
    light: true,
    fontSans: GEOMETRIC,
    fontMono: MONO,
    radius: 14,
    tokens: {
      ground: '#fdf8f3',
      surface: '#ffffff',
      raised: '#f8efe5',
      overlay: '#ffffff',
      hover: '#f0e2d3',
      line: '#efe3d6',
      lineStrong: '#d8c3ab',
      ink: '#221a12',
      muted: '#6b5847',
      faint: '#9a8571',
      accent: '#d2691e',
      accentHover: '#b95a17',
      accentPress: '#9c4b12',
      accentInk: '#ffffff',
      success: '#2f7d32',
      warning: '#b45309',
      danger: '#c0392b',
      info: '#1f6feb'
    }
  },

  {
    id: 'sherbet',
    name: 'Sherbet',
    description: 'Soft pastels and rounded corners. The most colourful of the set.',
    light: true,
    fontSans: GEOMETRIC,
    fontMono: MONO,
    radius: 16,
    tokens: {
      ground: '#fbf7ff',
      surface: '#ffffff',
      raised: '#f3ecfd',
      overlay: '#ffffff',
      hover: '#e9dcfb',
      line: '#eadff8',
      lineStrong: '#cdb8ec',
      ink: '#211a2e',
      muted: '#655a7a',
      faint: '#9b90ad',
      accent: '#c2418f',
      accentHover: '#ab377e',
      accentPress: '#8f2c69',
      accentInk: '#ffffff',
      success: '#1f8a5f',
      warning: '#b8730b',
      danger: '#cf3350',
      info: '#4763d8'
    }
  },

  {
    id: 'forest',
    name: 'Forest',
    description: 'Dark green and warm off-white. Easier on the eyes late at night.',
    light: false,
    fontSans: INTER,
    fontMono: MONO,
    radius: 10,
    tokens: {
      ground: '#0b120e',
      surface: '#121b16',
      raised: '#18241d',
      overlay: '#1f2e25',
      hover: '#26382c',
      line: '#22322a',
      lineStrong: '#33493c',
      ink: '#e8f0ea',
      muted: '#8ba193',
      faint: '#5d7166',
      accent: '#4fae7f',
      accentHover: '#5cc38f',
      accentPress: '#3f9269',
      accentInk: '#07130c',
      success: '#4fae7f',
      warning: '#e0a63c',
      danger: '#e06666',
      info: '#5aa7d8'
    }
  },

  {
    id: 'paper',
    name: 'Paper',
    description: 'A serif face on warm paper. Reads like a notebook rather than an app.',
    light: true,
    fontSans: SERIF,
    fontMono: MONO,
    radius: 6,
    tokens: {
      ground: '#f4f1ea',
      surface: '#fbf9f4',
      raised: '#eeeade',
      overlay: '#fbf9f4',
      hover: '#e4dfd0',
      line: '#e0dacb',
      lineStrong: '#c2b8a2',
      ink: '#23201a',
      muted: '#5f584c',
      faint: '#8d8478',
      accent: '#8a5a2b',
      accentHover: '#754a22',
      accentPress: '#5f3c1b',
      accentInk: '#fbf9f4',
      success: '#3f7141',
      warning: '#9a6516',
      danger: '#a63d34',
      info: '#39628f'
    }
  }
]

export const DEFAULT_THEME_ID = 'midnight'

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!
}

/**
 * The theme as CSS custom properties.
 *
 * Applied to the document root at runtime, which overrides the `@theme` block's
 * defaults without a rebuild — Tailwind v4 compiles its utilities against those
 * variables, so every existing class follows along.
 */
export function themeVariables(theme: Theme): Record<string, string> {
  const { tokens } = theme

  return {
    '--color-ground': tokens.ground,
    '--color-surface': tokens.surface,
    '--color-raised': tokens.raised,
    '--color-overlay': tokens.overlay,
    '--color-hover': tokens.hover,
    '--color-line': tokens.line,
    '--color-line-strong': tokens.lineStrong,
    '--color-ink': tokens.ink,
    '--color-muted': tokens.muted,
    '--color-faint': tokens.faint,
    '--color-accent': tokens.accent,
    '--color-accent-hover': tokens.accentHover,
    '--color-accent-press': tokens.accentPress,
    '--color-accent-ink': tokens.accentInk,
    '--color-success': tokens.success,
    '--color-warning': tokens.warning,
    '--color-danger': tokens.danger,
    '--color-info': tokens.info,
    '--font-sans': theme.fontSans,
    '--font-mono': theme.fontMono,
    // Controls sit 2px tighter than cards, and panels 4px looser, so the whole
    // scale moves together rather than each radius being set by hand.
    '--radius-control': `${Math.max(2, theme.radius - 2)}px`,
    '--radius-card': `${theme.radius}px`,
    '--radius-panel': `${theme.radius + 4}px`
  }
}

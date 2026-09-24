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

  /**
   * The four below are optional, which is a deliberate exception to the rule
   * above rather than a hole in it.
   *
   * A partial theme is dangerous when the missing half comes from *another*
   * theme — that is how you get grey text on a grey card. These fall back to
   * values mixed from the theme's own ground, surface and faint, so an
   * unspecified one always lands inside that theme's palette and in the right
   * direction. Midnight states them exactly; the rest take the mix and stay
   * coherent without twelve hand-tuned edits.
   */

  /** Bottom of the window gradient. A shade above `ground`. */
  groundEnd?: string
  /** The sidebar, which sits a touch above the page behind it. */
  sidebar?: string
  /** Card fill on hover. Distinct from `hover`, which is for controls. */
  surfaceHover?: string
  /** Genuinely disabled — never text that is still meant to be read. */
  disabled?: string

  /**
   * The outer shell of a nested card, behind the white inner panel.
   *
   * The editorial layout puts a #F4F4F4 tray around a #FFFFFF panel, so the
   * card reads as two layers without a shadow. Every other theme falls back
   * to `raised`, which is the nearest thing it already had and keeps them
   * looking exactly as they did.
   */
  shell?: string

  /** The quieter of two chart series. Falls back to a muted mix. */
  chartSecondary?: string

  /**
   * The sidebar's own ramp.
   *
   * **This is the one place the app carries two palettes at once.** Every
   * other surface takes its text from `ink`/`muted`/`faint`, which works
   * while the sidebar is a shade of the page behind it. The editorial theme
   * breaks that: a charcoal sidebar framing a near-white content area needs
   * light text on the left and near-black text on the right, and one ramp
   * cannot be both.
   *
   * All optional, and all falling back to the content ramp — so the eleven
   * themes that existed before this are unchanged, and a theme that wants a
   * sidebar matching its page simply says nothing.
   */
  sidebarRaised?: string
  sidebarActive?: string
  sidebarActiveBorder?: string
  sidebarLine?: string
  sidebarInk?: string
  sidebarMuted?: string
  sidebarSection?: string
}

/** Which decoration set a theme brings with it, if any. */
export type DecorKind = 'halloween' | 'christmas' | 'newyear' | 'spring' | 'summer'

/**
 * How much decoration to draw.
 *
 * `off` is a real off — the layer is not rendered at all, so someone can keep a
 * seasonal palette without a single ghost.
 */
export type DecorIntensity = 'off' | 'subtle' | 'festive'

export const DECOR_INTENSITIES: { value: DecorIntensity; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Palette only' },
  { value: 'subtle', label: 'Subtle', hint: 'A few, quietly' },
  { value: 'festive', label: 'Festive', hint: 'The works' }
]

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
  /** Set on seasonal themes: the window of the year they belong to. */
  season?: { from: string; to: string }
  /** Decoration drawn behind the app while this theme is on. */
  decor?: DecorKind
  tokens: ThemeTokens
}

/**
 * Whether a seasonal theme is in its window, as `mm-dd` strings.
 *
 * Handles a window that wraps the new year, which Christmas does — without
 * that, a theme running from December to early January would be out of season
 * for the whole of Christmas week.
 */
export function isInSeason(theme: Theme, today: string): boolean {
  if (!theme.season) return false

  const day = today.slice(5)
  const { from, to } = theme.season

  return from <= to ? day >= from && day <= to : day >= from || day <= to
}

/** Fonts are system stacks: bundling more webfonts would bloat the installer. */
const INTER = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace"
const GEOMETRIC = "'Segoe UI Variable Display', 'Segoe UI', 'Inter', system-ui, sans-serif"
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif"

export const THEMES: Theme[] = [
  /**
   * Editorial — the default. Techy minimalist.
   *
   * Light throughout, on a warm off-white rather than a cold grey: #F7F7F5
   * against #FFFFFF cards reads as paper, and the same layout on a blue-grey
   * reads as a spreadsheet. The difference is a couple of points of hue and
   * it is most of the character.
   *
   * Everything is a neutral step. Colour appears solely on status and on a
   * delta that is up or down — which is what makes those two things legible
   * at a glance, and why nothing else is allowed to borrow it.
   *
   * The accent is near-black rather than a hue, which is not a placeholder.
   * The palette carries meaning through weight and border, so a coloured
   * primary button would be both the loudest thing on screen and in direct
   * competition with the only thing colour is permitted to mean.
   *
   * Depth is borders and the white-on-off-white layering, not shadow. A 1px
   * line survives a screenshot, a colourblind reader and a cheap panel; a
   * soft shadow survives none of them reliably. The one exception is the
   * active navigation item, which lifts off the sidebar as a white pill —
   * one raised thing in the whole window, which is why it reads as the
   * place you are.
   */
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'The default. Warm off-white, monospaced figures, and colour only where it means something.',
    light: true,
    fontSans: INTER,
    fontMono: MONO,
    radius: 12,
    tokens: {
      /* Warm off-white, not a cold grey. See the note above. */
      ground: '#f7f7f5',
      groundEnd: '#f7f7f5',
      surface: '#ffffff',
      surfaceHover: '#fcfcfb',
      /* The tray a white panel sits in — a KPI card's outer shell. */
      shell: '#f2f2ef',
      raised: '#f2f2ef',
      overlay: '#ffffff',
      hover: '#efefec',
      line: '#e7e7e3',
      lineStrong: '#d8d8d3',
      ink: '#161614',
      muted: '#6b6b64',
      faint: '#a3a39c',
      disabled: '#c6c6c0',

      /* Near-black, not a hue. See the note above. */
      accent: '#1a1a18',
      accentHover: '#33332f',
      accentPress: '#000000',
      accentInk: '#ffffff',

      /* The only colour in the palette, and only ever for meaning. */
      success: '#16a34a',
      warning: '#f59e0b',
      danger: '#dc2626',
      info: '#9ca3af',

      chartSecondary: '#dcdcd7',

      /*
        The sidebar, light like everything else.

        Stated rather than left to fall back, even though these are close to
        the content ramp, because the two are not the same thing and the
        distinction is the point of the group. The sidebar sits a shade
        lighter than the page so the frame reads as raised, and its active
        item is pure white — the one surface in the window that lifts.
      */
      sidebar: '#fbfbfa',
      sidebarRaised: '#ffffff',
      sidebarActive: '#ffffff',
      sidebarActiveBorder: '#e4e4df',
      sidebarLine: '#e7e7e3',
      sidebarInk: '#161614',
      sidebarMuted: '#6b6b64',
      sidebarSection: '#a3a39c'
    }
  },

  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Near-black, one orange accent, quiet everywhere else.',
    light: false,
    fontSans: INTER,
    fontMono: MONO,
    radius: 12,
    tokens: {
      ground: '#0a0a0c',
      groundEnd: '#101013',
      sidebar: '#0c0c0f',
      surface: '#141417',
      surfaceHover: '#18181c',
      raised: '#1a1a1f',
      overlay: '#1e1e23',
      // Controls sit *on* cards, so their hover has to clear the card's own
      // hover fill or an icon button on a hovered card looks dead. Above
      // surfaceHover, below overlay.
      hover: '#222227',
      line: 'rgba(255,255,255,0.06)',
      lineStrong: 'rgba(255,255,255,0.12)',
      ink: '#f2f2f4',
      // Supporting copy, raised from #8a8a93 — the old value read as disabled.
      muted: '#a8a8b3',
      faint: '#6e6e7a',
      disabled: '#45454e',
      accent: '#ff7a2f',
      accentHover: '#ff8f4d',
      accentPress: '#e86a22',
      // Near-black, not white. White on this orange measures 2.6:1 and fails
      // AA outright; near-black is 7.6:1.
      accentInk: '#0a0a0c',
      success: '#3fb950',
      warning: '#d9a03c',
      danger: '#e5534b',
      info: '#4b8fe5'
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
      accent: '#a8480c',
      accentHover: '#8f3c09',
      accentPress: '#763107',
      accentInk: '#ffffff',
      success: '#2f7d32',
      warning: '#b45309',
      // Cooled towards crimson so it cannot be read as the orange accent.
      danger: '#c2185b',
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
      // Deepened to a crimson: against a brown accent, a rust red was
      // indistinguishable at a glance.
      danger: '#a01b3f',
      info: '#39628f'
    }
  },

  {
    id: 'halloween',
    name: 'Halloween',
    description: 'Pumpkin on near-black, with a purple cast. Seasonal, but genuinely usable.',
    light: false,
    fontSans: INTER,
    fontMono: MONO,
    radius: 10,
    season: { from: '10-01', to: '11-02' },
    decor: 'halloween',
    tokens: {
      ground: '#0c0910',
      surface: '#151020',
      raised: '#1d1629',
      overlay: '#251c34',
      hover: '#2f2440',
      line: '#291f38',
      lineStrong: '#3d2e52',
      ink: '#f2ece2',
      muted: '#9b8ba8',
      faint: '#6b5c7a',
      accent: '#f2761b',
      accentHover: '#ff8a33',
      accentPress: '#d16210',
      accentInk: '#1a0d02',
      success: '#5fbf6a',
      warning: '#ffc53d',
      // Pushed towards crimson so it cannot be mistaken for the orange accent —
      // an overdue invoice and a primary button must never look alike.
      danger: '#ff4d6d',
      info: '#a78bfa'
    }
  },

  {
    id: 'christmas',
    name: 'Christmas',
    description: 'Pine and gold, with the reds and greens doing the work they already do.',
    light: false,
    fontSans: GEOMETRIC,
    fontMono: MONO,
    radius: 12,
    season: { from: '12-01', to: '01-06' },
    decor: 'christmas',
    tokens: {
      ground: '#0a1210',
      surface: '#101b17',
      raised: '#16241f',
      overlay: '#1d2e28',
      hover: '#25392f',
      line: '#1f322a',
      lineStrong: '#2f4a3d',
      ink: '#f4f1e8',
      muted: '#93a89b',
      faint: '#63786c',
      // Gold, so the accent sits apart from both the holly green of "paid" and
      // the red of "overdue" — the two colours this theme is otherwise made of.
      accent: '#d9a441',
      accentHover: '#e8b757',
      accentPress: '#b8862f',
      accentInk: '#14100a',
      success: '#2fa35b',
      warning: '#e8b04b',
      danger: '#e23b3b',
      info: '#5aa7d8'
    }
  },

  {
    id: 'newyear',
    name: 'New Year',
    description: 'Midnight blue and champagne gold, with confetti still coming down.',
    light: false,
    fontSans: GEOMETRIC,
    fontMono: MONO,
    radius: 12,
    season: { from: '12-31', to: '01-02' },
    decor: 'newyear',
    tokens: {
      ground: '#080c16',
      surface: '#0f1524',
      raised: '#161e30',
      overlay: '#1d273c',
      hover: '#26314a',
      line: '#1e2840',
      lineStrong: '#2f3d5c',
      ink: '#eef2fb',
      muted: '#93a0bd',
      faint: '#64708c',
      accent: '#e3c078',
      accentHover: '#f0cf8c',
      accentPress: '#c5a45e',
      accentInk: '#120e05',
      success: '#3fb185',
      warning: '#e8b04b',
      danger: '#f2566b',
      info: '#6ba3f5'
    }
  },

  {
    id: 'spring',
    name: 'Spring',
    description: 'Fresh greens and pale blossom, with petals coming off the tree.',
    light: true,
    fontSans: GEOMETRIC,
    fontMono: MONO,
    radius: 14,
    season: { from: '03-20', to: '04-30' },
    decor: 'spring',
    tokens: {
      ground: '#f6faf4',
      surface: '#ffffff',
      raised: '#ecf5e9',
      overlay: '#ffffff',
      hover: '#dfeeda',
      line: '#e2efdd',
      lineStrong: '#bcd8b3',
      ink: '#18251a',
      muted: '#556b57',
      faint: '#87a189',
      accent: '#3f7d44',
      accentHover: '#356b3a',
      accentPress: '#2b5830',
      accentInk: '#ffffff',
      success: '#2f8f57',
      warning: '#a8720c',
      // Blossom pink would vanish against the greens, so danger stays a firm
      // red — it is the one colour that must never be pretty at the cost of
      // being noticed.
      danger: '#c2334b',
      info: '#2f6cc4'
    }
  },

  {
    id: 'summer',
    name: 'Summer',
    description: 'Bright and warm, with a low sun in the corner. For the months with no holiday.',
    light: true,
    fontSans: GEOMETRIC,
    fontMono: MONO,
    radius: 14,
    season: { from: '06-01', to: '08-31' },
    decor: 'summer',
    tokens: {
      ground: '#fffaf0',
      surface: '#ffffff',
      raised: '#fdf1dc',
      overlay: '#ffffff',
      hover: '#f7e5c8',
      line: '#f6e8d2',
      lineStrong: '#dcc49b',
      ink: '#1f1a10',
      muted: '#6a5c44',
      faint: '#9c8b6e',
      accent: '#0d7a8f',
      accentHover: '#0a677a',
      accentPress: '#085463',
      accentInk: '#ffffff',
      success: '#2f7d51',
      warning: '#a86a08',
      danger: '#c4304a',
      info: '#1f6fb8'
    }
  }
]

export const DEFAULT_THEME_ID = 'editorial'
export const DEFAULT_DECOR_INTENSITY: DecorIntensity = 'subtle'

/**
 * How many of each sprite to draw, per decoration set and intensity.
 *
 * Counts are deliberately small. Decoration sits behind the screen someone
 * does their invoicing on, and the difference between charming and infuriating
 * is mostly a question of how many. Snow is the only one that needs volume,
 * because sparse snow reads as dust.
 */
export const DECOR_COUNTS: Record<
  DecorKind,
  Record<Exclude<DecorIntensity, 'off'>, Record<string, number>>
> = {
  halloween: {
    subtle: { ghost: 3, pumpkin: 2, cobweb: 2, bat: 0 },
    festive: { ghost: 6, pumpkin: 5, cobweb: 2, bat: 3 }
  },
  christmas: {
    subtle: { snowflake: 14, lights: 1, drift: 1 },
    festive: { snowflake: 24, lights: 1, drift: 1 }
  },
  newyear: {
    subtle: { confetti: 12, sparkle: 3 },
    festive: { confetti: 24, sparkle: 5 }
  },
  spring: {
    subtle: { petal: 10 },
    festive: { petal: 20 }
  },
  summer: {
    subtle: { sun: 1, seed: 6 },
    festive: { sun: 1, seed: 14 }
  }
}

/** What to draw for a theme at an intensity. Empty when there is nothing. */
export function decorFor(
  theme: Theme,
  intensity: DecorIntensity
): { kind: DecorKind; counts: Record<string, number> } | null {
  if (!theme.decor || intensity === 'off') return null
  return { kind: theme.decor, counts: DECOR_COUNTS[theme.decor][intensity] }
}

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

  /**
   * Mixed from the theme's own palette when a theme does not state them.
   *
   * `color-mix` rather than a precomputed hex so the relationship holds for
   * every theme, including any added later, and so a theme that does state one
   * simply wins. The direction is what matters: the gradient end and the
   * sidebar lift slightly off the page, a card lifts slightly on hover, and
   * disabled text sinks toward the background.
   */
  const mix = (a: string, weight: number, b: string): string =>
    `color-mix(in srgb, ${a} ${weight}%, ${b})`

  return {
    '--color-ground': tokens.ground,
    '--color-ground-end': tokens.groundEnd ?? mix(tokens.ground, 94, tokens.ink),
    '--color-sidebar': tokens.sidebar ?? mix(tokens.ground, 97, tokens.ink),
    '--color-surface': tokens.surface,
    '--color-surface-hover': tokens.surfaceHover ?? mix(tokens.surface, 94, tokens.ink),
    '--color-raised': tokens.raised,
    '--color-overlay': tokens.overlay,
    '--color-hover': tokens.hover,
    '--color-line': tokens.line,
    '--color-line-strong': tokens.lineStrong,
    /**
     * The 1px top edge of a card, which fakes a light source above the window.
     *
     * Brighter than `line` on a dark theme and darker on a light one — a white
     * highlight on a white card is invisible, and the illusion needs the edge
     * nearest the light to be the lighter one either way.
     */
    '--color-line-top': theme.light
      ? mix(tokens.lineStrong, 70, 'transparent')
      : 'rgba(255,255,255,0.09)',
    '--color-ink': tokens.ink,
    '--color-muted': tokens.muted,
    '--color-faint': tokens.faint,
    '--color-disabled': tokens.disabled ?? mix(tokens.faint, 55, tokens.ground),
    '--color-accent': tokens.accent,
    '--color-accent-hover': tokens.accentHover,
    '--color-accent-press': tokens.accentPress,
    '--color-accent-ink': tokens.accentInk,
    // Tinted fills and the ambient page glow, always derived so they track
    // whatever the accent is rather than being a second hex to keep in step.
    '--color-accent-subtle': mix(tokens.accent, 12, 'transparent'),
    '--color-accent-glow': mix(tokens.accent, 6, 'transparent'),
    '--color-focus': mix(tokens.accent, 50, 'transparent'),
    '--color-success': tokens.success,
    '--color-warning': tokens.warning,
    '--color-danger': tokens.danger,
    '--color-info': tokens.info,

    /**
     * The tray behind a nested card, and the quiet chart series.
     *
     * Both derived when unstated so every existing theme gains the nested
     * card pattern without being edited — `raised` is already the step
     * between page and card, which is exactly what the tray is.
     */
    '--color-shell': tokens.shell ?? tokens.raised,
    '--color-chart-secondary': tokens.chartSecondary ?? mix(tokens.faint, 45, tokens.ground),

    /**
     * The sidebar ramp, defaulting to the content ramp.
     *
     * A theme that says nothing here gets exactly what it had: the sidebar
     * is a shade of the page and its text is the page's text. Only a theme
     * that deliberately inverts the sidebar — editorial — states them.
     */
    '--color-sidebar-raised': tokens.sidebarRaised ?? tokens.raised,
    '--color-sidebar-active': tokens.sidebarActive ?? tokens.hover,
    '--color-sidebar-active-border': tokens.sidebarActiveBorder ?? tokens.lineStrong,
    '--color-sidebar-line': tokens.sidebarLine ?? tokens.line,
    '--color-sidebar-ink': tokens.sidebarInk ?? tokens.ink,
    '--color-sidebar-muted': tokens.sidebarMuted ?? tokens.muted,
    '--color-sidebar-section': tokens.sidebarSection ?? tokens.faint,
    '--font-sans': theme.fontSans,
    '--font-mono': theme.fontMono,
    /**
     * Cards carry the theme's radius; controls sit 4px tighter and chips
     * tighter again, so the whole scale moves together rather than each radius
     * being set by hand. Floored so a square theme cannot go negative.
     */
    /**
     * Shadows, which a light theme cannot share with a dark one.
     *
     * These used to be fixed in theme.css at strengths tuned for near-black
     * — 0.4 and 0.6 alpha — which on an off-white page is not a shadow but a
     * smudge. Depth in a light theme comes from borders, so what is left
     * here is deliberately almost nothing.
     *
     * `pill` is the exception the design allows itself: the active
     * navigation item lifts off the sidebar, and being the only raised
     * surface in the window is exactly what makes it read as where you are.
     */
    '--shadow-card': theme.light
      ? '0 1px 2px rgba(0, 0, 0, 0.04)'
      : '0 1px 2px rgba(0, 0, 0, 0.4)',
    '--shadow-modal': theme.light
      ? '0 12px 32px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.05)'
      : '0 16px 48px rgba(0, 0, 0, 0.6)',
    '--shadow-pill': theme.light ? '0 1px 2px rgba(0, 0, 0, 0.06)' : 'none',
    '--radius-control': `${Math.max(2, theme.radius - 4)}px`,
    '--radius-chip': `${Math.max(2, theme.radius - 6)}px`,
    '--radius-card': `${theme.radius}px`,
    '--radius-panel': `${theme.radius}px`
  }
}

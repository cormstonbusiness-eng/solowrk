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
   * A card that inverts — dark fill, light text — and the text on it.
   *
   * Used on the dashboard, where a grid of identical white cards is a grid
   * with no shape to it: every card has to be read before you know which is
   * which. A few inverted ones give the eye something to navigate by, and
   * they do it without introducing colour, which the palette reserves.
   *
   * A separate value from `accent` even though both are near-black. They
   * move for different reasons — accent is what a button is, invert is what
   * a surface is — and tying them together means a future change to one
   * silently drags the other.
   */
  invert?: string
  invertInk?: string
  invertMuted?: string

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
  /**
   * Text and icons sitting *on* the active item, which is not the same as
   * `sidebarInk`.
   *
   * They were one value while the active pill was a light tint of the
   * sidebar. The moment that pill inverts — a dark slab on a light column —
   * they stop agreeing: the workspace name and the account chip still want
   * near-black, and the row you are on wants white. Sharing one token means
   * choosing which of the two is unreadable.
   *
   * Falls back to `sidebarInk`, so a theme whose active surface is not
   * inverted never has to think about it.
   */
  sidebarActiveInk?: string
  sidebarLine?: string
  sidebarInk?: string
  sidebarMuted?: string
  sidebarSection?: string
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

      /* The inverted card, a touch off pure black so it reads as paper. */
      invert: '#1c1c1a',
      invertInk: '#ffffff',
      invertMuted: '#9b9b94',

      /*
        The sidebar, light like everything else.

        Stated rather than left to fall back, even though most are close to
        the content ramp, because the two are not the same thing and the
        distinction is the point of the group. The sidebar sits a shade
        lighter than the page so the frame reads as raised.

        The active item inverts: a dark slab with white on it, which is the
        strongest single mark in the window and therefore unambiguous about
        where you are. It is deliberately a shade lighter than `accent`
        (#2e2e2a against #1a1a18) so a primary button still reads as the
        firmer of the two — one says "you are here", the other says "press
        me", and they should not look like the same offer.
      */
      sidebar: '#fbfbfa',
      sidebarRaised: '#ffffff',
      sidebarActive: '#2e2e2a',
      sidebarActiveBorder: '#2e2e2a',
      sidebarActiveInk: '#ffffff',
      sidebarLine: '#e7e7e3',
      /*
        The same value as `invert` above, deliberately.

        A menu label and the fill of a dark module are the two near-blacks
        the eye sees side by side most often, and two near-blacks that are
        nearly but not quite equal read as a mistake rather than as a
        choice. If one of them moves, move the other.
      */
      sidebarInk: '#1c1c1a',
      sidebarMuted: '#6b6b64',
      sidebarSection: '#a3a39c'
    }
  }
]

export const DEFAULT_THEME_ID = 'editorial'

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

    /* The inverted card. Falls back to the ink/ground pair reversed. */
    '--color-invert': tokens.invert ?? tokens.ink,
    '--color-invert-ink': tokens.invertInk ?? tokens.ground,
    '--color-invert-muted': tokens.invertMuted ?? mix(tokens.ground, 62, tokens.ink),

    /**
     * The sidebar ramp, defaulting to the content ramp.
     *
     * A theme that says nothing here gets exactly what it had: the sidebar
     * is a shade of the page and its text is the page's text. Only a theme
     * that deliberately inverts the sidebar — editorial — states them.
     */
    '--color-sidebar-raised': tokens.sidebarRaised ?? tokens.raised,
    '--color-sidebar-active': tokens.sidebarActive ?? tokens.hover,
    '--color-sidebar-active-ink': tokens.sidebarActiveInk ?? tokens.sidebarInk ?? tokens.ink,
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

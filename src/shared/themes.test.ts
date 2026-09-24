import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, THEMES, themeById, themeVariables } from './themes'

const contrast = (a: string, b: string): number => {
  const luminance = (hex: string): number => {
    const channel = (offset: number): number => {
      const value = Number.parseInt(hex.slice(1 + offset * 2, 3 + offset * 2), 16) / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  }

  const light = Math.max(luminance(a), luminance(b))
  const dark = Math.min(luminance(a), luminance(b))
  return (light + 0.05) / (dark + 0.05)
}

/** Perceptual distance, enough to catch two tokens that read as the same colour. */
const distance = (a: string, b: string): number => {
  const channels = (hex: string): number[] => [0, 1, 2].map((index) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
  )
  const [r1, g1, b1] = channels(a) as [number, number, number]
  const [r2, g2, b2] = channels(b) as [number, number, number]
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

describe('the theme set', () => {
  it('has a default that exists', () => {
    expect(themeById(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID)
  })

  it('falls back rather than throwing on an unknown id', () => {
    // A theme could be removed while a workspace still points at it.
    expect(themeById('no-such-theme').id).toBe(THEMES[0]!.id)
  })

  it('gives every theme a unique id', () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length)
  })

  it('defines every required token on every theme', () => {
    /**
     * A partial theme inherits half its palette from whatever came before,
     * which is how grey text on a grey card happens.
     *
     * The optional tokens are exempt on purpose: when absent they are derived
     * from the theme's *own* palette — mixed from its ground, surface and
     * faint, or taken straight from its content ramp — so they can never land
     * outside it. That is a different thing from inheriting another theme's
     * colours, and it is why they may be omitted.
     *
     * The sidebar group is the largest of them and the most important to get
     * right. Only a theme that deliberately inverts its sidebar states them;
     * every other theme leaves the sidebar a shade of its own page, which is
     * what all eleven did before Editorial existed.
     */
    const OPTIONAL = new Set([
      'groundEnd',
      'surfaceHover',
      'disabled',
      'shell',
      'chartSecondary',
      'sidebar',
      'sidebarRaised',
      'sidebarActive',
      'sidebarActiveBorder',
      'sidebarActiveInk',
      'sidebarLine',
      'sidebarInk',
      'sidebarMuted',
      'sidebarSection'
    ])
    const required = Object.keys(THEMES[0]!.tokens).filter((name) => !OPTIONAL.has(name))

    for (const theme of THEMES) {
      const present = Object.keys(theme.tokens)
      expect(required.every((name) => present.includes(name)), theme.id).toBe(true)
      expect(present.filter((name) => !OPTIONAL.has(name)).sort()).toEqual([...required].sort())

      for (const value of Object.values(theme.tokens)) {
        // Lines are translucent so a card reads as lit rather than outlined,
        // and so one value works over any surface beneath it.
        expect(value, `${theme.id}: ${value}`).toMatch(
          /^(#[0-9a-f]{6}|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\))$/i
        )
      }
    }
  })
})

describe('every theme is readable', () => {
  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    '%s has legible body text',
    (_name, theme) => {
      // 4.5:1 is the normal-text threshold. Text on a card is the workhorse
      // pairing in this app, so it is the one worth enforcing.
      expect(contrast(theme.tokens.ink, theme.tokens.surface)).toBeGreaterThan(4.5)
    }
  )

  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    '%s has legible muted text',
    (_name, theme) => {
      // Muted carries real information — client names, dates — so it gets the
      // large-text threshold rather than being allowed to fade out.
      expect(contrast(theme.tokens.muted, theme.tokens.surface)).toBeGreaterThan(3)
    }
  )

  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    '%s has a readable primary button',
    (_name, theme) => {
      expect(contrast(theme.tokens.accentInk, theme.tokens.accent)).toBeGreaterThan(4)
    }
  )

  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    '%s has a readable active navigation item',
    (_name, theme) => {
      /*
        The pairing this token exists for.

        The active item can invert — a dark slab on a light column — while the
        rest of the sidebar keeps near-black text. Sharing one ink between them
        means choosing which of the two is unreadable, and the failure is
        silent: the row you are on simply stops having visible text, on the one
        control that tells you where you are.

        Both sides fall back the way `themeVariables` does, so a theme that
        states neither is still measured against what it would actually render.
      */
      const fill = theme.tokens.sidebarActive ?? theme.tokens.hover
      const ink = theme.tokens.sidebarActiveInk ?? theme.tokens.sidebarInk ?? theme.tokens.ink

      expect(contrast(ink, fill)).toBeGreaterThan(4.5)
    }
  )

  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    '%s keeps the accent distinct from danger',
    (_name, theme) => {
      /**
       * Otherwise a primary button and an overdue invoice look alike, which is
       * the one confusion this app genuinely cannot afford.
       *
       * The floor was 60 while the accent was violet, where the pair were
       * nowhere near each other. An orange accent and a red danger are the
       * tightest pair the app has ever had — Midnight measures 55 — so the
       * floor is 50 and the separation now leans on form as well as hue: a
       * primary action is a filled slab with near-black text, overdue money is
       * red text on a dark card. Take this any lower and it stops being a
       * guard at all.
       */
      expect(distance(theme.tokens.accent, theme.tokens.danger)).toBeGreaterThan(50)
    }
  )
})

describe('themeVariables', () => {
  it('emits a value for every colour token', () => {
    /*
      Read from the theme rather than hard-coded. The old assertion named a
      hex — the accent of a theme that no longer exists — so it was testing
      that one palette had not changed rather than that the function emits
      what it is given, which is the thing that could actually break.
    */
    const theme = themeById(DEFAULT_THEME_ID)
    const variables = themeVariables(theme)
    expect(variables['--color-accent']).toBe(theme.tokens.accent)
    expect(variables['--color-ground']).toBeDefined()
    expect(variables['--font-sans']).toBeDefined()
  })

  it('emits the sidebar ramp, falling back to the content ramp', () => {
    /*
      The group that makes a dark sidebar in a light app possible. Every member
      is optional, so the guard worth having is that an unstated one lands on
      the theme's own content ramp rather than on nothing — a sidebar with no
      text colour is an invisible sidebar.
    */
    const theme = themeById(DEFAULT_THEME_ID)
    const bare = { ...theme, tokens: { ...theme.tokens } }
    delete bare.tokens.sidebarInk
    delete bare.tokens.sidebarMuted

    const variables = themeVariables(bare)
    expect(variables['--color-sidebar-ink']).toBe(theme.tokens.ink)
    expect(variables['--color-sidebar-muted']).toBe(theme.tokens.muted)
  })

  it('scales its shadows to whether the theme is light', () => {
    // Fixed shadows tuned for near-black read as a smudge on an off-white
    // page, which is why these moved out of the stylesheet and in here.
    const light = themeVariables({ ...themeById(DEFAULT_THEME_ID), light: true })
    const dark = themeVariables({ ...themeById(DEFAULT_THEME_ID), light: false })

    expect(light['--shadow-card']).not.toBe(dark['--shadow-card'])
    expect(light['--shadow-pill']).not.toBe('none')
    expect(dark['--shadow-pill']).toBe('none')
  })

  it('derives the radius scale so it moves together', () => {
    // Cards 12, controls 8, chips 6 — the scale in the spec, expressed as
    // offsets from the theme's own card radius rather than three fixed values.
    const variables = themeVariables(themeById(DEFAULT_THEME_ID))
    expect(variables['--radius-card']).toBe('12px')
    expect(variables['--radius-control']).toBe('8px')
    expect(variables['--radius-chip']).toBe('6px')
    expect(variables['--radius-panel']).toBe('12px')
  })

  it('derives the tinted fills from whatever the accent is', () => {
    // Not a second hex to keep in step. A theme that changes its accent gets a
    // matching subtle fill and glow for free, and cannot get them wrong.
    const variables = themeVariables(themeById(DEFAULT_THEME_ID))
    for (const name of ['--color-accent-subtle', '--color-accent-glow', '--color-focus']) {
      expect(variables[name], name).toContain('color-mix')
      expect(variables[name], name).toContain(themeById(DEFAULT_THEME_ID).tokens.accent)
    }
  })

  it('never produces a negative radius on a square theme', () => {
    const square = { ...themeById(DEFAULT_THEME_ID), radius: 0 }
    expect(themeVariables(square)['--radius-control']).toBe('2px')
  })
})
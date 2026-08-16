import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, THEMES, isInSeason, themeById, themeVariables } from './themes'

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

  it('defines every token on every theme', () => {
    // A partial theme inherits half its palette from whatever came before,
    // which is how grey text on a grey card happens.
    const tokens = Object.keys(THEMES[0]!.tokens)
    for (const theme of THEMES) {
      expect(Object.keys(theme.tokens).sort()).toEqual(tokens.sort())
      for (const value of Object.values(theme.tokens)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/i)
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
    '%s keeps the accent distinct from danger',
    (_name, theme) => {
      // Otherwise a primary button and an overdue invoice look alike, which is
      // the one confusion this app genuinely cannot afford.
      expect(distance(theme.tokens.accent, theme.tokens.danger)).toBeGreaterThan(60)
    }
  )
})

describe('seasonal themes', () => {
  const halloween = themeById('halloween')
  const christmas = themeById('christmas')

  it('marks only the seasonal ones', () => {
    expect(THEMES.filter((theme) => theme.season).map((theme) => theme.id).sort()).toEqual([
      'christmas',
      'halloween'
    ])
  })

  it('puts Halloween in season through October', () => {
    expect(isInSeason(halloween, '2026-10-01')).toBe(true)
    expect(isInSeason(halloween, '2026-10-31')).toBe(true)
    expect(isInSeason(halloween, '2026-09-30')).toBe(false)
    expect(isInSeason(halloween, '2026-11-03')).toBe(false)
  })

  it('carries Christmas across the new year', () => {
    // A window from December to January wraps, and a naive from <= day <= to
    // would make it out of season for the whole of Christmas week.
    expect(isInSeason(christmas, '2026-12-01')).toBe(true)
    expect(isInSeason(christmas, '2026-12-25')).toBe(true)
    expect(isInSeason(christmas, '2027-01-02')).toBe(true)
    expect(isInSeason(christmas, '2027-01-06')).toBe(true)
    expect(isInSeason(christmas, '2027-01-07')).toBe(false)
    expect(isInSeason(christmas, '2026-11-30')).toBe(false)
  })

  it('never calls a non-seasonal theme in season', () => {
    for (const day of ['2026-01-01', '2026-06-15', '2026-10-31', '2026-12-25']) {
      expect(isInSeason(themeById('midnight'), day)).toBe(false)
    }
  })
})

describe('themeVariables', () => {
  it('emits a value for every colour token', () => {
    const variables = themeVariables(themeById('halloween'))
    expect(variables['--color-accent']).toBe('#f2761b')
    expect(variables['--color-ground']).toBeDefined()
    expect(variables['--font-sans']).toBeDefined()
  })

  it('derives the radius scale so it moves together', () => {
    const variables = themeVariables(themeById('christmas'))
    expect(variables['--radius-card']).toBe('12px')
    expect(variables['--radius-control']).toBe('10px')
    expect(variables['--radius-panel']).toBe('16px')
  })

  it('never produces a negative radius on a square theme', () => {
    const square = { ...themeById('paper'), radius: 0 }
    expect(themeVariables(square)['--radius-control']).toBe('2px')
  })
})

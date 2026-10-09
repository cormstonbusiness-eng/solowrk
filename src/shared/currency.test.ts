import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyInfo,
  formatMoney,
  formatNumber,
  formatRate,
  moneySymbol,
  symbolLeads
} from './currency'

describe('currencyInfo', () => {
  it('knows the currencies the country packs use', () => {
    // Sterling and the euro are what this release ships. The rest are here so
    // that an invoice raised in dollars formats correctly before a US country
    // pack exists — billing a foreign client is not the same thing as being
    // based in their country.
    for (const code of ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'NZD']) {
      expect(CURRENCIES[code], code).toBeDefined()
    }
  })

  it('falls back rather than throwing on a code it has never seen', () => {
    /*
      An older build can be pointed at a newer workspace, and the currency is a
      plain string column that nothing validates. The finance page going blank
      is a far worse outcome than an amount that reads a little plainly, so this
      degrades instead of failing.
    */
    const info = currencyInfo('ZWL')
    expect(info.code).toBe('ZWL')
    expect(info.minorUnits).toBe(2)
  })

  it('treats a missing currency as the default', () => {
    expect(currencyInfo(null).code).toBe(DEFAULT_CURRENCY)
    expect(currencyInfo(undefined).code).toBe(DEFAULT_CURRENCY)
    expect(currencyInfo('').code).toBe(DEFAULT_CURRENCY)
  })
})

describe('formatMoney', () => {
  it('formats sterling the way the app always has', () => {
    // These are the exact strings the nineteen hand-rolled formatters produced.
    // Every one of them is pinned so that routing them through here cannot
    // quietly restyle a figure somewhere in the app.
    expect(formatMoney(123_400, 'GBP')).toBe('£1,234')
    expect(formatMoney(0, 'GBP')).toBe('£0')
    expect(formatMoney(5_000, 'GBP')).toBe('£50')
    expect(formatMoney(4_427_500, 'GBP')).toBe('£44,275')
    expect(formatMoney(120_000, 'GBP', { pennies: true })).toBe('£1,200.00')
    expect(formatMoney(6_250, 'GBP', { pennies: true })).toBe('£62.50')
    expect(formatMoney(100, 'GBP', { pennies: true })).toBe('£1.00')
  })

  it('puts the minus sign before the symbol', () => {
    /*
      The one place this differs from what the app used to print, and
      deliberately. Concatenating a symbol onto a formatted number produced
      `£-1,500`, which is not how a negative amount is written in any locale.
      `Intl` places the sign correctly, and a credit note is exactly where
      somebody looks twice at the number.
    */
    expect(formatMoney(-150_000, 'GBP')).toBe('-£1,500')
    expect(formatMoney(-150_000, 'EUR')).toBe('-€1,500')
  })

  it('formats euro amounts as euro amounts', () => {
    expect(formatMoney(123_400, 'EUR')).toBe('€1,234')
    expect(formatMoney(120_000, 'EUR', { pennies: true })).toBe('€1,200.00')
  })

  it('renders an em dash when there is no amount', () => {
    // A missing figure and a zero figure mean different things, and the app
    // leans on that distinction in tables.
    expect(formatMoney(null, 'GBP')).toBe('—')
    expect(formatMoney(undefined, 'GBP')).toBe('—')
    expect(formatMoney(null, 'GBP', { blank: 'Not set' })).toBe('Not set')
    expect(formatMoney(0, 'GBP')).toBe('£0')
  })

  it('divides by the minor unit each currency actually has', () => {
    /*
      The only division in the app, and the reason it is here rather than
      spread across nineteen files. A zero-decimal currency stores whole units,
      so the stored integer must not be divided at all — the seam that makes
      the yen a table entry rather than an audit.
    */
    const yen = { code: 'JPY', minorUnits: 0, locale: 'ja-JP' }
    CURRENCIES.JPY = yen
    try {
      expect(formatMoney(1_234, 'JPY')).toContain('1,234')
    } finally {
      delete CURRENCIES.JPY
    }
  })
})

describe('formatRate', () => {
  it('shows pennies only when the rate has any', () => {
    // £50.00/hr is noise; £62.50/hr rounded to £63/hr is a lie.
    expect(formatRate(5_000, 'GBP')).toBe('£50/hr')
    expect(formatRate(6_250, 'GBP')).toBe('£62.50/hr')
    expect(formatRate(null, 'GBP')).toBe('—')
  })
})

describe('moneySymbol', () => {
  it('reads the symbol out of the locale rather than storing it', () => {
    expect(moneySymbol('GBP')).toBe('£')
    expect(moneySymbol('EUR')).toBe('€')
  })

  it('says which side of the number the symbol sits on', () => {
    // MoneyInput needs this to place its prefix, and there is no other honest
    // way to ask. Both currencies in this release lead; some locales do not.
    expect(symbolLeads('GBP')).toBe(true)
    expect(symbolLeads('EUR')).toBe(true)
  })
})

describe('formatNumber', () => {
  it('groups a count without making it money', () => {
    expect(formatNumber(1_234)).toBe('1,234')
    expect(formatNumber(1_234)).not.toContain('£')
  })
})

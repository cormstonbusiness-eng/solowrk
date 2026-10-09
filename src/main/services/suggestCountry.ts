import { app } from 'electron'
import { DEFAULT_COUNTRY, isCountryCode, type CountryCode } from '@shared/countries'

/**
 * Which country to offer in the first-run wizard.
 *
 * A suggestion and never an assumption. Getting it wrong is cheap — the user
 * is looking at a dropdown with the answer in it — while *not* offering one
 * means an Irish user has to notice a field they would reasonably skip, and
 * then discover their workspace is in sterling on a 6 April tax year.
 *
 * Derived rather than stored, following the `apiBaseUrl` precedent in
 * `config.ts`: this is a property of the machine, read fresh each time, not a
 * preference worth persisting. Nothing reads it for behaviour — only the
 * wizard, to pre-select a dropdown.
 *
 * Deliberately only the region of the OS locale, and only where it matches a
 * country the app actually supports. `en-IE` suggests Ireland; `en-US`
 * suggests nothing in particular and falls back, because an American user
 * picking between the United Kingdom and Ireland is choosing where they trade,
 * not where they are sitting.
 */
export function suggestedCountry(): CountryCode {
  const region = regionOf(app.getLocale())
  return region && isCountryCode(region) ? region : DEFAULT_COUNTRY
}

/**
 * The region subtag of a BCP 47 locale: `en-IE` → `IE`.
 *
 * `app.getLocale()` can return a bare language (`en`), a region (`en-GB`), or
 * something with a script in the middle (`zh-Hans-CN`), so the region is found
 * by shape rather than by position — two letters, which no language or script
 * subtag is.
 */
export function regionOf(locale: string): string | null {
  for (const part of locale.split(/[-_]/).slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase()
  }
  return null
}

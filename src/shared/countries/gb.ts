import { HMRC_RATES, VEHICLES } from '../mileage'
import { UK_TAX_YEAR } from '../taxYear'
import { UK_BANDS_2025_26 } from '../tax'
import type { CountryPack } from './types'

/**
 * The United Kingdom.
 *
 * Every value here was a hard-coded constant somewhere in the app until this
 * file existed, which is why the pack reads as a list of things that were
 * never decisions: sterling, `en-GB`, 20% VAT, 6 April, Monday, miles.
 *
 * England, Wales and Northern Ireland. Scotland sets its own income tax bands
 * and is not modelled — the charge-and-relief shape in `@shared/tax` admits it
 * as a region later, but shipping Scottish rates as though they were the rest
 * of the UK's would be worse than not offering them.
 */
export const GB: CountryPack = {
  code: 'GB',
  name: 'United Kingdom',
  locale: 'en-GB',
  currency: 'GBP',
  timeZone: 'Europe/London',

  taxYear: UK_TAX_YEAR,

  salesTax: {
    label: 'VAT',
    numberLabel: 'VAT number',
    // 20%, the standard rate. Reduced and zero rates cannot be expressed yet:
    // `settings.vat_rate` is one number per workspace, not one per line.
    defaultRate: 2000
  },

  taxRules: [UK_BANDS_2025_26],

  /**
   * Thirty percent, which is the figure freelancers are told in the pub.
   *
   * Kept as the seed because it is what the app has always used and it is not
   * far wrong in the basic-rate band. It is also why `@shared/tax` exists: a
   * flat percentage is badly too low the moment profit crosses into the higher
   * band, which is exactly the year somebody can least afford the surprise.
   */
  defaultSetAsidePercent: 30,

  weekStartsOn: 0,
  dateParseOrder: 'dmy',

  mileage: {
    unit: 'mile',
    vehicles: VEHICLES,
    rates: HMRC_RATES,
    authority: 'HMRC'
  },

  address: {
    // No county field: optional in UK addresses for decades, and Royal Mail
    // does not want one where there is a postcode.
    region: null,
    postcodeLabel: 'Postcode'
  },

  accountingBasis: 'cash',
  templatePack: 'uk'
}

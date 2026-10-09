import type { TaxRules } from '../tax'
import type { CountryPack } from './types'

/**
 * Ireland, 2026.
 *
 * ## What this models, and what it does not
 *
 * A single self-employed person with trading income and nothing else. That is
 * the app's audience, but in Ireland the assumption carries more weight than
 * it does in Britain, because jointly assessed couples have a different
 * standard rate cut-off entirely — so somebody married and jointly assessed
 * will see a figure that is too high. The `note` says so, and it is the first
 * thing to fix if Irish users ask.
 *
 * Three charges rather than the UK's two, and credits rather than an
 * allowance. Both were the reason `@shared/tax` was rewritten around charges
 * and reliefs: none of this fits a field called `personalAllowance`.
 *
 * Figures verified against Revenue and the KPMG Budget 2026 tables on
 * 9 October 2026. Ireland's tax year is the calendar year, so these are the
 * rates for the year in progress; Budget 2027 changes apply from 1 January.
 */
const IE_RULES_2026: TaxRules = {
  label: '2026',
  startYear: 2026,
  verifiedOn: '2026-10-09',
  sourceUrl: 'https://kpmg.com/ie/en/insights/tax/budget-2026/tables.html',
  note:
    'An estimate for a single self-employed person with trading income only — ' +
    'income tax, USC and PRSI, assessed singly, with no employment income, ' +
    'rental income or other reliefs. A jointly assessed couple has a higher ' +
    'standard rate cut-off and will owe less than this shows.',

  reliefs: [
    /*
      Credits, not allowances, and the distinction is worth stating because it
      is where an Irish figure would most plausibly be got wrong by somebody
      reasoning from the UK: an allowance of €2,000 is worth €800 to a
      40% payer, while a credit of €2,000 is worth €2,000 to everybody.

      Both apply to income tax only. A credit that also reduced USC or PRSI
      would understate the bill by hundreds.
    */
    {
      id: 'personalCredit',
      label: 'Personal tax credit',
      kind: 'credit',
      amount: 2_000_00,
      appliesTo: ['incomeTax']
    },
    {
      id: 'earnedIncomeCredit',
      label: 'Earned income credit',
      kind: 'credit',
      amount: 2_000_00,
      appliesTo: ['incomeTax']
    }
  ],

  charges: [
    {
      id: 'incomeTax',
      label: 'Income tax',
      /*
        There is no allowance to subtract — Ireland's equivalent arrives as a
        credit further down — so this is charged on the whole profit. Stated
        as `afterAllowances` rather than `gross` deliberately: the pack has no
        allowance-style reliefs, so the two are identical today, and if
        Ireland ever introduces one this charge picks it up with no code
        change.
      */
      basis: 'afterAllowances',
      bands: [
        { from: 0, rate: 20 },
        // The standard rate cut-off for a single person. €44,000 in 2025 and
        // unchanged for 2026.
        { from: 44_000_00, rate: 40 }
      ]
    },
    {
      id: 'usc',
      label: 'USC',
      basis: 'gross',
      /*
        A cliff, not a threshold. Below €13,000 of total income there is no USC
        at all; at €13,000 it is charged on the whole amount from zero — about
        €80 for the euro that crosses the line, since the bands are progressive
        within the charge rather than a flat rate on everything.

        `cliffAhead` in `@shared/tax` exists for this edge specifically. Eighty
        euro is not ruinous, but it is a step rather than a rate, and somebody
        deciding whether to take one more small job in December is exactly the
        person who should be told.
      */
      exemptBelow: 13_000_00,
      bands: [
        { from: 0, rate: 0.5 },
        { from: 12_012_00, rate: 2 },
        { from: 28_700_00, rate: 3 },
        { from: 70_044_00, rate: 8 },
        // The 3% surcharge on non-PAYE income above €100,000, which lands on
        // exactly this app's users and is easy to miss.
        { from: 100_000_00, rate: 11 }
      ]
    },
    {
      id: 'prsi',
      label: 'PRSI',
      basis: 'gross',
      /*
        Class S, and the one figure here that is a judgement rather than a
        reading.

        The rate rose from 4.2% to 4.35% on 1 October 2026, part-way through
        the calendar tax year this table covers. A single annual band cannot
        express a mid-year change, so this takes the higher rate.

        That direction is deliberate. This figure is what somebody sets aside,
        and the file it lives beside says why: a euro over each month is a
        rounding error, while a euro under, twelve times, is a shortfall. The
        error here is at most 0.15% of profit and it is on the safe side.
      */
      bands: [{ from: 0, rate: 4.35 }],
      /*
        The minimum annual contribution — €650 since October 2024. Below the
        trigger you pay the percentage; at or above it you pay at least the
        floor, which makes a low-profit year lumpier than a rate alone implies.
      */
      minimum: { amount: 650_00, whenIncomeAtLeast: 5_000_00 }
    }
  ]
}

export const IE: CountryPack = {
  code: 'IE',
  name: 'Ireland',
  locale: 'en-IE',
  currency: 'EUR',
  timeZone: 'Europe/Dublin',

  // The calendar year, written as a single number — not the UK's 2026/27.
  taxYear: { start: { day: 1, month: 1 }, labelStyle: 'calendar' },

  salesTax: {
    label: 'VAT',
    numberLabel: 'VAT number',
    // 23% standard rate. The reduced rates cannot be expressed: `vat_rate` is
    // one number per workspace rather than one per line.
    defaultRate: 2300
  },

  taxRules: [IE_RULES_2026],

  /**
   * The same 30% the UK seeds, and for the same reason: it is a habit to
   * start, not an answer.
   *
   * Worth recording why it is not higher, because the intuition is wrong. It
   * looks as though Ireland must cost more — three charges, and income tax
   * from the first euro where Britain has £12,570 tax-free. But Ireland's
   * €4,000 of credits are worth €4,000, while the UK allowance saves a basic
   * rate payer only about £2,514, so on a €30,000 profit Ireland charges
   * roughly 12.5% against the UK's 15.1%.
   *
   * The two systems cross over in the fifties and Ireland is dearer well
   * above that — around 36% at €100,000 against 31% in Britain. So there is
   * no "Ireland is more expensive" simplification to encode here, which is
   * the whole argument for the band-based estimate doing the real work.
   */
  defaultSetAsidePercent: 30,

  weekStartsOn: 0,
  dateParseOrder: 'dmy',

  /*
    No mileage scheme, and this is a decision rather than an omission.

    Revenue's civil service motor rates are banded by engine size *and*
    cumulative annual distance, and are the rates an employer may reimburse an
    employee at — not a flat allowance a sole trader simply claims, which is
    what HMRC's 45p/25p is. A self-employed person in Ireland generally
    deducts the actual running costs of the vehicle instead.

    Shipping a plausible-looking number here would put a wrong figure on
    somebody's tax return, so the feature is hidden for Irish workspaces and
    expenses are the right route. Worth saying out loud in release notes.
  */
  mileage: null,

  address: {
    region: null,
    // Ireland's postcode has its own name and everybody uses it.
    postcodeLabel: 'Eircode'
  },

  accountingBasis: 'cash',
  templatePack: 'ie'
}

# Tax tables

Every rate the app computes a tax figure from, where it came from, and when a
human last checked it.

This file exists because the code around these numbers does not change when the
numbers do. A table can be silently wrong for a year while every test stays
green, and the figure on screen looks exactly as authoritative either way.
Somebody sets a standing order to it.

## How staleness is handled in the app

Tax tables ship inside the application, so a user on an older build is
computing this year's profit at last year's rates. That is the least-bad
answer — there is no useful "no tax" figure to show somebody who has earned
money — but it is never silent:

- Every `TaxRules` entry carries `startYear`, `verifiedOn` and `sourceUrl`.
- `rulesFor(country, startYear)` in `src/shared/countries/index.ts` returns the
  table published for that tax year, or the newest available **flagged as
  stale**.
- The tax card shows the country, the rates' label and the verification date,
  and swaps to a warning when the table is not the one for the tax year on
  screen.

Users cannot edit bands. A wrong figure somebody typed in is indistinguishable
on screen from a correct one, and it would be their word against the app's when
the bill arrived.

## Release checklist

| When | What |
|---|---|
| Each April | Re-verify the United Kingdom table against GOV.UK and add the new tax year's entry. |
| Each October (Budget) and January | Re-verify Ireland against Revenue and add the new calendar year's entry. |
| Any release | If `verifiedOn` on the newest table for a country is more than ~14 months old, it is overdue — that is also the threshold `RULES_STALE_AFTER_MONTHS` encodes. |

Add a new table rather than editing an existing one. Last year's figures stay
correct for last year's numbers, and somebody looking at a prior year should
not see it recalculated at today's rates.

---

## United Kingdom

England, Wales and Northern Ireland. **Scotland is not modelled** — it sets its
own income tax bands, and presenting Scottish profit at these rates would be
wrong by thousands. The charge-and-relief shape in `src/shared/tax.ts` admits
it as a further table when somebody asks.

### 2025/26 — verified 2025-04-06

Source: <https://www.gov.uk/income-tax-rates>

| | |
|---|---|
| Tax year | 6 April – 5 April, labelled `2025/26` |
| Personal allowance | £12,570, tapering by £1 per £2 of profit above £100,000 |
| Income tax | 20% to £37,700 above the allowance; 40% to £112,570; 45% above |
| Class 4 NI | 6% from £12,570; 2% above £50,270 — charged on profit, **not** on profit after the allowance |

The taper puts a 60% marginal band in the middle of the higher rate, which is
the most surprising thing in the UK system. It is not special-cased: the
marginal rate is measured as the cost of one more pound, so it falls out.

**Excluded:** employment income, dividends, student loan, Class 2, payments on
account.

---

## Ireland

### 2026 — verified 2026-10-09

Sources: <https://kpmg.com/ie/en/insights/tax/budget-2026/tables.html>,
Revenue.ie

Ireland's tax year is the calendar year, labelled `2026`.

| | |
|---|---|
| Income tax | 20% to €44,000 (single); 40% above |
| Personal tax credit | €2,000 — a **credit**, off tax due |
| Earned income credit | €2,000 — also a credit |
| USC | Exempt below €13,000 of income. At or above: 0.5% to €12,012, 2% to €28,700, 3% to €70,044, 8% to €100,000, 11% above |
| PRSI Class S | 4.35%, minimum €650 a year once profit reaches €5,000 |

Three things worth knowing about this table:

**Credits, not an allowance.** €2,000 of credit is worth €2,000 to everybody,
where the UK's £12,570 allowance saves a basic-rate payer about £2,514. This is
why Ireland is *cheaper* than Britain on a modest profit and dearer on a large
one — the two cross over in the fifties. There is no "Ireland costs more"
shortcut, and a test pins the crossover in both directions.

**The USC exemption is a cliff.** Below €13,000 there is no USC; at €13,000 it
is charged on the whole amount from zero, about €80 for the euro that crosses
the line. `cliffAhead` reports this in money rather than as a marginal rate,
because the true marginal rate there is around 8,000% and useless.

**PRSI rose mid-year, and this takes the higher rate.** Class S went from 4.2%
to 4.35% on 1 October 2026, part-way through the calendar tax year. A single
annual band cannot express that, so the table uses 4.35% — over-stating by at
most 0.15% of profit. That direction is deliberate: a euro over each month is a
rounding error, a euro under twelve times is a shortfall.

**Excluded:** employment income, rental income, joint assessment, and every
relief beyond the two credits. A jointly assessed couple has a higher standard
rate cut-off and will owe less than the app shows — the single most likely way
for an Irish figure here to be wrong in the user's favour to discover.

**No mileage scheme.** Revenue's civil service motor rates are banded by engine
size *and* cumulative annual distance, and are what an employer may reimburse
an employee at — not a flat allowance a sole trader claims, which is what
HMRC's 45p/25p is. A self-employed person in Ireland generally deducts the
actual running costs of the vehicle. The mileage feature is therefore hidden
for Irish workspaces rather than shown with a guessed rate.

---

## Still outstanding

These are known gaps rather than oversights, and they affect the UK too:

- **No per-line or multi-rate sales tax.** `settings.vat_rate` is one number
  per workspace, so reduced, zero-rated and exempt supplies cannot be
  expressed.
- **No cross-border VAT.** The app will let a UK user charge VAT to an Irish
  business, where the reverse charge usually applies. This is a larger
  correctness problem than anything above.
- **No registration-threshold monitoring** for either country.
- **Both template sets need a solicitor over them.** The jurisdiction clauses
  are correct as far as they go — the right Act, the right courts, the right
  statutory sums — but "correct citation" is not the same as "reviewed
  contract".

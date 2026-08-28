import { useState } from 'react'
import { Check } from 'lucide-react'
import {
  LIMIT_LABELS,
  TIER_ADDS,
  TIER_NAMES,
  TIER_PRICES,
  FEATURE_LABELS,
  type Tier
} from '@shared/entitlements'
import { limitSentence } from '@shared/limitError'
import { checkoutUrl, type BillingPeriod } from '@shared/site'
import { dismissLimit, useLimitReached } from '@/lib/limits'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { cn } from '@/lib/utils'

/**
 * What appears when somebody runs into a limit.
 *
 * §5.1 sets the order and it is worth keeping: what they were trying to do
 * first, what lifts it second, the money last. Leading with the price reads as
 * a toll gate; leading with the thing they were in the middle of reads as an
 * explanation, which is what it is.
 *
 * **Never a disabled control.** The spec calls a greyed-out button with no
 * explanation the worst possible outcome, and it is right — the user is left
 * to guess whether the app is broken, whether they did something wrong, or
 * whether it costs money. So the create action really is attempted, really
 * fails, and this says why.
 */
export function LimitModal(): React.JSX.Element {
  const facts = useLimitReached()

  // Annual preselected, everywhere, per §1.2. Monthly is a toggle away.
  const [period, setPeriod] = useState<BillingPeriod>('annual')

  const needs = facts?.needs ?? 'basicPlus'
  const price = TIER_PRICES[needs]

  return (
    <Modal
      open={facts !== null}
      onClose={dismissLimit}
      title={facts ? limitSentence(facts) : ''}
      description={`${TIER_NAMES[needs]} lifts it.`}
      width={460}
    >
      {facts && (
        <div className="flex flex-col gap-5">
          <Meter used={facts.used} cap={facts.cap} label={LIMIT_LABELS[facts.limit]} />

          <ul className="flex flex-col gap-2">
            {benefitsFor(needs).map((line) => (
              <li key={line} className="flex items-start gap-2 text-[12.5px] text-muted">
                <Check size={13} strokeWidth={2} className="mt-[3px] shrink-0 text-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {price && (
            <div className="flex flex-col gap-3 rounded-panel border border-line bg-raised p-3">
              <div className="flex items-center gap-1">
                {(['annual', 'monthly'] as const).map((one) => (
                  <button
                    key={one}
                    type="button"
                    onClick={() => setPeriod(one)}
                    className={cn(
                      'rounded-control px-2.5 py-1 text-[11.5px] capitalize transition-colors',
                      period === one
                        ? 'bg-accent text-accent-ink'
                        : 'text-muted hover:bg-hover hover:text-ink'
                    )}
                  >
                    {one}
                  </button>
                ))}
                {period === 'annual' && (
                  <span className="ml-auto text-[11px] text-success">
                    Save {savingFor(needs)}
                  </span>
                )}
              </div>

              <p className="numeric text-[19px] font-semibold text-ink">
                {money(price[period])}
                <span className="ml-1 text-[12px] font-normal text-faint">
                  {period === 'annual' ? 'a year' : 'a month'}
                </span>
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              // Straight to checkout with the tier and period already chosen,
              // never to the generic pricing page (§5.1).
              onClick={() => {
                window.open(checkoutUrl(needs, period), '_blank')
                dismissLimit()
              }}
            >
              Upgrade to {TIER_NAMES[needs]}
            </Button>
            <button
              type="button"
              onClick={dismissLimit}
              className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Not now
            </button>
          </div>

          {/*
            The sentence that stops this reading as a hostage note. §4.3 is
            explicit that nothing is ever hidden or locked, and somebody
            looking at a paywall is exactly who needs telling.
          */}
          <p className="text-[11.5px] leading-relaxed text-faint">
            Everything you have already made stays exactly as it is — readable,
            editable and exportable, on any plan.
          </p>
        </div>
      )}
    </Modal>
  )
}

/**
 * `Clients 3 of 3`, with the bar full.
 *
 * The same meter that lives on Settings → Account (§4.4), repeated here
 * because the number is the reason they are reading this.
 */
function Meter({ used, cap, label }: { used: number; cap: number; label: string }): React.JSX.Element {
  const share = Math.min(1, cap === 0 ? 1 : used / cap)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-muted">{label}</span>
        <span className="numeric text-[12px] text-ink">
          {used} of {cap}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-raised">
        <div
          className={cn('h-full rounded-full', share >= 1 ? 'bg-warning' : 'bg-accent')}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Three or four lines, drawn from the entitlement map.
 *
 * Generated rather than written so a feature moving between tiers cannot leave
 * a benefit line behind advertising something the tier no longer includes.
 * Volume comes first because it is what they just hit.
 */
function benefitsFor(tier: Tier): string[] {
  const headline =
    tier === 'basicPlus'
      ? 'Unlimited clients, projects, invoices and goals'
      : 'Everything in Basic+, with no limits of any kind'

  return [headline, ...TIER_ADDS[tier].slice(0, 3).map((feature) => FEATURE_LABELS[feature])]
}

function money(pence: number): string {
  return pence % 100 === 0
    ? `£${pence / 100}`
    : `£${(pence / 100).toFixed(2)}`
}

/** What annual saves against twelve months, for the toggle to say so. */
function savingFor(tier: Tier): string {
  const price = TIER_PRICES[tier]
  if (!price) return ''

  const saved = price.monthly * 12 - price.annual
  return `${money(saved)} (${Math.round((saved / (price.monthly * 12)) * 100)}%)`
}
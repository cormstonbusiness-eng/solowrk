import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { checkoutUrl } from '@shared/site'
import { useAuthState } from '@/lib/features'

/**
 * The trial countdown (§5.4).
 *
 * Appears from day 10 of the fourteen, never before. Earlier than that it is a
 * nag about something that has not happened yet; later than that and the first
 * a person hears of the deadline is the day it passes.
 *
 * **Never modal, never blocking.** It is a slim strip at the top of the content
 * area and it can be dismissed — but only for the session, so it comes back on
 * the next launch. Somebody who dismisses it on day 10 still gets told on 11,
 * 12 and 13, which is the point.
 *
 * The button goes straight to checkout with annual preselected (§1.2), because
 * a trial ending is exactly the moment not to make somebody navigate a pricing
 * page and choose between four cards.
 */
export function TrialBar(): React.JSX.Element {
  const auth = useAuthState()
  const [dismissed, setDismissed] = useState(false)

  if (!auth?.trial.showCountdown || dismissed) return <></>

  const { daysLeft } = auth.trial

  return (
    <div className="flex items-center gap-3 border-b border-accent/20 bg-accent/8 px-4 py-1.5">
      <Sparkles size={12} strokeWidth={1.75} className="shrink-0 text-accent" />

      <p className="min-w-0 flex-1 text-[11.5px] text-ink">
        {daysLeft === 1 ? 'Last day' : `${daysLeft} days left`} of your Pro trial.{' '}
        <span className="text-muted">
          Nothing you have made will be locked or deleted when it ends.
        </span>
      </p>

      <a
        href={checkoutUrl('pro', 'annual')}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-[11.5px] font-medium text-accent underline-offset-2 hover:underline"
      >
        Keep Pro
      </a>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Hide until next time"
        className="shrink-0 rounded-control p-0.5 text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
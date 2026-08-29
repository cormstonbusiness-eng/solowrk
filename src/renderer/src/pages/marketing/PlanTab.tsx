import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { MarketingPlanInput } from '@shared/types'
import { PLAN_SECTIONS, classify, parsePlan } from '@shared/plan'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, MoneyInput } from '@/components/ui/Field'
import { keys, useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ChannelList } from './ChannelList'

/**
 * The strategy, as a short document rather than a form (§4.1).
 *
 * Two of its five parts are not stored here at all. Who you sell to and the
 * reason somebody picks you already live in the business plan, and §4.1 is
 * explicit: reference them, do not duplicate them. Two copies of a positioning
 * statement is how a business ends up describing itself two different ways —
 * so those blocks are read-only here and link back to the one editable copy.
 *
 * Everything saves on blur. There is no Save button, because there is nothing
 * here that is dangerous half-finished: a quarterly focus typed to the third
 * word and then abandoned is still a better record than an empty box.
 */

/**
 * §4.1 asks for the plan's `positioning` key. The plan outline has no such
 * key — the section whose whole hint is "the honest reason someone picks you
 * instead" is `competition`, so that is what this reads. Named here rather
 * than inline so the mapping is a decision somebody can find and argue with.
 */
const AUDIENCE_SECTION = 'market'
const POSITIONING_SECTION = 'competition'

export function PlanTab(): React.JSX.Element {
  const invalidate = useInvalidate()

  const { data: plan } = useQuery({
    queryKey: keys.marketingPlan,
    queryFn: () => window.solo.invoke('plan:get')
  })

  const save = useMutation({
    mutationFn: (patch: MarketingPlanInput) => window.solo.invoke('plan:update', patch),
    onSuccess: () => invalidate(['marketing'])
  })

  return (
    <div className="flex max-w-[820px] flex-col gap-3">
      <Card className="p-4">
        <CardHeader title="Who you're trying to reach" />
        <ReferencedFromPlan section={AUDIENCE_SECTION} />
        <AutoText
          value={plan?.audience ?? ''}
          onSave={(audience) => save.mutate({ audience })}
          placeholder="Small architecture practices in the North West, two to six people, who need drawings turned round in a week."
          rows={3}
        />
      </Card>

      <Card className="p-4">
        <CardHeader title="Why they'd pick you" />
        <ReferencedFromPlan
          section={POSITIONING_SECTION}
          fallback="Written in your business plan, not here — so there is only ever one version of it."
        />
      </Card>

      <Card className="p-4">
        <CardHeader
          title="Channels"
          action={
            <span className="text-[11px] text-faint">
              How often you have said you will show up
            </span>
          }
        />
        <ChannelList />
      </Card>

      <Card className="p-4">
        <CardHeader title="This quarter's focus" />
        <p className="mb-2 text-[11.5px] leading-relaxed text-faint">
          What marketing is actually for right now. One line beats a strategy document:{' '}
          <span className="text-muted">Replace the Harding retainer.</span>
        </p>
        <AutoText
          value={plan?.quarterlyFocus ?? ''}
          onSave={(quarterlyFocus) => save.mutate({ quarterlyFocus })}
          placeholder="Get two more architecture clients before the Harding job ends."
          rows={2}
        />
      </Card>

      <Card className="p-4">
        <CardHeader title="Annual budget" />
        <Field
          label="Planned marketing spend for the year"
          hint="What you spend against it appears here once campaigns are tracking spend."
          className="max-w-[220px]"
        >
          <MoneyInput
            pence={plan?.annualBudget ?? 0}
            onChangePence={(annualBudget) => save.mutate({ annualBudget })}
          />
        </Field>
      </Card>
    </div>
  )
}

/**
 * A section of the business plan, shown where it is useful and edited where it
 * belongs.
 *
 * Read-only on purpose. An editable copy here would be a second version of the
 * same paragraph, and the two would disagree within a month.
 */
function ReferencedFromPlan({
  section,
  fallback
}: {
  section: string
  fallback?: string
}): React.JSX.Element | null {
  const { data: status } = useQuery({
    queryKey: ['ai', 'businessPlan'],
    queryFn: () => window.solo.invoke('ai:businessPlan')
  })

  const spec = PLAN_SECTIONS.find((one) => one.key === section)
  const found = status?.preview
    ? parsePlan(status.preview).find((one) => classify(one.heading) === section)
    : undefined

  const body = found?.body.trim() ?? ''

  if (body === '' && !fallback) return null

  return (
    <div className="mb-3 rounded-control border border-line bg-ground/40 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] font-medium tracking-[0.09em] text-faint uppercase">
          {body === '' ? 'Not written yet' : `From your business plan — ${spec?.title ?? section}`}
        </span>
        <Link
          to="/business-plan"
          className="ml-auto flex items-center gap-0.5 text-[11px] text-faint transition-colors hover:text-ink"
        >
          {body === '' ? 'Write it' : 'Edit at source'}
          <ArrowUpRight size={11} strokeWidth={1.75} />
        </Link>
      </div>

      <p
        className={cn(
          'text-[12px] leading-relaxed whitespace-pre-wrap',
          body === '' ? 'text-disabled' : 'text-muted'
        )}
      >
        {body === '' ? (fallback ?? spec?.hint ?? '') : body}
      </p>
    </div>
  )
}

/** A textarea that saves when you leave it, and never while you are typing. */
function AutoText({
  value,
  onSave,
  placeholder,
  rows
}: {
  value: string
  onSave: (next: string) => void
  placeholder: string
  rows: number
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  // A value that changed elsewhere has to show here — but never mid-word.
  useEffect(() => setDraft(value), [value])

  return (
    <textarea
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== value.trim()) onSave(draft.trim())
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        'w-full resize-y rounded-control border border-line bg-raised px-3 py-2',
        'text-[13px] leading-relaxed text-ink placeholder:text-faint',
        'transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none'
      )}
    />
  )
}

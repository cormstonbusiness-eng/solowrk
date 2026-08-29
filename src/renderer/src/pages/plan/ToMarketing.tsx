import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * What the business plan says that Marketing should know.
 *
 * The two documents overlap in exactly two places — who you are trying to
 * reach, and where you show up — and keeping them in step by hand is the sort
 * of chore nobody does twice. So the plan offers, Marketing receives.
 *
 * **Nothing here happens without a click.** Marketing may already hold an
 * audience the user wrote by hand, and silently replacing it because they
 * edited a business plan section is how somebody stops trusting a document
 * they are being asked to rely on. Every change is shown before it is made,
 * and each half can be taken without the other.
 */
export function ToMarketing(): React.JSX.Element | null {
  const invalidate = useInvalidate()
  const entitled = useFeature('marketing')

  const [takeAudience, setTakeAudience] = useState(true)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [applied, setApplied] = useState<string | null>(null)

  const { data: suggestion } = useQuery({
    queryKey: ['plan', 'suggestFromBusiness'],
    queryFn: () => window.solo.invoke('plan:suggestFromBusiness'),
    // A locked module would throw in main and fill the console with refusals.
    enabled: entitled
  })

  // Every proposed channel starts ticked. They came out of the user's own
  // plan, so the common case is accepting them; the point of the list is
  // being able to drop the one the parser got wrong.
  useEffect(() => {
    if (suggestion) setChosen(new Set(suggestion.newChannels))
  }, [suggestion])

  const apply = useMutation({
    mutationFn: () =>
      window.solo.invoke('plan:applyFromBusiness', {
        audience: takeAudience ? suggestion?.audience : undefined,
        channels: [...chosen]
      }),
    onSuccess: (result) => {
      invalidate(['marketing'])
      const parts: string[] = []
      if (result.audience) parts.push('audience set')
      if (result.channelsCreated > 0) {
        parts.push(`${result.channelsCreated} channel${result.channelsCreated === 1 ? '' : 's'} added`)
      }
      setApplied(parts.length > 0 ? parts.join(', ') : 'nothing to change')
    }
  })

  if (!entitled || !suggestion || suggestion.empty) return null

  const audienceChanges =
    suggestion.audience !== '' && suggestion.audience.trim() !== suggestion.currentAudience.trim()

  const nothingToDo = !audienceChanges && suggestion.newChannels.length === 0
  if (nothingToDo) return null

  const toggle = (name: string): void =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <Card className="mb-3 p-4">
      <CardHeader
        title="Send this to Marketing"
        action={<Megaphone size={14} strokeWidth={1.75} className="text-faint" />}
      />

      <p className="mb-3 text-[11.5px] leading-relaxed text-faint">
        Your plan says things the marketing side can use. Nothing changes until you say so.
      </p>

      <div className="flex flex-col gap-2">
        {audienceChanges && (
          <button
            type="button"
            onClick={() => setTakeAudience((current) => !current)}
            className={cn(
              'flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-left transition-colors',
              takeAudience ? 'border-accent/40 bg-accent-subtle' : 'border-line hover:bg-raised'
            )}
          >
            <Tick on={takeAudience} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[12px] text-ink">
                {suggestion.currentAudience.trim() === ''
                  ? 'Set who you are trying to reach'
                  : 'Replace who you are trying to reach'}
              </span>
              {/* The existing value, shown, because "replace" is a word that
                  should never be used without saying what is being replaced. */}
              {suggestion.currentAudience.trim() !== '' && (
                <span className="text-[11px] text-disabled line-through">
                  {suggestion.currentAudience}
                </span>
              )}
              <span className="text-[11px] leading-relaxed text-muted">{suggestion.audience}</span>
            </span>
          </button>
        )}

        {suggestion.newChannels.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="mt-1 text-[11px] text-faint">
              Channels your plan mentions that you have not set up:
            </span>
            {suggestion.newChannels.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                className={cn(
                  'flex items-center gap-2.5 rounded-control border px-3 py-2 text-left transition-colors',
                  chosen.has(name) ? 'border-accent/40 bg-accent-subtle' : 'border-line hover:bg-raised'
                )}
              >
                <Tick on={chosen.has(name)} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{name}</span>
                <span className="shrink-0 text-[10.5px] text-disabled">no commitment yet</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={apply.isPending || (!takeAudience && chosen.size === 0)}
          onClick={() => apply.mutate()}
        >
          {apply.isPending ? 'Applying…' : 'Apply to Marketing'}
          <ArrowRight size={13} strokeWidth={1.75} />
        </Button>

        <AnimatePresence>
          {applied && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition.press}
              className="flex items-center gap-1.5 text-[12px] text-success"
            >
              <Check size={13} strokeWidth={2} />
              {applied}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Card>
  )
}

function Tick({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'mt-px grid size-[15px] shrink-0 place-items-center rounded-[3px] border transition-colors',
        on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-transparent'
      )}
    >
      <Check size={10} strokeWidth={3} />
    </span>
  )
}

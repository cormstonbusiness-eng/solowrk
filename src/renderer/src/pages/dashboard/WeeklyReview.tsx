import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useFeature } from '@/lib/features'
import { ArrowUpRight, NotebookPen } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useInvalidate } from '@/lib/api'

/**
 * Monday's review, on the dashboard.
 *
 * Three things to do, and a button that files the whole review into the
 * notebook. The three are on the dashboard rather than behind a click because
 * a weekly review nobody opens is a weekly review that does not exist — and
 * because they are short enough to read before deciding whether to.
 *
 * Every figure is computed from the workspace, not written by the assistant.
 * This is the page people trust without checking.
 */
export function WeeklyReview(): React.JSX.Element {
  const navigate = useNavigate()
  const invalidate = useInvalidate()

  // Not fired at all when the tier does not include it: the main process
  // would refuse, and a query that only ever returns a refusal is a query
  // worth not making. The card simply does not appear.
  const entitled = useFeature('aireview')

  const { data: review } = useQuery({
    queryKey: ['review', 'week'],
    queryFn: () => window.solo.invoke('review:week'),
    enabled: entitled,
    // The week does not change while somebody is looking at it.
    staleTime: 10 * 60_000
  })

  const file = useMutation({
    mutationFn: () => window.solo.invoke('review:file'),
    onSuccess: () => {
      invalidate(['notes'])
      navigate('/notes')
    }
  })

  if (!entitled || !review) return <></>

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="This week"
        action={
          <Button variant="ghost" size="sm" onClick={() => file.mutate()} disabled={file.isPending}>
            <NotebookPen size={13} strokeWidth={1.5} />
            Save as a note
          </Button>
        }
      />

      <ol className="flex flex-1 flex-col gap-2">
        {review.focus.map((one, index) => (
          <li key={index} className="flex gap-2.5">
            <span className="numeric mt-px shrink-0 text-[11px] text-faint">{index + 1}</span>
            <span className="text-[12.5px] leading-relaxed text-muted">{one}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => file.mutate()}
        className="mt-3 flex items-center gap-1 self-start text-[11.5px] text-faint transition-colors hover:text-ink"
      >
        Read the whole review
        <ArrowUpRight size={12} strokeWidth={1.5} />
      </button>
    </Card>
  )
}

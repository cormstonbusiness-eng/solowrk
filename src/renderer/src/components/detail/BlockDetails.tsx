import { useQuery } from '@tanstack/react-query'
import { blockTypeMeta } from '@shared/types'
import { describeSpan, minutesBetween } from '@shared/calendar'
import { Skeleton } from '@/components/ui/Skeleton'
import { durationLabel } from '@/pages/calendar/grid'

/**
 * What a calendar block actually is, at the top of the drawer.
 *
 * The other eight types are recognisable from their name alone — "Acme Ltd",
 * "Invoice 0042". A block called "Catch-up" is not: when it is, how long it
 * runs and whose work it is are the whole of it, and none of that fits in a
 * title. So this one type gets a summary above its tags and history.
 */
export function BlockDetails({ id }: { id: number }): React.JSX.Element | null {
  const { data: block, isPending } = useQuery({
    queryKey: ['calendar', 'block', id],
    queryFn: () => window.solo.invoke('calendar:block', { id })
  })

  if (isPending) return <Skeleton className="h-16 w-full" />
  if (!block) return null

  const meta = blockTypeMeta(block.blockType)
  const minutes = minutesBetween(block.startsAt, block.endsAt)

  const rows: { label: string; value: string }[] = [
    { label: 'When', value: block.allDay ? 'All day' : describeSpan(block) },
    { label: 'Length', value: block.allDay ? '—' : durationLabel(minutes) },
    { label: 'Type', value: meta.label },
    ...(block.projectName ? [{ label: 'Project', value: block.projectName }] : []),
    ...(block.clientName ? [{ label: 'Client', value: block.clientName }] : []),
    ...(block.location ? [{ label: 'Location', value: block.location }] : []),
    {
      label: 'Billable',
      // Spelled out rather than a tick. "No" is a real answer here, and an
      // absent tick reads as "not filled in".
      value: block.billable ? 'Yes' : 'No'
    },
    ...(block.source === 'local'
      ? []
      : [{ label: 'Source', value: 'A calendar you subscribe to' }])
  ]

  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-[0.06em] text-faint uppercase">Details</h3>
      <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-[12px] text-faint">{row.label}</dt>
            <dd className="numeric min-w-0 truncate text-[12.5px] text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>

      {block.description && (
        <p className="mt-3 border-t border-line pt-3 text-[12.5px] whitespace-pre-wrap text-muted">
          {block.description}
        </p>
      )}
    </section>
  )
}
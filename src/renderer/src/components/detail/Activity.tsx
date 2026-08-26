import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { ActivityEntry, EntityRef } from '@shared/types'
import { keys } from '@/lib/api'
import { formatWhen } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * What has happened to this record.
 *
 * Worth one line of explanation on screen rather than in a comment: edits
 * arrive already coalesced into one entry per ten minutes, because the app
 * saves as you type and the literal version buries the three events anybody
 * wanted to see under four hundred identical lines. So a line here is a
 * sitting, not a keystroke — and a status change is never merged with
 * anything, because those are the timeline.
 */
export function Activity({ subject }: { subject: EntityRef }): React.JSX.Element {
  const { data, isPending } = useQuery({
    queryKey: keys.activity(subject.type, subject.id),
    queryFn: () => window.solo.invoke('activity:for', subject)
  })

  const entries = data ?? []

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium tracking-[0.04em] text-faint uppercase">
        Activity
      </h3>

      {isPending ? (
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : entries.length === 0 ? (
        // Only reachable for something created before the history existed.
        <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-[12px] text-muted">
          Nothing recorded — this predates the history.
        </p>
      ) : (
        <motion.ol
          variants={listVariants}
          initial="initial"
          animate="animate"
          // The rail: a hairline down the left with a dot per entry, so the
          // eye reads it as one sequence rather than as separate lines.
          className="relative space-y-2.5 border-l border-line pl-4"
        >
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </motion.ol>
      )}
    </section>
  )
}

function Entry({ entry }: { entry: ActivityEntry }): React.JSX.Element {
  return (
    <motion.li variants={listItemVariants} className="relative">
      <span
        aria-hidden
        className="absolute top-1.5 -left-[19px] h-[5px] w-[5px] rounded-full bg-line-strong"
      />
      <p className="text-[12.5px] leading-snug text-ink">{describe(entry)}</p>
      <p className="text-[11px] text-faint">{formatWhen(entry.at)}</p>
    </motion.li>
  )
}

/**
 * Not the same sentence as `describeActivity` in the main process, and
 * deliberately so.
 *
 * That one writes "Created invoice INV-001", because the weekly review and the
 * assistant quote it somewhere the invoice is not already named. Here the
 * drawer's own heading says which invoice this is, so repeating it in every
 * line would be noise down a column.
 */
function describe(entry: ActivityEntry): string {
  if (entry.action === 'created') return entry.detail ? `Created — ${entry.detail}` : 'Created'
  if (entry.action === 'status') return entry.detail ? `Moved from ${entry.detail}` : 'Status changed'
  return 'Edited'
}

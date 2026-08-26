import { motion } from 'motion/react'
import { CalendarDays, Lock, MapPin, Video } from 'lucide-react'
import type { CalendarBlockWithContext } from '@shared/types'
import { blockTypeMeta } from '@shared/types'
import { describeSpan, occursOn, segmentOn } from '@shared/calendar'
import { Empty } from '@/components/ui/Empty'
import { Inspect } from '@/components/detail/Inspect'
import { cn } from '@/lib/utils'
import { listItemVariants, listVariants } from '@/lib/motion'
import { dayLabel, durationLabel } from './grid'

/**
 * The list view: everything in range, in order, grouped by day. Days with
 * nothing on them are omitted rather than shown empty — an agenda is for
 * reading what is coming, not for confirming the gaps.
 */
export function AgendaView({
  days,
  today,
  blocks,
  onOpenBlock
}: {
  days: string[]
  today: string
  blocks: CalendarBlockWithContext[]
  onOpenBlock: (block: CalendarBlockWithContext) => void
}): React.JSX.Element {
  const rows = days
    .map((day) => ({
      day,
      blocks: blocks.filter((block) => occursOn(block, day))
    }))
    .filter((row) => row.blocks.length > 0)

  if (rows.length === 0) {
    return (
      <Empty
        icon={CalendarDays}
        title="Nothing scheduled"
        body="Nothing in this range. Double-click a day in the month view, or click a time slot in the week view, to put something in."
      />
    )
  }

  return (
    <motion.div variants={listVariants} initial="initial" animate="animate" className="pb-2">
      {rows.map((row) => {
        // The drawer's arrows walk what the agenda is showing, in the order it
        // is showing it — the whole range, not just this day's group.
        const siblings = blocks.map((block) => ({ type: 'block' as const, id: block.id }))
        const committed = row.blocks.reduce((total, block) => {
          if (block.allDay || !blockTypeMeta(block.blockType).counts) return total
          const segment = segmentOn(block, row.day)
          return total + (segment.end - segment.start)
        }, 0)

        return (
          <div key={row.day} className="mb-4 flex gap-4">
            <div className="w-[86px] shrink-0 pt-1 text-right">
              <p
                className={cn(
                  'text-[11px] tracking-[0.06em] uppercase',
                  row.day === today ? 'text-accent' : 'text-faint'
                )}
              >
                {dayLabel(row.day, { weekday: 'short' })}
              </p>
              <p className="numeric text-[17px] text-ink">{Number(row.day.slice(8))}</p>
              <p className="text-[10.5px] text-faint">{dayLabel(row.day, { month: 'short' })}</p>
              {committed > 0 && (
                <p className="numeric mt-0.5 text-[10px] text-faint">{durationLabel(committed)}</p>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {row.blocks.map((block) => (
                <motion.div
                  key={block.id}
                  variants={listItemVariants}
                  style={{ borderLeftColor: block.displayColour }}
                  className="group flex items-center gap-3 rounded-control border-l-[3px] bg-raised pr-2 transition-colors hover:bg-hover"
                >
                  <button
                    type="button"
                    onClick={() => onOpenBlock(block)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                  >
                    <span className="numeric w-[96px] shrink-0 text-[11.5px] text-muted">
                      {block.allDay ? 'All day' : describeSpan(block)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {block.title}
                    </span>

                    {/* The type, said out loud. In the grid it is a colour; in
                        a list there is room for the word, and "Admin" beside a
                        three-hour block is the whole point of the view. */}
                    <span className="shrink-0 text-[11px] text-faint">
                      {blockTypeMeta(block.blockType).label}
                    </span>

                    {block.billable && (
                      <span className="numeric shrink-0 text-[11px] text-muted" title="Billable">
                        £
                      </span>
                    )}
                    {block.locked && (
                      <Lock size={11} strokeWidth={1.75} className="shrink-0 text-faint" />
                    )}
                    {block.meetingUrl && (
                      <Video size={12} strokeWidth={1.75} className="shrink-0 text-faint" />
                    )}
                    {block.location && (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
                        <MapPin size={11} strokeWidth={1.75} />
                        <span className="max-w-[120px] truncate">{block.location}</span>
                      </span>
                    )}
                    {block.projectName && (
                      <span className="shrink-0 text-[11px] text-muted">{block.projectName}</span>
                    )}
                  </button>

                  <Inspect
                    subject={{ type: 'block', id: block.id }}
                    siblings={siblings}
                    label={block.title}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        )
      })}
    </motion.div>
  )
}
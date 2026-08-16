import { motion } from 'motion/react'
import { CalendarDays, MapPin, Video } from 'lucide-react'
import type { CalendarEventWithContext } from '@shared/types'
import { describeSpan, occursOn } from '@shared/calendar'
import { Empty } from '@/components/ui/Empty'
import { cn } from '@/lib/utils'
import { listItemVariants, listVariants } from '@/lib/motion'
import { dayLabel } from './grid'

/**
 * The list view: everything in range, in order, grouped by day. Days with
 * nothing on them are omitted rather than shown empty — an agenda is for
 * reading what is coming, not for confirming the gaps.
 */
export function AgendaView({
  days,
  today,
  events,
  onOpenEvent
}: {
  days: string[]
  today: string
  events: CalendarEventWithContext[]
  onOpenEvent: (event: CalendarEventWithContext) => void
}): React.JSX.Element {
  const rows = days
    .map((day) => ({
      day,
      events: events.filter((event) => occursOn(event, day))
    }))
    .filter((row) => row.events.length > 0)

  if (rows.length === 0) {
    return (
      <Empty
        icon={CalendarDays}
        title="Nothing scheduled"
        body="No events or task deadlines in this range. Double-click a day in the month view, or click a time slot in the week view, to add something."
      />
    )
  }

  return (
    <motion.div variants={listVariants} initial="initial" animate="animate" className="pb-2">
      {rows.map((row) => (
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
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {row.events.map((event) => (
              <motion.button
                key={event.id}
                variants={listItemVariants}
                type="button"
                onClick={() => onOpenEvent(event)}
                style={{ borderLeftColor: event.displayColour }}
                className="flex items-center gap-3 rounded-control border-l-2 bg-raised px-3 py-2 text-left transition-colors hover:bg-hover"
              >
                <span className="numeric w-[96px] shrink-0 text-[11.5px] text-muted">
                  {event.allDay ? 'All day' : describeSpan(event)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{event.title}</span>

                {event.meetingUrl && <Video size={12} strokeWidth={1.75} className="text-faint" />}
                {event.location && (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
                    <MapPin size={11} strokeWidth={1.75} />
                    <span className="max-w-[120px] truncate">{event.location}</span>
                  </span>
                )}
                {event.projectName && (
                  <span className="shrink-0 text-[11px] text-muted">{event.projectName}</span>
                )}
              </motion.button>
            ))}


          </div>
        </div>
      ))}
    </motion.div>
  )
}

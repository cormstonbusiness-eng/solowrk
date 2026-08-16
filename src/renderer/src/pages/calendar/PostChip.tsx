import { useNavigate } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import type { PostWithContext } from '@shared/types'
import { PLATFORMS } from '@shared/social'
import { timeOf } from '@shared/calendar'
import { cn } from '@/lib/utils'

/**
 * A scheduled post as it appears on the main calendar.
 *
 * Deliberately not draggable here, unlike on the Marketing page: this view is
 * for seeing what is going out alongside everything else, and a post moved by
 * accident while looking at your week is a post that goes out on the wrong day.
 * Clicking opens Marketing, where moving it is the point.
 */
export function CalendarPostChip({
  post,
  compact = false
}: {
  post: PostWithContext
  compact?: boolean
}): React.JSX.Element {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => navigate('/marketing')}
      title={`Scheduled post: ${post.title || post.body.slice(0, 80)}`}
      className={cn(
        'flex w-full items-center gap-1.5 truncate rounded-[4px] border border-dashed px-1.5 text-left',
        'border-accent/40 text-muted transition-colors hover:text-ink',
        compact ? 'py-[2px] text-[11px]' : 'py-1 text-[11.5px]'
      )}
    >
      <Megaphone size={10} strokeWidth={1.75} className="shrink-0 text-accent" />
      {post.scheduledAt && !compact && (
        <span className="numeric shrink-0 text-[10px] text-faint">{timeOf(post.scheduledAt)}</span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {post.title || post.body.slice(0, 40) || 'Untitled post'}
      </span>
      <span className="flex shrink-0 items-center gap-[3px]">
        {post.targets.slice(0, 3).map((target) => (
          <span
            key={target.id}
            style={{ backgroundColor: PLATFORMS[target.platform]?.colour ?? '#5a5a63' }}
            className="h-1.5 w-1.5 rounded-full"
          />
        ))}
      </span>
    </button>
  )
}
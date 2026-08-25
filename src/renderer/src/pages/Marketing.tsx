import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Lightbulb, Megaphone, Plus, TriangleAlert } from 'lucide-react'
import type { PostWithContext } from '@shared/types'
import { POST_STATUSES } from '@shared/types'
import { PLATFORMS } from '@shared/social'
import { addMonths, dayFromDate, isSameMonth, monthGrid, timeOf } from '@shared/calendar'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { ProPanel } from '@/components/ProPanel'
import { useFeature } from '@/lib/features'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { Composer } from './marketing/Composer'
import { PillarMix } from './marketing/PillarMix'
import { WEEKDAY_LABELS, monthLabel } from './calendar/grid'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'

const DRAG_THRESHOLD = 4

export function Marketing(): React.JSX.Element {
  /**
   * Checked before any of the hooks below run a query.
   *
   * Returning early keeps the page from firing sixteen requests the main
   * process is going to refuse, which would otherwise fill the console with
   * rejections and briefly flash an empty calendar before the panel appeared.
   */
  const entitled = useFeature('marketing')
  if (!entitled) {
    return (
      <Page title="Marketing" description="Plan what you post, and when.">
        <ProPanel
          title="Plan a month of posts in an afternoon"
          blurb="Marketing is part of Pro. It plans and schedules — writing, dating and filing your posts, then telling you when one is due and putting the caption on your clipboard. It does not post for you: connecting social accounts is still being built."
          does={[
            {
              title: 'A calendar of posts',
              body: 'Drag them between days, keep a backlog of ideas, date them later.'
            },
            {
              title: 'Campaigns and content pillars',
              body: 'So a month of posting has a shape rather than being whatever occurred to you that morning.'
            },
            {
              title: 'Evergreen repeats',
              body: 'Good posts come back around on a cycle you set, without being retyped.'
            },
            {
              title: 'Media filed with the post',
              body: 'Images live in your workspace beside everything else, not in an app you rent.'
            }
          ]}
        />
      </Page>
    )
  }

  return <MarketingBoard />
}

function MarketingBoard(): React.JSX.Element {
  const invalidate = useInvalidate()
  const today = dayFromDate(new Date())

  const [anchor, setAnchor] = useState(today)
  const [editing, setEditing] = useState<PostWithContext | null>(null)
  const [creating, setCreating] = useState<{ day: string } | null>(null)
  const [dragging, setDragging] = useState<{ id: number; overDay: string } | null>(null)

  const days = monthGrid(anchor)
  const from = days[0]!
  const to = days.at(-1)!

  useOpenParam('new', () => setCreating({ day: today }))

  const { data: posts = [] } = useQuery({
    queryKey: keys.posts({ from, to }),
    queryFn: () => window.solo.invoke('marketing:posts', { from, to })
  })

  const { data: backlog = [] } = useQuery({
    queryKey: keys.posts({ backlog: true }),
    queryFn: () => window.solo.invoke('marketing:posts', { backlog: true })
  })

  const { data: summary } = useQuery({
    queryKey: ['marketing', 'summary', from, to],
    queryFn: () => window.solo.invoke('marketing:summary', { from, to })
  })

  const reschedule = useMutation({
    mutationFn: (input: { id: number; scheduledAt: string }) =>
      window.solo.invoke('marketing:updatePost', {
        id: input.id,
        patch: { scheduledAt: input.scheduledAt }
      }),
    onSuccess: () => invalidate(['marketing'])
  })

  // A clicked "time to post" notification should land on that post.
  useEffect(() => {
    return window.solo.on('marketing:focusPost', ({ id }) => {
      void window.solo.invoke('marketing:post', { id }).then((post) => {
        if (post.scheduledAt) setAnchor(post.scheduledAt.slice(0, 10))
        setEditing(post)
      })
    })
  }, [])

  /**
   * Dragging a post to another day, and dragging one out of the backlog onto
   * the calendar — the same gesture, because they are the same act: deciding
   * when something goes out.
   */
  function startDrag(pointerEvent: React.PointerEvent, post: PostWithContext): void {
    if (pointerEvent.button !== 0) return

    const originX = pointerEvent.clientX
    const originY = pointerEvent.clientY
    let moved = false
    let overDay: string | null = null

    const onMove = (move: PointerEvent): void => {
      if (!moved && Math.hypot(move.clientX - originX, move.clientY - originY) < DRAG_THRESHOLD) {
        return
      }
      moved = true

      const cell = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>('[data-day]')
      overDay = cell?.dataset.day ?? null
      setDragging({ id: post.id, overDay: overDay ?? '' })
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(null)

      if (!moved) {
        setEditing(post)
        return
      }
      if (!overDay) return

      // A post dragged from the backlog has no time yet, so it takes 09:00 —
      // and one already scheduled keeps whatever time you chose for it.
      const time = post.scheduledAt ? timeOf(post.scheduledAt) : '09:00'
      if (post.scheduledAt?.slice(0, 10) === overDay) return

      reschedule.mutate({ id: post.id, scheduledAt: `${overDay}T${time}` })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const attention = posts.filter(
    (post) => post.status === 'needs_attention' || post.status === 'failed'
  )

  return (
    <Page
      title="Marketing"
      description={monthLabel(anchor)}
      className="flex min-h-0 flex-col overflow-y-hidden"
      actions={
        <Button variant="primary" onClick={() => setCreating({ day: today })}>
          <Plus size={14} strokeWidth={1.75} />
          New post
        </Button>
      }
    >
      <div className="mb-3 flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous month"
          onClick={() => setAnchor(addMonths(anchor, -1))}
        >
          <ChevronLeft size={15} strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next month"
          onClick={() => setAnchor(addMonths(anchor, 1))}
        >
          <ChevronRight size={15} strokeWidth={1.75} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAnchor(today)} className="ml-1.5">
          Today
        </Button>

        {summary && (
          <div className="ml-auto flex items-center gap-4 text-[11.5px]">
            <span className="text-muted">
              <span className="numeric text-ink">{summary.scheduled}</span> scheduled
            </span>
            <span className="text-muted">
              <span className="numeric text-success">{summary.published}</span> published
            </span>
            <span className="text-muted">
              <span className="numeric text-faint">{summary.emptyDays.length}</span> empty days
            </span>
          </div>
        )}
      </div>

      <AnimatePresence>
        {attention.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition.press}
            className="mb-3 shrink-0 overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded-control border border-warning/30 bg-warning/8 px-3 py-2">
              <TriangleAlert size={13} strokeWidth={1.75} className="shrink-0 text-warning" />
              <p className="flex-1 text-[12px] text-ink">
                {attention.length === 1
                  ? 'One post missed its slot while SoloWrk was closed.'
                  : `${attention.length} posts missed their slot while SoloWrk was closed.`}{' '}
                <span className="text-muted">Reschedule them, or send them now.</span>
              </p>
              <Button variant="ghost" size="sm" onClick={() => setEditing(attention[0]!)}>
                Open
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Month grid */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
          <div className="grid shrink-0 grid-cols-7 border-b border-line bg-surface">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="px-2 py-1.5 text-[10.5px] tracking-[0.08em] text-faint uppercase"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
            {days.map((day) => {
              const dayPosts = posts.filter((post) => post.scheduledAt?.slice(0, 10) === day)
              const outside = !isSameMonth(day, anchor)

              return (
                <div
                  key={day}
                  data-day={day}
                  onDoubleClick={() => setCreating({ day })}
                  className={cn(
                    'min-h-0 border-r border-b border-line p-1 last:border-r-0',
                    outside && 'bg-ground/60',
                    dragging?.overDay === day && 'bg-accent/10'
                  )}
                >
                  <span
                    className={cn(
                      'numeric mb-1 block px-1 text-[11px]',
                      outside ? 'text-faint/60' : 'text-muted',
                      day === today &&
                        'grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[10.5px] font-medium text-accent-ink'
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>

                  <div className="flex flex-col gap-[3px] overflow-hidden">
                    {dayPosts.slice(0, 3).map((post) => (
                      <PostChip
                        key={post.id}
                        post={post}
                        dimmed={dragging?.id === post.id}
                        onPointerDown={(event) => startDrag(event, post)}
                      />
                    ))}
                    {dayPosts.length > 3 && (
                      <span className="px-1 text-[10.5px] text-faint">
                        +{dayPosts.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Backlog and mix */}
        <div className="flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto">
          <Card className="p-3">
            <CardHeader title="Mix" />
            {summary && <PillarMix mix={summary.mix} />}
          </Card>

          <Card className="p-3">
            <CardHeader
              title="Backlog"
              action={
                <button
                  type="button"
                  onClick={() => setCreating({ day: '' })}
                  className="text-[11px] text-faint transition-colors hover:text-ink"
                >
                  Add idea
                </button>
              }
            />

            {backlog.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-faint">
                Ideas with no date live here. Drag one onto a day when it earns a slot.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {backlog.map((post) => (
                  <div
                    key={post.id}
                    onPointerDown={(event) => startDrag(event, post)}
                    className={cn(
                      'flex cursor-grab items-start gap-2 rounded-control bg-raised px-2.5 py-2 select-none active:cursor-grabbing',
                      dragging?.id === post.id && 'opacity-50'
                    )}
                  >
                    <Lightbulb size={12} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
                      {post.title || post.body.slice(0, 60) || 'Untitled'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {posts.length === 0 && backlog.length === 0 && (
        <div className="mt-3 shrink-0">
          <Empty
            icon={Megaphone}
            title="Nothing planned yet"
            body="Double-click a day to plan a post, or add an idea to the backlog and date it later. You can plan and write everything before connecting a single account."
            action={
              <Button variant="primary" onClick={() => setCreating({ day: today })}>
                <Plus size={14} strokeWidth={1.75} />
                Plan your first post
              </Button>
            }
          />
        </div>
      )}

      <Composer
        open={editing !== null || creating !== null}
        post={editing}
        defaults={
          creating
            ? { day: creating.day, scheduled: creating.day !== '' }
            : undefined
        }
        onClose={() => {
          setEditing(null)
          setCreating(null)
        }}
      />
    </Page>
  )
}

function PostChip({
  post,
  dimmed,
  onPointerDown
}: {
  post: PostWithContext
  dimmed: boolean
  onPointerDown: (event: React.PointerEvent) => void
}): React.JSX.Element {
  const status = POST_STATUSES.find((entry) => entry.value === post.status)
  const colour = post.campaignColour ?? post.pillarColour ?? status?.colour ?? DEFAULT_ENTITY_COLOUR

  return (
    <motion.div
      layoutId={`post-${post.id}`}
      transition={transition.layout}
      onPointerDown={onPointerDown}
      style={{ backgroundColor: `${colour}1f`, borderColor: colour }}
      className={cn(
        'cursor-grab rounded-[4px] border-l-2 px-1.5 py-[3px] select-none active:cursor-grabbing',
        dimmed && 'opacity-50'
      )}
    >
      <div className="flex items-center gap-1">
        <span className="numeric shrink-0 text-[10px] text-muted">
          {post.scheduledAt ? timeOf(post.scheduledAt) : ''}
        </span>
        <span className="truncate text-[11px] text-ink">
          {post.title || post.body.slice(0, 40) || 'Untitled'}
        </span>
      </div>

      <div className="mt-[2px] flex items-center gap-1">
        {post.targets.slice(0, 4).map((target) => (
          <span
            key={target.id}
            title={PLATFORMS[target.platform]?.label ?? target.platform}
            style={{ backgroundColor: PLATFORMS[target.platform]?.colour ?? '#5a5a63' }}
            className="h-1.5 w-1.5 rounded-full"
          />
        ))}
        {post.status === 'needs_attention' && (
          <TriangleAlert size={9} strokeWidth={2.5} className="ml-auto text-warning" />
        )}
        {post.status === 'published' && (
          <span className="ml-auto text-[9px] text-success">sent</span>
        )}
      </div>
    </motion.div>
  )
}

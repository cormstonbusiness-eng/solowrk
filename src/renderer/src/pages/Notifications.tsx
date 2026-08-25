import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  PoundSterling,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { AppNotification, NotificationKind } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { useInvalidate } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

const ICONS: Record<NotificationKind, typeof Bell> = {
  info: Bell,
  due: Clock,
  late: TriangleAlert,
  money: PoundSterling,
  assistant: Sparkles
}

const TONES: Record<NotificationKind, string> = {
  info: 'text-muted',
  due: 'text-info',
  late: 'text-warning',
  money: 'text-success',
  assistant: 'text-accent'
}

type Tab = 'inbox' | 'archive'

/**
 * Everything the app has told you, and everything it told you before.
 *
 * The inbox is what has not been dealt with; archiving is how something leaves
 * it. Nothing is thrown away on your behalf — an alert about a late invoice is
 * worth being able to find again three months later.
 */
export function Notifications(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('inbox')

  const { data: items = [] } = useQuery({
    queryKey: ['notifications', tab],
    queryFn: () => window.solo.invoke('notifications:list', { archived: tab === 'archive' })
  })

  const refresh = { onSuccess: () => invalidate(['notifications']) }

  const read = useMutation({
    mutationFn: (id: number) => window.solo.invoke('notifications:read', { id }),
    ...refresh
  })
  const archive = useMutation({
    mutationFn: (id: number) => window.solo.invoke('notifications:archive', { id }),
    ...refresh
  })
  const restore = useMutation({
    mutationFn: (id: number) => window.solo.invoke('notifications:restore', { id }),
    ...refresh
  })
  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('notifications:delete', { id }),
    ...refresh
  })
  const readAll = useMutation({
    mutationFn: () => window.solo.invoke('notifications:readAll'),
    ...refresh
  })
  const archiveRead = useMutation({
    mutationFn: () => window.solo.invoke('notifications:archiveRead'),
    ...refresh
  })

  const unread = items.filter((item) => item.readAt === null).length

  function open(item: AppNotification): void {
    if (item.readAt === null) read.mutate(item.id)
    if (item.link) navigate(item.link)
  }

  return (
    <Page
      title="Notifications"
      description="What the app has told you, and what it told you before."
      actions={
        tab === 'inbox' && items.length > 0 ? (
          <>
            {unread > 0 && (
              <Button variant="ghost" onClick={() => readAll.mutate()}>
                <CheckCheck size={14} strokeWidth={1.75} />
                Mark all read
              </Button>
            )}
            {items.length > unread && (
              <Button variant="outline" onClick={() => archiveRead.mutate()}>
                <Archive size={14} strokeWidth={1.75} />
                Archive read
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="mb-4 flex items-center gap-1 border-b border-line">
        {(['inbox', 'archive'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className="relative px-3 py-2 text-[13px] capitalize"
          >
            <span className={tab === name ? 'text-ink' : 'text-muted hover:text-ink'}>
              {name}
              {name === 'inbox' && unread > 0 && tab !== 'inbox' && ` (${unread})`}
            </span>
            {tab === name && (
              <motion.span
                layoutId="notifications-tab"
                transition={transition.layout}
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      <Swap
        empty={items.length === 0}
        fallback={
          <Empty
            icon={tab === 'inbox' ? BellOff : Archive}
            title={tab === 'inbox' ? 'Nothing waiting' : 'Nothing archived'}
            body={
              tab === 'inbox'
                ? 'Reminders for meetings, deadlines and posts appear here, and slide into the corner as they happen. Anything you miss waits until you are ready for it.'
                : 'Notifications you have archived are kept here, so an alert about a late invoice is still findable months later.'
            }
          />
        }
      >
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="flex max-w-[820px] flex-col gap-1"
        >
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const Icon = ICONS[item.kind]
              const isUnread = item.readAt === null

              return (
                <motion.div
                  key={item.id}
                  layout
                  variants={listItemVariants}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={transition.layout}
                  className={cn(
                    'group flex items-start gap-3 rounded-control border px-3 py-2.5 transition-colors',
                    isUnread
                      ? 'border-line-strong bg-raised'
                      : 'border-transparent bg-raised/40 hover:bg-raised'
                  )}
                >
                  {/* Unread is a dot, not bold text: the list stays scannable
                      and the state is unambiguous at a glance. */}
                  <span className="mt-1.5 grid w-2 shrink-0 place-items-center">
                    {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </span>

                  <Icon
                    size={14}
                    strokeWidth={1.75}
                    className={cn('mt-0.5 shrink-0', TONES[item.kind])}
                  />

                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p
                      className={cn(
                        'text-[13px]',
                        isUnread ? 'font-medium text-ink' : 'text-muted'
                      )}
                    >
                      {item.title}
                      {item.link && (
                        <ArrowUpRight
                          size={11}
                          strokeWidth={2}
                          className="ml-1 inline text-faint"
                        />
                      )}
                    </p>
                    {item.body && (
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">
                        {item.body}
                      </p>
                    )}
                  </button>

                  <span className="numeric shrink-0 text-[11px] text-faint">
                    {formatDate(item.createdAt)}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    {tab === 'inbox' ? (
                      <>
                        {isUnread && (
                          <button
                            type="button"
                            aria-label="Mark as read"
                            title="Mark as read"
                            onClick={() => read.mutate(item.id)}
                            className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                          >
                            <Check size={13} strokeWidth={2} />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Archive"
                          title="Archive — marks it read on the way past"
                          onClick={() => archive.mutate(item.id)}
                          className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                        >
                          <Archive size={13} strokeWidth={1.75} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label="Restore to inbox"
                          title="Back to the inbox"
                          onClick={() => restore.mutate(item.id)}
                          className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                        >
                          <RotateCcw size={13} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete"
                          title="Delete permanently"
                          onClick={() => remove.mutate(item.id)}
                          className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                        >
                          <Trash2 size={13} strokeWidth={1.75} />
                        </button>
                      </>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>
      </Swap>
    </Page>
  )
}

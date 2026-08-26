import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { TrashEntry } from '@shared/types'
import { Page } from '@/components/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { ConfirmModal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { ENTITY_META } from '@/lib/entities'
import { formatWhen } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { useUndo } from '@/hooks/useUndo'
import { RETENTION_DAYS } from '@shared/retention'

/**
 * What has been deleted, and how to get it back.
 *
 * The safety net under undo rather than a replacement for it. Undo catches the
 * mistake you notice in the next ten seconds; this catches the one you notice
 * on Thursday.
 */
export function Trash(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { offer } = useUndo()
  const [emptying, setEmptying] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['trash'],
    queryFn: () => window.solo.invoke('trash:list', undefined)
  })
  const entries = data ?? []

  const refresh = (): void => {
    // Everything, because a restore can put back any kind of thing.
    void queryClient.invalidateQueries()
  }

  const restore = useMutation({
    mutationFn: (id: number) => window.solo.invoke('trash:restore', { id }),
    onSuccess: (result) => {
      refresh()
      offer(
        result.orphaned.length > 0
          ? `${result.restored} is back, but its ${result.orphaned.join(' and ')} has gone`
          : `${result.restored} is back`
      )
    },
    onError: (error) => {
      offer(error instanceof Error ? error.message : 'That could not be restored')
    }
  })

  const purge = useMutation({
    mutationFn: (id: number) => window.solo.invoke('trash:purge', { id }),
    onSuccess: refresh
  })

  const empty = useMutation({
    mutationFn: () => window.solo.invoke('trash:empty', undefined),
    onSuccess: ({ count }) => {
      refresh()
      offer(`Trash emptied — ${count} ${count === 1 ? 'thing' : 'things'} gone for good`)
    }
  })

  return (
    <Page
      title="Trash"
      description={`Deleted things, kept for ${RETENTION_DAYS} days. Restoring brings back everything that went with them.`}
      actions={
        entries.length > 0 && (
          <Button variant="danger" onClick={() => setEmptying(true)}>
            <Trash2 size={14} strokeWidth={1.75} />
            Empty trash
          </Button>
        )
      }
    >
      {isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <Swap
          empty={entries.length === 0}
          fallback={
            <Empty
              icon={Trash2}
              title="Nothing deleted"
              body={`Anything you delete waits here for ${RETENTION_DAYS} days before it really goes, with everything that belonged to it.`}
            />
          }
        >
          <motion.div
            variants={listVariants}
            initial="initial"
            animate="animate"
            className="flex max-w-[760px] flex-col gap-2"
          >
            <AnimatePresence initial={false}>
              {entries.map((entry) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  busy={restore.isPending || purge.isPending}
                  onRestore={() => restore.mutate(entry.id)}
                  onPurge={() => purge.mutate(entry.id)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </Swap>
      )}

      <ConfirmModal
        open={emptying}
        onClose={() => setEmptying(false)}
        onConfirm={() => empty.mutate()}
        title="Empty the trash?"
        confirmLabel="Empty it"
        body={`${entries.length} ${entries.length === 1 ? 'thing' : 'things'} will be gone for good, along with everything that belonged to them. This cannot be undone.`}
      />
    </Page>
  )
}

function Row({
  entry,
  busy,
  onRestore,
  onPurge
}: {
  entry: TrashEntry
  busy: boolean
  onRestore: () => void
  onPurge: () => void
}): React.JSX.Element {
  const meta = ENTITY_META[entry.entityType]
  const Icon = meta.icon

  return (
    <motion.div variants={listItemVariants} exit={{ opacity: 0, height: 0 }}>
      <Card className="group flex items-center gap-3 py-2.5">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-control border border-line bg-raised">
          <Icon size={13} strokeWidth={1.75} className="text-faint" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-ink">{entry.label}</p>
          <p className="truncate text-[11px] text-faint">
            {meta.noun} · {formatWhen(entry.deletedAt)}
            {/* What came with it. The reason to restore rather than remake. */}
            {entry.summary && ` · with ${entry.summary}`}
          </p>
        </div>

        <Button variant="ghost" size="sm" disabled={busy} onClick={onRestore}>
          <RotateCcw size={12} strokeWidth={1.75} />
          Restore
        </Button>

        <button
          type="button"
          aria-label={`Delete ${entry.label} for good`}
          title="Delete for good"
          disabled={busy}
          onClick={onPurge}
          className="rounded-control p-1.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger disabled:opacity-30"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </Card>
    </motion.div>
  )
}

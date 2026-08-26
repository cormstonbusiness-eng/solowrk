import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Link2, Link2Off, Plus } from 'lucide-react'
import type { BacklinkGroup, EntityRef, LinkedEntity } from '@shared/types'
import { keys, useInvalidate } from '@/lib/api'
import { ENTITY_META } from '@/lib/entities'
import { listItemVariants, listVariants } from '@/lib/motion'
import { useDrawer } from '@/hooks/useDrawer'
import { Skeleton } from '@/components/ui/Skeleton'
import { LinkPicker } from './LinkPicker'

/**
 * What this record is connected to.
 *
 * The panel does not distinguish a connection that came from a foreign key
 * from one somebody drew by hand, except in one place: only hand-made links
 * can be cut, because the other kind is the record's own shape. Unlinking a
 * project from its client would mean editing the project, and that belongs on
 * the project.
 */
export function Related({ subject }: { subject: EntityRef }): React.JSX.Element {
  const invalidate = useInvalidate()
  const [picking, setPicking] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: keys.related(subject.type, subject.id),
    queryFn: () => window.solo.invoke('links:related', subject)
  })

  const unlink = useMutation({
    mutationFn: (other: EntityRef) => window.solo.invoke('links:remove', { a: subject, b: other }),
    onSuccess: () => invalidate(['links'])
  })

  const groups = data ?? []

  return (
    <section>
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium tracking-[0.04em] text-faint uppercase">Related</h3>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex items-center gap-1 rounded-control px-1.5 py-1 text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          <Plus size={13} strokeWidth={1.75} />
          Link
        </button>
      </header>

      {isPending ? (
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-3/4" />
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-[12px] text-muted">
          Nothing connected yet.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Group key={group.type} group={group} onUnlink={(other) => unlink.mutate(other)} />
          ))}
        </div>
      )}

      <LinkPicker subject={subject} open={picking} onClose={() => setPicking(false)} />
    </section>
  )
}

function Group({
  group,
  onUnlink
}: {
  group: BacklinkGroup
  onUnlink: (other: EntityRef) => void
}): React.JSX.Element {
  const meta = ENTITY_META[group.type]
  const Icon = meta.icon
  const hidden = group.count - group.items.length

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-faint">
        <Icon size={12} strokeWidth={1.75} />
        <span>{meta.plural}</span>
        <span className="tabular-nums">{group.count}</span>
      </div>

      <motion.ul variants={listVariants} initial="initial" animate="animate" className="space-y-px">
        <AnimatePresence initial={false}>
          {group.items.map((item) => (
            <Row key={`${item.type}:${item.id}`} item={item} onUnlink={onUnlink} />
          ))}
        </AnimatePresence>
      </motion.ul>

      {hidden > 0 && (
        <p className="mt-1 px-1 text-[11px] text-faint">
          and {hidden} more — open {meta.plural.toLowerCase()} to see them all
        </p>
      )}
    </div>
  )
}

function Row({
  item,
  onUnlink
}: {
  item: LinkedEntity
  onUnlink: (other: EntityRef) => void
}): React.JSX.Element {
  const { open } = useDrawer()

  return (
    <motion.li
      variants={listItemVariants}
      exit={{ opacity: 0, height: 0 }}
      className="group flex items-center gap-2 overflow-hidden rounded-control transition-colors hover:bg-raised"
    >
      {/* The whole point of the panel: one connection at a time, without ever
          leaving the drawer. Opening a related record replaces what the drawer
          is showing, so following a client to a project to its invoice is
          three clicks and no navigation. */}
      <button
        type="button"
        onClick={() => open({ type: item.type, id: item.id })}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.label}</span>
        <span className="shrink-0 text-[11px] text-faint">{item.relationship}</span>
      </button>

      {/* Only a hand-made link can be cut. The rest is the record's shape. */}
      {item.structural ? (
        <Link2 size={12} strokeWidth={1.75} className="mr-2 shrink-0 text-faint opacity-40" />
      ) : (
        <button
          type="button"
          onClick={() => onUnlink({ type: item.type, id: item.id })}
          aria-label={`Unlink ${item.label}`}
          className="mr-2 shrink-0 rounded-control p-0.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
        >
          <Link2Off size={12} strokeWidth={1.75} />
        </button>
      )}
    </motion.li>
  )
}

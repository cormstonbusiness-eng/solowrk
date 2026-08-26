import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { ENTITY_TYPES } from '@shared/types'
import type { EntityRef, EntityType } from '@shared/types'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { keys, useInvalidate } from '@/lib/api'
import { ENTITY_META } from '@/lib/entities'
import { cn } from '@/lib/utils'

/**
 * Pick something to connect this record to.
 *
 * A modal rather than an inline field, and the one place in the drawer where a
 * modal is right: choosing what to link is a decision to finish before doing
 * anything else, and the list underneath is not what you are reading.
 *
 * The picker searches one type at a time, or all of them at once. It is not
 * the global search — no ranking, no matching on anything but the name the app
 * already shows — and it should not grow into one; when global search exists,
 * this becomes a caller of it.
 */
export function LinkPicker({
  subject,
  open,
  onClose
}: {
  subject: EntityRef
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<EntityType | undefined>(undefined)

  // A picker that reopens still showing the last search is a picker that
  // reopens showing the wrong thing.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setType(undefined)
  }, [open])

  const { data, isPending } = useQuery({
    queryKey: keys.entityFind(type, query),
    queryFn: () => window.solo.invoke('entity:find', { type, query }),
    enabled: open
  })

  const link = useMutation({
    mutationFn: (other: EntityRef) => window.solo.invoke('links:create', { a: subject, b: other }),
    onSuccess: () => {
      invalidate(['links'])
      onClose()
    }
  })

  // Never offer to link a thing to itself; the service refuses it anyway.
  const results = (data ?? []).filter(
    (row) => !(row.type === subject.type && row.id === subject.id)
  )

  return (
    <Modal open={open} onClose={onClose} title="Link to" width={440}>
      <div className="flex items-center gap-2 rounded-control border border-line bg-raised px-2.5 py-1.5">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1">
        <Chip active={type === undefined} onClick={() => setType(undefined)}>
          Anything
        </Chip>
        {ENTITY_TYPES.map((one) => (
          <Chip key={one} active={type === one} onClick={() => setType(one)}>
            {ENTITY_META[one].plural}
          </Chip>
        ))}
      </div>

      <div className="mt-3 max-h-[46vh] min-h-[120px] space-y-px overflow-y-auto">
        {isPending ? (
          <div className="space-y-1.5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted">
            {query ? `Nothing matching “${query}”.` : 'Nothing to link to yet.'}
          </p>
        ) : (
          results.map((row) => {
            const Icon = ENTITY_META[row.type].icon
            return (
              <button
                key={`${row.type}:${row.id}`}
                type="button"
                disabled={link.isPending}
                onClick={() => link.mutate({ type: row.type, id: row.id })}
                className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors hover:bg-raised disabled:opacity-50"
              >
                <Icon size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.label}</span>
                <span className="shrink-0 text-[11px] text-faint">
                  {ENTITY_META[row.type].noun}
                </span>
              </button>
            )
          })
        )}
      </div>

      {link.isError && (
        <p className="mt-2 text-[12px] text-danger">
          {link.error instanceof Error ? link.error.message : 'That could not be linked.'}
        </p>
      )}
    </Modal>
  )
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-accent bg-accent-subtle text-accent'
          : 'border-line text-muted hover:bg-raised hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

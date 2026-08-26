import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Archive, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { canArchive } from '@shared/types'
import type { EntityType } from '@shared/types'
import { Drawer, DrawerClose } from '@/components/ui/Drawer'
import { Skeleton } from '@/components/ui/Skeleton'
import { useDrawer, useDrawerKeys } from '@/hooks/useDrawer'
import { keys } from '@/lib/api'
import { ENTITY_META } from '@/lib/entities'
import { useEntityActions } from '@/hooks/useEntityActions'
import { Activity } from './Activity'
import { Related } from './Related'

/**
 * The record inspector.
 *
 * Mounted once, at the top of the app, and driven by the URL — so any list can
 * open it by calling `open(ref)` and nothing has to render a drawer of its own.
 *
 * What it deliberately is *not* is a replacement for the client and project
 * pages. Those exist, they work, and rebuilding them here would be exactly the
 * "rebuild what already works" the module spec warns against in §0. This
 * answers a smaller question — what is this thing connected to, and what has
 * happened to it — for all eight types uniformly, and hands off to the full
 * page for the two that have one.
 */
export function DetailDrawer(): React.JSX.Element {
  const { ref, close, step, canStep } = useDrawer()

  useDrawerKeys(ref !== null)

  return (
    <Drawer open={ref !== null} onClose={close}>
      {ref && (
        <Body
          key={`${ref.type}:${ref.id}`}
          type={ref.type}
          id={ref.id}
          onClose={close}
          onStep={step}
          canStep={canStep}
        />
      )}
    </Drawer>
  )
}

function Body({
  type,
  id,
  onClose,
  onStep,
  canStep
}: {
  type: EntityType
  id: number
  onClose: () => void
  onStep: (delta: 1 | -1) => void
  canStep: boolean
}): React.JSX.Element {
  const meta = ENTITY_META[type]
  const Icon = meta.icon
  const actions = useEntityActions()
  const [filing, setFiling] = useState(false)

  const { data: label, isPending } = useQuery({
    queryKey: keys.entityLabel(type, id),
    queryFn: () => window.solo.invoke('entity:label', { type, id })
  })

  // The URL can name something deleted since the link to it was made — from a
  // notification, or a browser history entry. Say so rather than showing an
  // empty panel that looks broken.
  const gone = !isPending && label === null

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control border border-line bg-raised">
          <Icon size={14} strokeWidth={1.75} className="text-muted" />
        </div>

        <div className="min-w-0 flex-1">
          {isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {label ?? 'No longer here'}
            </h2>
          )}
          <p className="mt-0.5 text-[11px] tracking-[0.03em] text-faint uppercase">{meta.noun}</p>
        </div>

        {canStep && (
          <div className="flex shrink-0 items-center">
            <StepButton label="Previous" onClick={() => onStep(-1)}>
              <ChevronUp size={14} strokeWidth={1.75} />
            </StepButton>
            <StepButton label="Next" onClick={() => onStep(1)}>
              <ChevronDown size={14} strokeWidth={1.75} />
            </StepButton>
          </div>
        )}

        <DrawerClose onClose={onClose} />
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {gone ? (
          <p className="rounded-control border border-dashed border-line px-3 py-6 text-center text-[12px] text-muted">
            This {meta.noun} has been deleted.
          </p>
        ) : (
          <>
            <Related subject={{ type, id }} />
            <Activity subject={{ type, id }} />
          </>
        )}
      </div>

      {!gone && (meta.route || canArchive(type)) && (
        <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
          {/* Only for the two types with a page of their own. A link that goes
              nowhere is worse than no link. */}
          {meta.route && (
            <Link
              to={meta.route(id)}
              onClick={onClose}
              className="flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
            >
              <ExternalLink size={13} strokeWidth={1.75} />
              Open the full {meta.noun}
            </Link>
          )}

          <div className="flex-1" />

          {/* Archive lives here because this is the one screen every type
              shares. Projects and tasks keep their own buttons; notes and
              documents had nowhere to put one until now. */}
          {canArchive(type) && (
            <button
              type="button"
              disabled={filing}
              onClick={() => {
                setFiling(true)
                void actions
                  .archive({ type, id }, label ?? meta.noun, true)
                  .finally(() => setFiling(false))
              }}
              className="flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink disabled:opacity-45"
            >
              <Archive size={13} strokeWidth={1.75} />
              Archive
            </button>
          )}
        </footer>
      )}
    </>
  )
}

function StepButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-control p-1 text-faint transition-colors duration-150 hover:bg-raised hover:text-ink"
    >
      {children}
    </button>
  )
}

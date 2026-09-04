import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronsUpDown, FolderPlus, TriangleAlert, X } from 'lucide-react'
import type { KnownWorkspace } from '@shared/types'
import { raiseLimit } from '@/lib/limits'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Which business you are working on.
 *
 * A workspace is a folder with its own database, so two businesses share
 * nothing — separate clients, separate invoice numbering, separate tax
 * settings. Switching is a real reopen rather than a filter, which is why it
 * empties every cached query on the way through: showing one business's
 * invoices under another's name for even a frame would be the worst bug this
 * feature could have.
 *
 * At the top of the sidebar because it is the widest piece of context in the
 * app. Everything below it means something different depending on what this
 * says.
 */
export function WorkspaceSwitcher(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const { data: workspaces = [] } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => window.solo.invoke('workspace:list')
  })

  const switchTo = useMutation({
    mutationFn: (path: string) => window.solo.invoke('workspace:switch', { path }),
    onSuccess: () => {
      setOpen(false)
      /*
        Everything, not just the workspace query. Every cached list in the app
        belongs to the workspace that was open when it was fetched, and a
        stale client list under a new business's name is exactly the kind of
        wrong that makes somebody stop trusting the app entirely.
      */
      void queryClient.invalidateQueries()
    }
  })

  const add = useMutation({
    mutationFn: async () => {
      const path = await window.solo.invoke('workspace:browse', {})
      if (!path) return null

      const folder = await window.solo.invoke('workspace:inspect', { path })

      if (folder.hasExistingWorkspace) {
        return window.solo.invoke('workspace:adopt', { path })
      }

      /*
        Everything left blank, including the name.

        The first-run wizard asks for all of this properly, but running it
        again would mean a full-screen takeover in the middle of somebody's
        working day just to add a second business. Main fills the name in from
        the folder — path handling belongs there, next to `basename`, rather
        than in a renderer picking apart Windows separators by hand.
      */
      return window.solo.invoke('workspace:create', {
        path,
        business: {
          businessName: '',
          contactName: '',
          email: '',
          phone: '',
          addressLine1: '',
          addressLine2: '',
          city: '',
          postcode: '',
          vatRegistered: false,
          vatNumber: '',
          defaultHourlyRate: 0,
          paymentTermsDays: 30
        }
      })
    },
    onSuccess: (status) => {
      if (!status) return
      setOpen(false)
      void queryClient.invalidateQueries()
    },
    // The tier cap arrives as a limit, so the upgrade modal can name the real
    // numbers rather than showing a bare error.
    onError: (error) => raiseLimit(error)
  })

  const forget = useMutation({
    mutationFn: (path: string) => window.solo.invoke('workspace:forget', { path }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  })

  // Click anywhere else to close. A menu that needs its own button pressed
  // again is a menu people leave open.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const current = workspaces.find((one) => one.current)

  // One workspace and nothing else known: no switcher, because there is
  // nothing to switch to and a menu with one item in it is furniture.
  if (workspaces.length <= 1 && !open) {
    return (
      // Tagged on both branches: a fresh install has exactly one workspace and
      // lands here, which is the only state the first-run tour ever sees.
      <div data-tour="workspace" className="px-2.5 pt-1 pb-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-raised"
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
            {current?.name ?? 'Workspace'}
          </span>
          <ChevronsUpDown size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
        </button>
      </div>
    )
  }

  return (
    <div data-tour="workspace" ref={box} className="relative px-2.5 pt-1 pb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
          {current?.name ?? 'Workspace'}
        </span>
        <ChevronsUpDown size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={transition.press}
            className="absolute inset-x-2.5 top-full z-30 flex flex-col gap-0.5 rounded-card border border-line-strong bg-overlay p-1.5 shadow-modal"
          >
            {workspaces.map((workspace) => (
              <Row
                key={workspace.path}
                workspace={workspace}
                busy={switchTo.isPending}
                onOpen={() => !workspace.current && switchTo.mutate(workspace.path)}
                onForget={() => forget.mutate(workspace.path)}
              />
            ))}

            <button
              type="button"
              disabled={add.isPending}
              onClick={() => add.mutate()}
              className="mt-0.5 flex items-center gap-2 rounded-control border-t border-line px-2 py-2 text-left text-[12px] text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              <FolderPlus size={13} strokeWidth={1.75} className="shrink-0" />
              {add.isPending ? 'Opening…' : 'Add another business'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Row({
  workspace,
  busy,
  onOpen,
  onForget
}: {
  workspace: KnownWorkspace
  busy: boolean
  onOpen: () => void
  onForget: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-control px-2 py-1.5 transition-colors',
        workspace.current ? 'bg-raised' : 'hover:bg-raised'
      )}
    >
      <button
        type="button"
        disabled={busy || workspace.missing}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
      >
        {workspace.current ? (
          <Check size={12} strokeWidth={2.5} className="shrink-0 text-accent" />
        ) : workspace.missing ? (
          <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0 text-warning" />
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'truncate text-[12.5px]',
              workspace.missing ? 'text-disabled' : 'text-ink'
            )}
          >
            {workspace.name}
          </span>
          {/* The path, because two businesses can easily have folders with
              similar names and the folder is the thing that is real. */}
          <span className="truncate text-[10.5px] text-disabled">
            {workspace.missing ? 'Folder not found' : workspace.path}
          </span>
        </span>
      </button>

      {/* Forgetting never touches the folder. The one that is open cannot be
          forgotten — there would be nothing to fall back to. */}
      {!workspace.current && (
        <button
          type="button"
          aria-label={`Remove ${workspace.name} from the list`}
          title="Remove from this list. The folder and everything in it stays where it is."
          onClick={onForget}
          className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

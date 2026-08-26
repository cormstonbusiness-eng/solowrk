import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { BookmarkPlus, Check, ChevronDown, Trash2 } from 'lucide-react'
import type { SavedView } from '@shared/types'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { ListState } from '@/hooks/useListState'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Filters somebody has named and kept.
 *
 * The whole feature is three IPC channels and this menu, because the filter
 * state already lives in the URL — a view is that string, saving one is
 * storing it, and applying one is setting it back. Nothing here knows what an
 * invoice filter is, which is why a page that grows a filter gains it in saved
 * views without anybody coming back to this file.
 */
export function SavedViews({ page, state }: { page: string; state: ListState }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<SavedView | null>(null)
  const container = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['views', page],
    queryFn: () => window.solo.invoke('views:list', { page })
  })
  const views = data ?? []

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['views', page] })
  }

  const save = useMutation({
    mutationFn: (input: { name: string; query: string }) =>
      window.solo.invoke('views:save', { page, ...input }),
    onSuccess: () => {
      refresh()
      setNaming(false)
      setName('')
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('views:delete', { id }),
    onSuccess: refresh
  })

  // Whether the name in the box would replace a view that already exists, so
  // the button can say "Replace" before it is pressed rather than after.
  const { data: taken } = useQuery({
    queryKey: ['views', page, 'taken', name.trim()],
    queryFn: () => window.solo.invoke('views:taken', { page, name: name.trim() }),
    enabled: naming && name.trim().length > 0
  })

  // A menu that stays open behind a click elsewhere is a menu in the way.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const current = views.find((view) => view.query === state.query) ?? null

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        className={cn(
          'flex h-8.5 items-center gap-1.5 rounded-control border border-line px-2.5',
          'text-[12.5px] transition-colors hover:bg-raised',
          current ? 'text-ink' : 'text-muted'
        )}
      >
        {current ? current.name : 'Views'}
        <ChevronDown size={12} strokeWidth={1.75} className="text-faint" />
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={transition.press}
            className="absolute top-full right-0 z-30 mt-1 w-[240px] overflow-hidden rounded-panel border border-line-strong bg-surface p-1 shadow-modal"
          >
            {views.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11.5px] text-muted">
                No saved views yet. Filter the list, then save it.
              </p>
            ) : (
              views.map((view) => (
                <div key={view.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      state.apply(view.query)
                      setMenuOpen(false)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-raised"
                  >
                    <span className="w-3 shrink-0">
                      {view.id === current?.id && (
                        <Check size={12} strokeWidth={2} className="text-accent" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete view ${view.name}`}
                    onClick={() => setDeleting(view)}
                    className="mr-1 rounded-control p-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                  >
                    <Trash2 size={11} strokeWidth={1.75} />
                  </button>
                </div>
              ))
            )}

            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                disabled={state.active === 0}
                title={
                  state.active === 0 ? 'Filter the list first — there is nothing to save' : undefined
                }
                onClick={() => {
                  setName(current?.name ?? '')
                  setNaming(true)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-45"
              >
                <BookmarkPlus size={12} strokeWidth={1.75} />
                Save this view
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={naming}
        onClose={() => setNaming(false)}
        title="Save this view"
        description="The filters as they are now, under a name."
        width={380}
        footer={
          <>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="rounded-control px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Cancel
            </button>
            <Button
              variant="primary"
              size="sm"
              disabled={!name.trim() || save.isPending}
              onClick={() => save.mutate({ name: name.trim(), query: state.query })}
            >
              {taken ? 'Replace' : 'Save'}
            </Button>
          </>
        }
      >
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) {
              save.mutate({ name: name.trim(), query: state.query })
            }
          }}
          placeholder="Overdue and unchased"
          className="h-8.5 w-full rounded-control border border-line bg-raised px-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
        />
        {taken && (
          <p className="mt-2 text-[12px] text-warning">
            There is already a view called “{name.trim()}”. Saving replaces it.
          </p>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        body="Only the saved filter goes. Nothing in the list is touched."
      />
    </div>
  )
}

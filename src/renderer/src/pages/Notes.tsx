import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { NotebookPen, Pin, Plus, Search, Trash2 } from 'lucide-react'
import type { NoteWithContext } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { ConfirmModal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** How long after you stop typing before the file is written. */
const SAVE_DELAY_MS = 700

/**
 * The notebook: notes that belong to no project.
 *
 * Same substance as project notes — real `.md` files in the workspace, editable
 * in any editor — just filed under `Notes\` instead of inside a project. A
 * plain textarea rather than a rich editor, deliberately: the file has to stay
 * readable and useful outside SoloWrk, which is the whole point of it being a
 * file at all.
 */
export function Notes(): React.JSX.Element {
  const invalidate = useInvalidate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [body, setBody] = useState('')
  const [deleting, setDeleting] = useState<NoteWithContext | null>(null)
  const [saved, setSaved] = useState(true)
  const timer = useRef<NodeJS.Timeout | null>(null)

  const { data: notes = [] } = useQuery({
    queryKey: keys.standaloneNotes(search || undefined),
    queryFn: () => window.solo.invoke('notes:standalone', { search: search || undefined })
  })

  const selected = notes.find((note) => note.id === selectedId) ?? null

  // Open the most recent note rather than an empty editor.
  useEffect(() => {
    if (selectedId === null && notes.length > 0) setSelectedId(notes[0]!.id)
  }, [notes, selectedId])

  const { data: content } = useQuery({
    queryKey: keys.note(selectedId ?? 0),
    queryFn: () => window.solo.invoke('notes:read', { id: selectedId! }),
    enabled: selectedId !== null
  })

  useEffect(() => {
    if (content !== undefined) {
      setBody(content)
      setSaved(true)
    }
  }, [content, selectedId])

  const write = useMutation({
    mutationFn: (text: string) =>
      window.solo.invoke('notes:write', { id: selectedId!, content: text }),
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['notes', 'standalone'] })
    }
  })

  /**
   * Debounced autosave. No save button: a note you have to remember to save is
   * a note you lose, and the file is the record.
   */
  function edit(text: string): void {
    setBody(text)
    setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => write.mutate(text), SAVE_DELAY_MS)
  }

  // A note left mid-edit when the page unmounts must still reach disk.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const create = useMutation({
    mutationFn: (title: string) => window.solo.invoke('notes:createStandalone', { title }),
    onSuccess: (note) => {
      invalidate(['notes'])
      setSelectedId(note.id)
    }
  })

  const pin = useMutation({
    mutationFn: (note: NoteWithContext) =>
      window.solo.invoke('notes:pin', { id: note.id, pinned: !note.pinned }),
    onSuccess: () => invalidate(['notes'])
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('notes:delete', { id }),
    onSuccess: () => {
      invalidate(['notes'])
      setSelectedId(null)
      setDeleting(null)
    }
  })

  const newNote = (): void => create.mutate(`Note ${new Date().toLocaleDateString('en-GB')}`)

  useOpenParam('new', newNote)

  return (
    <Page
      title="Notes"
      description="A notebook that belongs to no project. Real markdown files in your workspace."
      className="flex min-h-0 flex-col overflow-y-hidden"
      actions={
        <Button variant="primary" onClick={newNote}>
          <Plus size={14} strokeWidth={1.75} />
          New note
        </Button>
      }
    >
      <Swap
        empty={notes.length === 0 && search === ''}
        // The page body is a flex column and the note list below claims
        // the rest of it with flex-1. The swap wrapper sits between the
        // two, so it has to pass the height through or the list collapses
        // to nothing.
        className="flex min-h-0 flex-1 flex-col"
        fallback={
          <Empty
            icon={NotebookPen}
            title="Nothing written down yet"
            body="Anything that is not a task and not tied to a project: ideas, meeting scribbles, the thing you always forget. Saved as .md files you can open in any editor."
            action={
              <Button variant="primary" onClick={newNote}>
                <Plus size={14} strokeWidth={1.75} />
                Start a note
              </Button>
            }
          />
        }
      >
        <div className="flex min-h-0 flex-1 gap-3">
          <aside className="flex w-[240px] shrink-0 flex-col gap-2">
            <div className="relative">
              <Search
                size={13}
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
              />
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notes"
                className="pl-8"
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {notes.map((note) => (
                <div key={note.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    className={cn(
                      'w-full rounded-control px-2.5 py-2 pr-14 text-left transition-colors',
                      note.id === selectedId ? 'bg-raised' : 'hover:bg-raised/60'
                    )}
                  >
                    <p
                      className={cn(
                        'truncate text-[12.5px]',
                        note.id === selectedId ? 'text-ink' : 'text-muted'
                      )}
                    >
                      {note.title}
                    </p>
                    <p className="truncate text-[10.5px] text-faint">
                      {formatDate(note.updatedAt)}
                    </p>
                  </button>

                  <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
                    <button
                      type="button"
                      aria-label={note.pinned ? 'Unpin' : 'Pin to top'}
                      onClick={() => pin.mutate(note)}
                      className={cn(
                        'transition-opacity hover:text-ink',
                        note.pinned
                          ? 'text-accent opacity-100'
                          : 'text-faint opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <Pin size={11} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${note.title}`}
                      onClick={() => setDeleting(note)}
                      className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                    >
                      <Trash2 size={11} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              ))}

              {notes.length === 0 && (
                <p className="px-2.5 py-2 text-[11.5px] text-faint">Nothing matches that.</p>
              )}
            </div>
          </aside>

          <div className="flex min-h-0 flex-1 flex-col rounded-card border border-line">
            {selected ? (
              <>
                <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
                  <NoteTitle note={selected} />
                  <motion.span
                    animate={{ opacity: saved ? 0.5 : 1 }}
                    transition={transition.press}
                    className="ml-auto shrink-0 text-[10.5px] text-faint"
                  >
                    {saved ? 'Saved' : 'Saving…'}
                  </motion.span>
                </div>

                <textarea
                  value={body}
                  onChange={(event) => edit(event.target.value)}
                  spellCheck
                  className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink focus:outline-none"
                  placeholder="Write anything…"
                />
              </>
            ) : (
              <div className="grid flex-1 place-items-center">
                <p className="text-[12px] text-faint">Pick a note, or start a new one.</p>
              </div>
            )}
          </div>
        </div>
      </Swap>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={`Delete “${deleting?.title ?? ''}”?`}
        body="This deletes the markdown file as well — a note is its file."
        confirmLabel="Delete note"
      />
    </Page>
  )
}

function NoteTitle({ note }: { note: NoteWithContext }): React.JSX.Element {
  const invalidate = useInvalidate()
  const [title, setTitle] = useState(note.title)

  useEffect(() => setTitle(note.title), [note.id, note.title])

  const rename = useMutation({
    mutationFn: (next: string) => window.solo.invoke('notes:rename', { id: note.id, title: next }),
    onSuccess: () => invalidate(['notes'])
  })

  return (
    <input
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => title.trim() !== '' && title !== note.title && rename.mutate(title.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink focus:outline-none"
    />
  )
}

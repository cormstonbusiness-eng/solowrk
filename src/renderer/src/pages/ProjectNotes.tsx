import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, FileText, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { ConfirmModal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { keys, useInvalidate } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Notes are plain `.md` files in the project's `_notes` folder. The editor is a
 * textarea by design: the file has to stay readable and editable outside Solo,
 * so a rich editor that wrote its own markup would defeat the point.
 */
export function ProjectNotes({ projectId }: { projectId: number }): React.JSX.Element {
  const invalidate = useInvalidate()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: notes = [] } = useQuery({
    queryKey: keys.notes(projectId),
    queryFn: () => window.solo.invoke('notes:list', { projectId })
  })

  const { data: loaded, isFetching } = useQuery({
    queryKey: keys.note(selectedId ?? 0),
    queryFn: () => window.solo.invoke('notes:read', { id: selectedId! }),
    enabled: selectedId !== null
  })

  useEffect(() => {
    if (loaded !== undefined) {
      setContent(loaded)
      setDirty(false)
    }
  }, [loaded])

  // Select the first note once they load, so the pane is never blank for no reason.
  useEffect(() => {
    if (selectedId === null && notes.length > 0) setSelectedId(notes[0]!.id)
  }, [notes, selectedId])

  const save = useMutation({
    mutationFn: () => window.solo.invoke('notes:write', { id: selectedId!, content }),
    onSuccess: () => {
      setDirty(false)
      invalidate(['notes'])
    }
  })

  const create = useMutation({
    mutationFn: () => window.solo.invoke('notes:create', { projectId, title: newTitle.trim() }),
    onSuccess: (note) => {
      invalidate(['notes'])
      setSelectedId(note.id)
      setNewTitle('')
      setCreating(false)
    }
  })

  const remove = useMutation({
    mutationFn: () => window.solo.invoke('notes:delete', { id: selectedId! }),
    onSuccess: () => {
      invalidate(['notes'])
      setSelectedId(null)
      setContent('')
    }
  })

  if (notes.length === 0 && !creating) {
    return (
      <Empty
        icon={FileText}
        title="No notes yet"
        body="Notes are markdown files in this project's _notes folder — readable in any editor, and something the assistant will be able to read and write later."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} strokeWidth={1.75} />
            New note
          </Button>
        }
      />
    )
  }

  const selected = notes.find((note) => note.id === selectedId)

  return (
    <div className="flex h-[calc(100vh-260px)] max-w-[1000px] gap-3">
      <div className="flex w-[220px] shrink-0 flex-col">
        <div className="mb-2 flex gap-1.5">
          {creating ? (
            <TextInput
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={() => !newTitle.trim() && setCreating(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTitle.trim()) create.mutate()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder="Note title"
              className="h-8 text-[12.5px]"
            />
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} strokeWidth={1.75} />
              New note
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => setSelectedId(note.id)}
              className={cn(
                'relative rounded-control px-2.5 py-2 text-left transition-colors duration-150',
                note.id === selectedId ? 'text-ink' : 'text-muted hover:text-ink'
              )}
            >
              {note.id === selectedId && (
                <motion.span
                  layoutId="note-active"
                  transition={transition.layout}
                  className="absolute inset-0 rounded-control bg-raised"
                />
              )}
              <span className="relative z-10 block truncate text-[12.5px]">{note.title}</span>
              <span className="relative z-10 block text-[10.5px] text-faint">
                {formatDate(note.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col rounded-card border border-line bg-surface">
        {selected ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-ink">{selected.title}</p>
                <p className="truncate font-mono text-[10.5px] text-faint">{selected.file}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {dirty ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => save.mutate()}
                    disabled={save.isPending}
                  >
                    {save.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} strokeWidth={2} />
                    )}
                    Save
                  </Button>
                ) : (
                  <span className="text-[11px] text-faint">Saved</span>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-faint transition-colors hover:text-danger"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            {isFetching ? (
              <div className="grid flex-1 place-items-center">
                <Loader2 size={16} className="animate-spin text-faint" />
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setDirty(true)
                }}
                onKeyDown={(e) => {
                  // Ctrl+S is what anyone editing a text file will reach for.
                  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault()
                    if (dirty) save.mutate()
                  }
                }}
                spellCheck
                className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-ink focus:outline-none"
              />
            )}
          </>
        ) : (
          <div className="grid flex-1 place-items-center">
            <p className="text-[12px] text-faint">Select a note</p>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={`Delete ${selected?.title ?? 'note'}?`}
        body="This deletes the markdown file from disk as well. A note is its file, so there is nothing left behind."
      />
    </div>
  )
}
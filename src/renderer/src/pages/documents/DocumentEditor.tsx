import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Clock, Eye, PenLine, TriangleAlert } from 'lucide-react'
import type { DocumentRecord, DocumentStatus } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Markdown } from '@/components/ui/Markdown'
import { useInvalidate } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Editing a generated document.
 *
 * Markdown on the left, what it will look like on the right. Both, rather than
 * one with a toggle, because the whole reason to edit a contract in this app
 * instead of Word is seeing the merge fields resolve — and an unfilled field
 * is highlighted in the preview so it cannot be sent by accident.
 *
 * Saving keeps the previous version. A contract that somebody edits, sends,
 * and then edits again has a history worth having, and it costs a few
 * kilobytes of text.
 */

const STATUSES: { value: DocumentStatus; label: string; tone: string }[] = [
  { value: 'draft', label: 'Draft', tone: 'text-muted' },
  { value: 'sent', label: 'Sent', tone: 'text-ink' },
  { value: 'signed', label: 'Signed', tone: 'text-success' },
  { value: 'declined', label: 'Declined', tone: 'text-danger' }
]

/** Fields still unfilled in the body as it stands, not as it was generated. */
function unfilledIn(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi)].map((m) => m[1]!))].sort()
}

export function DocumentEditor({
  document,
  onClose
}: {
  document: DocumentRecord | null
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [body, setBody] = useState('')
  const [history, setHistory] = useState(false)

  // Reset whenever a different document is opened, so an edit in progress is
  // never carried across into somebody else's contract.
  useEffect(() => {
    setBody(document?.body ?? '')
    setHistory(false)
  }, [document?.id, document?.body])

  const { data: versions = [] } = useQuery({
    queryKey: ['documents', 'versions', document?.id],
    queryFn: () => window.solo.invoke('documents:versions', { id: document!.id }),
    enabled: document !== null && history
  })

  const save = useMutation({
    mutationFn: () => window.solo.invoke('documents:save', { id: document!.id, body }),
    onSuccess: () => invalidate(['documents'])
  })

  const setStatus = useMutation({
    mutationFn: (status: DocumentStatus) =>
      window.solo.invoke('documents:setStatus', { id: document!.id, status }),
    onSuccess: () => invalidate(['documents'])
  })

  const restore = useMutation({
    mutationFn: (versionId: number) =>
      window.solo.invoke('documents:restoreVersion', { id: document!.id, versionId }),
    onSuccess: (updated) => {
      setBody(updated.body)
      setHistory(false)
      invalidate(['documents'])
    }
  })

  const unfilled = unfilledIn(body)
  const dirty = document !== null && body !== document.body

  return (
    <Modal
      open={document !== null}
      onClose={onClose}
      title={document?.title ?? 'Document'}
      description={
        document
          ? `${STATUSES.find((one) => one.value === document.status)?.label}${
              document.statusAt ? ` · ${formatDate(document.statusAt)}` : ''
            }`
          : ''
      }
      width={980}
      footer={
        <>
          <Button variant="ghost" onClick={() => setHistory((open) => !open)}>
            <Clock size={13} strokeWidth={1.75} />
            {history ? 'Hide history' : 'History'}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {dirty ? 'Save' : 'Saved'}
          </Button>
        </>
      }
    >
      {document && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUSES.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() => setStatus.mutate(status.value)}
                className={cn(
                  'rounded-control border px-2.5 py-1 text-[11.5px] transition-colors',
                  document.status === status.value
                    ? 'border-accent bg-accent-subtle text-ink'
                    : 'border-line text-muted hover:bg-hover hover:text-ink'
                )}
              >
                {status.label}
              </button>
            ))}
          </div>

          {unfilled.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-control bg-warning/10 px-2.5 py-2 text-[11.5px] text-warning">
              <TriangleAlert size={13} strokeWidth={1.75} className="mt-px shrink-0" />
              <span>
                {unfilled.length} field{unfilled.length === 1 ? '' : 's'} could not be filled from
                your records: {unfilled.join(', ')}. Fill {unfilled.length === 1 ? 'it' : 'them'} in
                by hand, or add the detail to the client or project and generate again.
              </span>
            </p>
          )}

          {history ? (
            <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto">
              {versions.length === 0 && <p className="text-[12px] text-faint">No history yet.</p>}
              {versions.map((version, index) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-ink">
                      {index === 0 ? 'Current' : version.note || 'Edited'}
                    </p>
                    <p className="text-[11px] text-faint">{version.createdAt}</p>
                  </div>
                  {index > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => restore.mutate(version.id)}
                      // Restoring writes a new version rather than deleting
                      // what came after, so this is always undoable.
                      title="Bring this version back. The current one is kept."
                    >
                      Restore
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid h-[52vh] grid-cols-2 gap-3">
              <label className="flex min-h-0 flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  <PenLine size={12} strokeWidth={1.75} />
                  Markdown
                </span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  spellCheck
                  className="min-h-0 flex-1 resize-none rounded-control border border-line bg-raised p-3 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-focus"
                />
              </label>

              <div className="flex min-h-0 flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  <Eye size={12} strokeWidth={1.75} />
                  Preview
                </span>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-control border border-line p-3">
                  <Markdown text={body} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

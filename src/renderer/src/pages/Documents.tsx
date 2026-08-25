import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { FileText, FolderOpen, Plus, TriangleAlert } from 'lucide-react'
import type { DocumentInput, DocumentRecord } from '@shared/types'
import { DOCUMENT_CATEGORIES } from '@shared/types'
import { Page } from '@/components/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Empty, Pill } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { Expand } from '@/components/ui/Expand'
import { keys, useInvalidate } from '@/lib/api'
import { daysUntil, formatDate, toDateInput } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Expiry is the reason this section exists rather than being a folder: an
 * insurance policy that lapses silently costs real money, so anything close to
 * its date is pushed to the top of the page.
 */
function expiryState(expiryAt: string | null): { label: string; colour: string } | null {
  if (!expiryAt) return null

  const days = daysUntil(expiryAt)
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, colour: '#E5484D' }
  if (days === 0) return { label: 'Expires today', colour: '#E5484D' }
  if (days <= 30) return { label: `${days}d left`, colour: '#F5A623' }
  if (days <= 60) return { label: `${days}d left`, colour: '#8a8a93' }
  return null
}

export function Documents(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [editing, setEditing] = useState<(DocumentInput & { id?: number }) | null>(null)
  const [pendingFile, setPendingFile] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<DocumentRecord | null>(null)

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', { search, category }],
    queryFn: () =>
      window.solo.invoke('documents:list', {
        search: search || undefined,
        category: category ?? undefined
      })
  })

  const add = useMutation({
    mutationFn: (draft: DocumentInput & { sourcePath: string }) =>
      window.solo.invoke('documents:add', draft),
    onSuccess: () => {
      invalidate(['documents'])
      setEditing(null)
      setPendingFile(null)
    }
  })

  const update = useMutation({
    mutationFn: (draft: DocumentInput & { id: number }) =>
      window.solo.invoke('documents:update', { id: draft.id, patch: draft }),
    onSuccess: () => {
      invalidate(['documents'])
      setEditing(null)
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('documents:delete', { id }),
    onSuccess: () => invalidate(['documents'])
  })

  /** Pick the file first: everything else describes a file that already exists. */
  const startAdd = async (): Promise<void> => {
    const [source] = await window.solo.invoke('files:pick', { multiple: false })
    if (!source) return

    setPendingFile(source)
    setEditing({
      title: source.split('\\').pop() ?? '',
      category: 'Business',
      tags: [],
      notes: '',
      expiryAt: null
    })
  }

  const expiring = documents.filter((doc) => expiryState(doc.expiryAt) !== null)

  return (
    <Page
      title="Documents"
      description="Contracts, insurance, certificates and tax paperwork."
      actions={
        <Button variant="primary" onClick={() => void startAdd()}>
          <Plus size={14} strokeWidth={1.75} />
          Add document
        </Button>
      }
    >
      <div className="mb-3 flex gap-2">
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search titles, tags and notes"
          className="max-w-[280px]"
        />
        <Select
          value={category}
          onChange={setCategory}
          placeholder="All categories"
          options={DOCUMENT_CATEGORIES.map((name) => ({ value: name, label: name }))}
          className="w-[180px]"
        />
      </div>

      <AnimatePresence>
        {expiring.length > 0 && (
          <Expand contentClassName="pb-3">
            <Card className="border-warning/30 bg-warning/[0.06]">
              <div className="flex items-start gap-2.5">
                <TriangleAlert size={15} strokeWidth={1.75} className="mt-0.5 text-warning" />
                <div>
                  <p className="text-[13px] text-ink">
                    {expiring.length} document{expiring.length === 1 ? '' : 's'} needs attention
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {expiring.map((doc) => doc.title).join(', ')}
                  </p>
                </div>
              </div>
            </Card>
          </Expand>
        )}
      </AnimatePresence>

      <Swap
        empty={documents.length === 0}
        fallback={
          <Empty
            icon={FileText}
            title={search || category ? 'Nothing matches' : 'No documents yet'}
            body={
              search || category
                ? 'Try a different search or category.'
                : 'Add your insurance, contracts and certificates. Give them an expiry date and SoloWrk will warn you before they lapse.'
            }
            action={
              !search && !category ? (
                <Button variant="primary" onClick={() => void startAdd()}>
                  <Plus size={14} strokeWidth={1.75} />
                  Add a document
                </Button>
              ) : undefined
            }
          />
        }
      >
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2"
        >
          {documents.map((doc) => {
            const expiry = expiryState(doc.expiryAt)

            return (
              <motion.div key={doc.id} variants={listItemVariants}>
                <Card className="flex items-center justify-between gap-4 py-3">
                  <button
                    type="button"
                    onClick={() => void window.solo.invoke('files:open', { path: doc.file })}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <FileText size={16} strokeWidth={1.75} className="shrink-0 text-faint" />
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] text-ink">{doc.title}</p>
                      <p className="truncate font-mono text-[11px] text-faint">{doc.file}</p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2.5">
                    {doc.tags.length > 0 && (
                      <span className="text-[11px] text-faint">{doc.tags.join(' · ')}</span>
                    )}
                    {doc.expiryAt && (
                      <span
                        className={cn('text-[11.5px]', !expiry && 'text-faint')}
                        style={expiry ? { color: expiry.colour } : undefined}
                      >
                        {expiry ? expiry.label : formatDate(doc.expiryAt)}
                      </span>
                    )}
                    <Pill colour="#8a8a93">{doc.category}</Pill>

                    <button
                      type="button"
                      aria-label="Show in Explorer"
                      onClick={() => void window.solo.invoke('files:reveal', { path: doc.file })}
                      className="rounded-control p-1.5 text-faint transition-colors hover:bg-hover hover:text-ink"
                    >
                      <FolderOpen size={13} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ ...doc })}
                      className="text-[11.5px] text-faint transition-colors hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(doc)}
                      className="text-[11.5px] text-faint transition-colors hover:text-danger"
                    >
                      Remove
                    </button>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      </Swap>

      <DocumentModal
        draft={editing}
        pendingFile={pendingFile}
        onChange={setEditing}
        onSave={() => {
          if (!editing) return
          if (editing.id) update.mutate(editing as DocumentInput & { id: number })
          else if (pendingFile) add.mutate({ ...editing, sourcePath: pendingFile })
        }}
        onClose={() => {
          setEditing(null)
          setPendingFile(null)
        }}
        saving={add.isPending || update.isPending}
      />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={`Remove ${deleting?.title ?? ''}?`}
        body="This removes it from the Documents list. The file itself stays in your workspace folder."
        confirmLabel="Remove"
      />
    </Page>
  )
}

function DocumentModal({
  draft,
  pendingFile,
  onChange,
  onSave,
  onClose,
  saving
}: {
  draft: (DocumentInput & { id?: number }) | null
  pendingFile: string | null
  onChange: (draft: (DocumentInput & { id?: number }) | null) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
}): React.JSX.Element {
  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  const set = <K extends keyof DocumentInput>(key: K, value: DocumentInput[K]): void => {
    if (draft) onChange({ ...draft, [key]: value })
  }

  return (
    <Modal
      open={draft !== null}
      onClose={onClose}
      title={draft?.id ? 'Edit document' : 'Add document'}
      description={
        draft?.id
          ? undefined
          : 'The file is copied into your workspace. The original stays where it is.'
      }
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving || !draft?.title?.trim()}>
            {draft?.id ? 'Save changes' : 'Add document'}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-3.5">
          {pendingFile && (
            <p className="truncate rounded-control bg-raised px-3 py-2 font-mono text-[11.5px] text-muted">
              {pendingFile}
            </p>
          )}

          <Field label="Title">
            <TextInput
              autoFocus
              value={draft.title ?? ''}
              onChange={(event) => set('title', event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" hint="Also picks the folder it is filed in.">
              <Select
                value={draft.category ?? 'Business'}
                onChange={(value) => set('category', value ?? 'Business')}
                options={DOCUMENT_CATEGORIES.map((name) => ({ value: name, label: name }))}
              />
            </Field>
            <Field label="Expiry date" hint="Warns you 30 days ahead.">
              <TextInput
                type="date"
                value={toDateInput(draft.expiryAt ?? null)}
                onChange={(event) => set('expiryAt', event.target.value || null)}
              />
            </Field>
          </div>

          <Field label="Client" hint="Optional — for contracts and NDAs.">
            <Select
              value={draft.clientId ?? null}
              onChange={(value) => set('clientId', value)}
              placeholder="Not client-specific"
              options={clients.map((client) => ({ value: client.id, label: client.name }))}
            />
          </Field>

          <Field label="Tags" hint="Comma separated.">
            <TextInput
              value={(draft.tags ?? []).join(', ')}
              onChange={(event) =>
                set(
                  'tags',
                  event.target.value.split(',').map((tag) => tag.trim())
                )
              }
              placeholder="insurance, renewal"
            />
          </Field>

          <Field label="Notes">
            <TextInput
              value={draft.notes ?? ''}
              onChange={(event) => set('notes', event.target.value)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
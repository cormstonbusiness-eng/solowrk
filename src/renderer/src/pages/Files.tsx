import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronRight,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  Pencil,
  Trash2,
  Upload
} from 'lucide-react'
import type { FileEntry } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Empty } from '@/components/ui/Empty'
import { formatDate } from '@/lib/format'
import { listItemVariants, listVariants, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { BulkRename } from './files/BulkRename'
import { Health } from './files/Health'

/**
 * Files: a browser for the workspace folder, not a store of its own.
 *
 * Everything on this page is the real folder on disk. Adding a file here copies
 * it there; a file dropped into the folder in Explorer appears here. There is
 * no import step, no second copy and no database of file records — which is why
 * the only state below is where you are looking (`path`), and why every action
 * ends in a `refetch` rather than in updating a list held in memory.
 *
 * Paths are Windows paths with backslash separators, relative to the workspace
 * root, and the empty string is the root itself. The main process resolves them
 * through `resolveInWorkspace`, which is the boundary that stops any of this
 * reaching the rest of the disk.
 */

/** Icon by extension — a folder of PDFs should be scannable at a glance. */
function iconFor(entry: FileEntry): typeof FileIcon {
  if (entry.isDirectory) return FolderOpen
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(entry.extension))
    return FileImage
  if (['xlsx', 'xls', 'csv'].includes(entry.extension)) return FileSpreadsheet
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(entry.extension)) return FileText
  return FileIcon
}

/**
 * A byte count as something readable, or nothing at all.
 *
 * Zero returns an empty string rather than "0 B", because the rows that report
 * zero are folders, and a size column reading "0 B" beside every folder is
 * noise that looks like a bug.
 *
 * Whole numbers for bytes and one decimal above that: "900 B" and "1.4 MB" are
 * both what somebody would say out loud, where "900.0 B" is not. Clamped to GB
 * so a very large file reads as thousands of gigabytes rather than falling off
 * the end of the unit list.
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${value.toFixed(power === 0 ? 0 : 1)} ${units[power]}`
}

type Tab = 'browse' | 'health'

export function Files(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('browse')
  const [bulk, setBulk] = useState(false)
  const [path, setPath] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<FileEntry | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: entries = [], refetch } = useQuery({
    queryKey: ['files', path],
    queryFn: () => window.solo.invoke('files:list', { path })
  })

  /**
   * Do something to the disk, then show what the disk now says.
   *
   * Every file operation goes through here rather than updating a list in
   * memory, because the folder is shared with Explorer and with the user: an
   * optimistic update would be this page's opinion of a directory it does not
   * own. Refetching is cheap — one directory read — and is always right.
   *
   * Failures land in `error` rather than being thrown. A file operation fails
   * for ordinary reasons — the file is open in Word, the name already exists,
   * the drive is read-only — and each of those deserves the message the main
   * process wrote, in the page, rather than a crash.
   */
  const runAndRefresh = <T,>(promise: Promise<T>): Promise<void> =>
    promise.then(
      () => void refetch(),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : 'That did not work')
    )

  const importFiles = useMutation({
    mutationFn: (sources: string[]) =>
      window.solo.invoke('files:import', { destination: path, sources }),
    onSuccess: () => void refetch(),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Those files could not be imported')
  })

  /**
   * Files dropped from Explorer, copied into the folder being viewed.
   *
   * Copied, never moved: the original stays where it was. Somebody dragging a
   * contract out of their downloads folder is filing a copy, and a file manager
   * that silently removes the thing you dragged is one you stop trusting.
   */
  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragOver(false)

    /*
      Electron removed `File.path`; the preload bridge exposes `webUtils`
      instead. Anything it cannot resolve to a real path comes back as an empty
      string and is dropped here — that is what a dragged selection from a
      browser or another app produces, and it has no file on disk to copy.
    */
    const sources = Array.from(event.dataTransfer.files)
      .map((file) => window.solo.pathForFile(file))
      .filter((source) => source.length > 0)

    if (sources.length > 0) importFiles.mutate(sources)
  }

  /*
    The breadcrumb trail. The empty path is the workspace root and has no
    crumbs of its own — the Workspace button is drawn separately, so splitting
    `''` here would produce one empty crumb sitting next to it.
  */
  const crumbs = path === '' ? [] : path.split('\\')

  return (
    <Page
      title="Files"
      description="Your workspace on disk. Nothing here is in the cloud."
      actions={
        <>
          <div className="mr-1 flex rounded-control border border-line p-0.5">
            {(['browse', 'health'] as Tab[]).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                className={cn(
                  'rounded-[6px] px-2.5 py-1 text-[12px] capitalize',
                  tab === name ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                )}
              >
                {name}
              </button>
            ))}
          </div>

          {tab === 'browse' && (
            <Button
              variant="ghost"
              onClick={() => setBulk(true)}
              title="Rename every file in this folder to one convention"
            >
              <Pencil size={14} strokeWidth={1.75} />
              Rename all
            </Button>
          )}
          <Button variant="outline" onClick={() => setNewFolder('')}>
            <FolderPlus size={14} strokeWidth={1.75} />
            New folder
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void window.solo
                .invoke('files:pick', { multiple: true })
                .then((sources) => sources.length > 0 && importFiles.mutate(sources))
            }
          >
            <Upload size={14} strokeWidth={1.75} />
            Add files
          </Button>
        </>
      }
    >
      {tab === 'health' ? (
        <Health />
      ) : (
        <>
        <div className="mb-3 flex items-center gap-1 text-[12.5px]">
          <button
            type="button"
            onClick={() => setPath('')}
            className={cn(
              'flex items-center gap-1.5 rounded-control px-2 py-1 transition-colors',
              path === '' ? 'text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            )}
          >
            <Home size={13} strokeWidth={1.75} />
            Workspace
          </button>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-faint" />
              <button
                type="button"
                onClick={() => setPath(crumbs.slice(0, index + 1).join('\\'))}
                className={cn(
                  'rounded-control px-2 py-1 transition-colors',
                  index === crumbs.length - 1
                    ? 'text-ink'
                    : 'text-muted hover:bg-raised hover:text-ink'
                )}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'rounded-card border transition-colors duration-150',
            dragOver ? 'border-accent bg-accent/5' : 'border-transparent'
          )}
        >
          {entries.length === 0 ? (
            <Empty
              icon={HardDrive}
              title="Nothing here"
              body="Drop files from Explorer anywhere on this page to copy them in, or use Add files. Originals stay where they are."
            />
          ) : (
            <motion.div
              variants={listVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col gap-0.5"
            >
              <AnimatePresence initial={false}>
                {entries.map((entry) => {
                  const Icon = iconFor(entry)

                  return (
                    <motion.div
                      key={entry.path}
                      layout
                      variants={listItemVariants}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={transition.layout}
                      className="group flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors duration-150 hover:bg-raised"
                    >
                      {/*
                        Explorer's conventions, because this is a file browser
                        and muscle memory is the whole interface: one click
                        opens a folder, and a file needs a double click to open
                        in whatever Windows associates with it. A single click
                        launching an application would make scanning a folder
                        hazardous.
                      */}
                      <button
                        type="button"
                        onDoubleClick={() =>
                          entry.isDirectory
                            ? setPath(entry.path)
                            : void runAndRefresh(window.solo.invoke('files:open', { path: entry.path }))
                        }
                        onClick={() => entry.isDirectory && setPath(entry.path)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <Icon
                          size={16}
                          strokeWidth={1.75}
                          className={entry.isDirectory ? 'text-accent' : 'text-faint'}
                        />
                        <span className="truncate text-[13px] text-ink">{entry.name}</span>
                      </button>

                      <span className="numeric shrink-0 text-[11px] text-faint">
                        {formatSize(entry.size)}
                      </span>
                      <span className="w-[92px] shrink-0 text-right text-[11px] text-faint">
                        {formatDate(entry.modifiedAt)}
                      </span>

                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <IconButton
                          label="Show in Explorer"
                          onClick={() =>
                            void window.solo.invoke('files:reveal', { path: entry.path })
                          }
                        >
                          <FolderOpen size={13} strokeWidth={1.75} />
                        </IconButton>
                        <IconButton
                          label="Rename"
                          onClick={() => {
                            setRenaming(entry)
                            setRenameValue(entry.name)
                          }}
                        >
                          <Pencil size={13} strokeWidth={1.75} />
                        </IconButton>
                        <IconButton label="Delete" danger onClick={() => setDeleting(entry)}>
                          <Trash2 size={13} strokeWidth={1.75} />
                        </IconButton>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </motion.p>
        )}

        <Modal
          open={renaming !== null}
          onClose={() => setRenaming(null)}
          title="Rename"
          width={420}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (renaming)
                    void runAndRefresh(
                      window.solo.invoke('files:rename', {
                        path: renaming.path,
                        name: renameValue
                      })
                    )
                  setRenaming(null)
                }}
                disabled={!renameValue.trim()}
              >
                Rename
              </Button>
            </>
          }
        >
          <Field label="Name">
            <TextInput
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </Field>
        </Modal>

        <Modal
          open={newFolder !== null}
          onClose={() => setNewFolder(null)}
          title="New folder"
          width={420}
          footer={
            <>
              <Button variant="ghost" onClick={() => setNewFolder(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (newFolder)
                    void runAndRefresh(
                      window.solo.invoke('files:createFolder', { parent: path, name: newFolder })
                    )
                  setNewFolder(null)
                }}
                disabled={!newFolder?.trim()}
              >
                Create
              </Button>
            </>
          }
        >
          <Field label="Folder name">
            <TextInput
              autoFocus
              value={newFolder ?? ''}
              onChange={(event) => setNewFolder(event.target.value)}
            />
          </Field>
        </Modal>

        <ConfirmModal
          open={deleting !== null}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            if (deleting)
              void runAndRefresh(window.solo.invoke('files:trash', { path: deleting.path }))
          }}
          title={`Delete ${deleting?.name ?? ''}?`}
          body="This goes to the Windows Recycle Bin, so you can restore it if you change your mind."
          confirmLabel="Move to Recycle Bin"
        />
        </>
      )}

      <BulkRename open={bulk} folder={path} onClose={() => setBulk(false)} />
    </Page>
  )
}

function IconButton({
  label,
  onClick,
  danger,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'rounded-control p-1.5 text-faint transition-colors duration-150',
        danger ? 'hover:bg-danger/15 hover:text-danger' : 'hover:bg-hover hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}
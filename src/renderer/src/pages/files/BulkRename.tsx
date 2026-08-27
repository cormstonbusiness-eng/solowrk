import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { RENAME_TOKENS } from '@shared/structure'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { keys, useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Renaming a folder of files at once.
 *
 * Always previewed. A bulk rename is the most destructive-feeling thing in
 * this app — two hundred filenames change and nobody remembers what they were
 * — so every new name is worked out and shown before anything is touched, and
 * a collision is a warning here rather than a lost file on disk.
 *
 * Files with a problem are skipped rather than attempted, so one bad name
 * cannot take a good rename halfway and stop.
 */
export function BulkRename({
  open,
  folder,
  onClose
}: {
  open: boolean
  folder: string
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [pattern, setPattern] = useState('{client}_{project}_{ref}')
  const [projectId, setProjectId] = useState<number | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const { data: plan = [] } = useQuery({
    queryKey: ['structure', 'rename', folder, pattern, projectId],
    queryFn: () =>
      window.solo.invoke('structure:planRename', {
        folder,
        pattern,
        projectId: projectId ?? undefined
      }),
    enabled: open && folder !== ''
  })

  const apply = useMutation({
    mutationFn: () =>
      window.solo.invoke('structure:applyRename', {
        folder,
        pattern,
        projectId: projectId ?? undefined
      }),
    onSuccess: () => {
      invalidate(['files', 'structure'])
      onClose()
    }
  })

  const problems = plan.filter((one) => one.problem !== null)
  const ready = plan.length - problems.length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename these files"
      description={folder || 'This folder'}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => apply.mutate()} disabled={ready === 0 || apply.isPending}>
            Rename {ready} file{ready === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pattern">
            <TextInput value={pattern} onChange={(event) => setPattern(event.target.value)} />
          </Field>
          <Field label="Project" hint="Fills {client} and {project}.">
            <Select
              value={projectId}
              onChange={setProjectId}
              placeholder="None"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {RENAME_TOKENS.map((token) => (
            <button
              key={token.key}
              type="button"
              onClick={() => setPattern((current) => `${current}{${token.key}}`)}
              title={token.label}
              className="rounded-control border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              {`{${token.key}}`}
            </button>
          ))}
        </div>

        {problems.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-control bg-warning/10 px-2.5 py-2 text-[11.5px] text-warning">
            <TriangleAlert size={13} strokeWidth={1.75} className="mt-px shrink-0" />
            <span>
              {problems.length} file{problems.length === 1 ? '' : 's'} will be left alone. Nothing
              is overwritten.
            </span>
          </p>
        )}

        <div className="flex max-h-[42vh] flex-col gap-0.5 overflow-y-auto">
          {plan.length === 0 && <p className="text-[12px] text-faint">No files in this folder.</p>}

          {plan.map((one) => (
            <div
              key={one.from}
              className={cn(
                'flex items-center gap-2 rounded-control px-2 py-1.5 text-[11.5px]',
                one.problem !== null && 'bg-warning/[0.06]'
              )}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-faint">{one.from}</span>
              <ArrowRight size={12} strokeWidth={1.75} className="shrink-0 text-faint" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-mono',
                  one.problem !== null ? 'text-warning' : 'text-ink'
                )}
              >
                {one.problem ?? one.to}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

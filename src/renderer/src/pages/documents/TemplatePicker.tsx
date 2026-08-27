import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import type { DocumentRecord } from '@shared/types'
import { DOCUMENT_KIND_LABELS } from '@shared/types'
import { LEGAL_NOTE } from '@shared/starterTemplates'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Markdown } from '@/components/ui/Markdown'
import { keys, useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Picking a template and a project, and seeing the result before committing.
 *
 * The preview is the point. A contract generated blind is a contract somebody
 * opens, finds three unfilled fields in, deletes and generates again — so the
 * fields that cannot be answered are shown *here*, while choosing a different
 * project or filling in the client record is still the cheap fix.
 */

const AGREEMENTS = new Set(['contract', 'terms', 'notice', 'variation'])

export function TemplatePicker({
  open,
  onClose,
  onGenerated
}: {
  open: boolean
  onClose: () => void
  onGenerated: (document: DocumentRecord) => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)

  const { data: templates = [] } = useQuery({
    queryKey: ['docTemplates'],
    queryFn: () => window.solo.invoke('docTemplates:list')
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  // The first template, so the panel is never blank on opening.
  useEffect(() => {
    if (open && templateId === null && templates.length > 0) setTemplateId(templates[0]!.id)
  }, [open, templateId, templates])

  const { data: preview } = useQuery({
    queryKey: ['docTemplates', 'preview', templateId, projectId],
    queryFn: () =>
      window.solo.invoke('docTemplates:preview', { id: templateId!, projectId }),
    enabled: open && templateId !== null
  })

  const generate = useMutation({
    mutationFn: () =>
      window.solo.invoke('documents:generate', { templateId: templateId!, projectId }),
    onSuccess: (made) => {
      invalidate(['documents'])
      onGenerated(made.document)
      onClose()
    }
  })

  const chosen = templates.find((one) => one.id === templateId)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New from template"
      width={900}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => generate.mutate()}
            disabled={templateId === null || generate.isPending}
          >
            Create document
          </Button>
        </>
      }
    >
      <div className="grid h-[56vh] grid-cols-[240px_1fr] gap-3">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setTemplateId(template.id)}
                className={cn(
                  'rounded-control border px-2.5 py-2 text-left transition-colors',
                  templateId === template.id
                    ? 'border-accent bg-accent-subtle'
                    : 'border-line hover:bg-hover'
                )}
              >
                <p className="text-[12.5px] text-ink">{template.name}</p>
                <p className="text-[11px] text-faint">
                  {DOCUMENT_KIND_LABELS[template.kind]}
                </p>
              </button>
            ))}
          </div>

          <Field label="For which project?" hint="Its client is picked up automatically.">
            <Select
              value={projectId}
              onChange={setProjectId}
              placeholder="No project"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          {chosen && <p className="text-[11.5px] text-muted">{chosen.summary}</p>}

          {preview && preview.unresolved.length > 0 && (
            // Said here, where changing the project or filling in the client
            // record is still the cheap fix.
            <p className="rounded-control bg-warning/10 px-2.5 py-2 text-[11.5px] text-warning">
              {preview.unresolved.join(', ')} {preview.unresolved.length === 1 ? 'has' : 'have'} no
              value in your records. {preview.unresolved.length === 1 ? 'It' : 'They'} will be left
              marked in the document for you to fill in.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-control border border-line p-3.5">
            {preview ? (
              <Markdown text={preview.text} />
            ) : (
              <div className="grid h-full place-items-center">
                <FileText size={20} strokeWidth={1.5} className="text-faint" />
              </div>
            )}
          </div>

          {chosen && AGREEMENTS.has(chosen.kind) && (
            <p className="text-[11px] text-faint">{LEGAL_NOTE}</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

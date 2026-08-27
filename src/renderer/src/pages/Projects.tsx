import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Archive, ArrowLeft, BookMarked, FolderKanban, FolderOpen, Plus, Trash2 } from 'lucide-react'
import type { ProjectInput, ProjectStatus } from '@shared/types'
import { PROJECT_STATUSES } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Empty, Pill } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { useEntityActions } from '@/hooks/useEntityActions'
import { formatDate, formatMoney, toDateInput } from '@/lib/format'
import { TaskList } from './tasks/TaskList'
import { ProjectNotes } from './ProjectNotes'
import { ProjectBoard } from './projects/Board'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'
import { Milestones } from './projects/Milestones'

const BLANK: ProjectInput = {
  name: '',
  description: '',
  status: 'active',
  clientId: null,
  rate: null,
  budget: null,
  dueOn: null,
  colour: DEFAULT_ENTITY_COLOUR
}

function statusMeta(status: ProjectStatus): { label: string; colour: string } {
  const match = PROJECT_STATUSES.find((s) => s.value === status)
  return { label: match?.label ?? status, colour: match?.colour ?? '#8a8a93' }
}

export function Projects(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const clientFilter = searchParams.get('client')
  const [editing, setEditing] = useState<(ProjectInput & { id?: number }) | null>(null)

  const archive = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke('projects:update', { id, patch: { archived: true } }),
    onSuccess: () => invalidate(['projects'])
  })

  useOpenParam('new', () => setEditing({ ...BLANK }))

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(clientFilter ? Number(clientFilter) : undefined),
    queryFn: () =>
      window.solo.invoke(
        'projects:list',
        clientFilter ? { clientId: Number(clientFilter) } : {}
      )
  })

  const save = useMutation({
    mutationFn: (draft: ProjectInput & { id?: number }) =>
      draft.id
        ? window.solo.invoke('projects:update', { id: draft.id, patch: draft })
        : window.solo.invoke('projects:create', draft),
    onSuccess: () => {
      invalidate(['projects', 'clients'])
      setEditing(null)
    }
  })


  return (
    <Page
      title="Projects"
      description="Every job, its folder, its tasks and its budget."
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/projects/archived')}>
            <Archive size={14} strokeWidth={1.75} />
            Archived
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              setEditing({
                ...BLANK,
                clientId: clientFilter ? Number(clientFilter) : null
              })
            }
          >
            <Plus size={14} strokeWidth={1.75} />
            New project
          </Button>
        </>
      }
    >
      <Swap
        empty={projects.length === 0}
        fallback={
          <Empty
            icon={FolderKanban}
            title="No projects yet"
            body="A project gets its own folder tree on disk — brief, assets, working files and deliverables — plus its own tasks and notes."
            action={
              <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
                <Plus size={14} strokeWidth={1.75} />
                Create a project
              </Button>
            }
          />
        }
      >
        <ProjectBoard
          projects={projects}
          onMove={(project, status) => save.mutate({ ...project, id: project.id, status })}
          onArchive={(project) => archive.mutate(project.id)}
        />
      </Swap>

      <ProjectModal
        draft={editing}
        onChange={setEditing}
        onSave={() => editing && save.mutate(editing)}
        saving={save.isPending}
      />
    </Page>
  )
}

function ProjectModal({
  draft,
  onChange,
  onSave,
  saving
}: {
  draft: (ProjectInput & { id?: number }) | null
  onChange: (draft: (ProjectInput & { id?: number }) | null) => void
  onSave: () => void
  saving: boolean
}): React.JSX.Element {
  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  const { data: templates = [] } = useQuery({
    queryKey: keys.templates,
    queryFn: () => window.solo.invoke('templates:list')
  })

  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]): void => {
    if (draft) onChange({ ...draft, [key]: value })
  }

  return (
    <Modal
      open={draft !== null}
      onClose={() => onChange(null)}
      title={draft?.id ? 'Edit project' : 'New project'}
      description={
        draft?.id ? undefined : 'Creates a folder tree for the work inside the client’s folder.'
      }
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => onChange(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving || !draft?.name.trim()}>
            {draft?.id ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-3.5">
          <Field label="Project name">
            <TextInput
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Brand identity"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Client" hint="Leave blank for internal work.">
              <Select
                value={draft.clientId ?? null}
                onChange={(value) => set('clientId', value)}
                placeholder="Internal"
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Status">
              <Select
                value={draft.status ?? 'active'}
                onChange={(value) => set('status', (value ?? 'active') as ProjectStatus)}
                options={PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              />
            </Field>
          </div>

          {!draft.id && templates.length > 0 && (
            <Field label="Start from a template" hint="Recreates its folders and task list.">
              <Select
                value={draft.templateId ?? null}
                onChange={(value) => set('templateId', value)}
                placeholder="Blank project"
                options={templates.map((t) => ({ value: t.id, label: t.name }))}
              />
            </Field>
          )}

          <Field label="Description">
            <TextInput
              value={draft.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Rate" hint="Blank uses the client’s.">
              <MoneyInput
                pence={draft.rate ?? 0}
                onChangePence={(pence) => set('rate', pence === 0 ? null : pence)}
              />
            </Field>
            <Field label="Budget">
              <MoneyInput
                pence={draft.budget ?? 0}
                onChangePence={(pence) => set('budget', pence === 0 ? null : pence)}
              />
            </Field>
            <Field label="Due date">
              <TextInput
                type="date"
                value={toDateInput(draft.dueOn ?? null)}
                onChange={(e) => set('dueOn', e.target.value || null)}
              />
            </Field>
          </div>

          <Field label="Colour">
            <ColourPicker
              value={draft.colour ?? DEFAULT_ENTITY_COLOUR}
              onChange={(colour) => set('colour', colour)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}

type Tab = 'tasks' | 'notes' | 'details'

export function ProjectDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const [tab, setTab] = useState<Tab>('tasks')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [editing, setEditing] = useState<(ProjectInput & { id?: number }) | null>(null)

  const { data: project } = useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => window.solo.invoke('projects:get', { id: projectId }),
    enabled: Number.isFinite(projectId)
  })

  const save = useMutation({
    mutationFn: (draft: ProjectInput & { id?: number }) =>
      window.solo.invoke('projects:update', { id: projectId, patch: draft }),
    onSuccess: () => {
      invalidate(['projects'])
      setEditing(null)
    }
  })

  const actions = useEntityActions()

  const remove = useMutation({
    mutationFn: () =>
      actions.remove({ type: 'project', id: projectId }, project?.name ?? 'project'),
    onSuccess: () => navigate('/projects')
  })

  const saveTemplate = useMutation({
    mutationFn: (name: string) =>
      window.solo.invoke('templates:fromProject', { projectId, name }),
    onSuccess: () => {
      invalidate(['templates'])
      setTemplateName(null)
    }
  })

  if (!project) return <Page title="Project" />

  const status = statusMeta(project.status)

  return (
    <Page
      title={project.name}
      description={project.description || undefined}
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/projects')}>
            <ArrowLeft size={14} strokeWidth={1.75} />
            All projects
          </Button>
          <Button
            variant="outline"
            onClick={() => void window.solo.invoke('projects:reveal', { id: projectId })}
          >
            <FolderOpen size={14} strokeWidth={1.75} />
            Folder
          </Button>
          <Button variant="secondary" onClick={() => setEditing({ ...project })}>
            Edit
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2 border-b border-line">
        {(['tasks', 'notes', 'details'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className="relative px-3 py-2 text-[13px] capitalize transition-colors duration-150"
          >
            <span className={tab === name ? 'text-ink' : 'text-muted hover:text-ink'}>{name}</span>
            {tab === name && (
              <motion.span
                layoutId="project-tab"
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'tasks' && <TaskList projectId={projectId} />}
      {tab === 'notes' && <ProjectNotes projectId={projectId} />}

      {tab === 'details' && (
        <div className="grid max-w-[760px] grid-cols-2 gap-3">
          <Card>
            <CardHeader title="Status" />
            <Pill colour={status.colour}>{status.label}</Pill>
            <p className="mt-3 text-[12px] text-muted">Due {formatDate(project.dueOn)}</p>
          </Card>
          <Card>
            <CardHeader title="Money" />
            <p className="text-[13px] text-ink">Budget {formatMoney(project.budget)}</p>
            <p className="mt-1 text-[12px] text-muted">
              Rate {project.rate === null ? 'inherited' : formatMoney(project.rate)}
            </p>
          </Card>
          <Milestones projectId={projectId} />

          <Card className="col-span-2">
            <CardHeader
              title="Folder"
              action={
                <Button variant="ghost" size="sm" onClick={() => setTemplateName(project.name)}>
                  <BookMarked size={13} strokeWidth={1.75} />
                  Save as template
                </Button>
              }
            />
            <p className="font-mono text-[11.5px] break-all text-muted">{project.folder}</p>
          </Card>
          <Card className="col-span-2">
            <CardHeader title="Danger zone" />
            <div className="flex items-center justify-between gap-4">
              <p className="text-[12px] text-muted">
                Removes the project and its tasks from SoloWrk. Files stay on disk.
              </p>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} strokeWidth={1.75} />
                Delete project
              </Button>
            </div>
          </Card>
        </div>
      )}

      <ProjectModal
        draft={editing}
        onChange={setEditing}
        onSave={() => editing && save.mutate(editing)}
        saving={save.isPending}
      />

      <Modal
        open={templateName !== null}
        onClose={() => setTemplateName(null)}
        title="Save as template"
        description="Captures this project's folder structure and its task list, with every task reset to “to do”."
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTemplateName(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => templateName && saveTemplate.mutate(templateName)}
              disabled={!templateName?.trim()}
            >
              Save template
            </Button>
          </>
        }
      >
        <Field label="Template name">
          <TextInput
            autoFocus
            value={templateName ?? ''}
            onChange={(e) => setTemplateName(e.target.value)}
          />
        </Field>
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={`Delete ${project.name}?`}
        body="The project, its tasks and its notes are removed from SoloWrk. The folder and every file inside it stays on disk."
      />
    </Page>
  )
}
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Archive, ArrowLeft, BookMarked, FolderKanban, FolderOpen, Plus, Trash2 } from 'lucide-react'
import type { ProjectInput, ProjectStatus, ProjectSummary } from '@shared/types'
import { PROJECT_STATUSES } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, TextInput } from '@/components/ui/Field'
import { ColourPicker, Select } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Empty, Pill } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { HarvestOffer } from './projects/HarvestOffer'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { useEntityActions } from '@/hooks/useEntityActions'
import { formatDate, formatMoney, toDateInput } from '@/lib/format'
import { TaskList } from './tasks/TaskList'
import { ProjectNotes } from './ProjectNotes'
import { ProjectBoard } from './projects/Board'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'
import { Milestones } from './projects/Milestones'

/**
 * Projects: the list, one project, and the form that makes both.
 *
 * Three components live here because they share one shape of data. `Projects`
 * is the board of every job; `ProjectDetail` is one of them with its tasks,
 * notes and figures; `ProjectModal` is the create-and-edit form, used by both
 * so a project cannot be described one way when it is made and another when it
 * is changed.
 *
 * A project is not only a database row. Creating one builds a folder tree on
 * disk inside its client's folder, which is why the copy throughout talks about
 * folders and why deleting says so carefully: the record goes, the files stay.
 * The main process owns all of that; this file only ever asks.
 */

/**
 * A new project before anybody has typed anything.
 *
 * Spread rather than mutated at every call site (`{ ...BLANK }`), so an
 * abandoned form cannot leave half a project behind for the next one to
 * inherit. `status` starts as active because somebody making a project is
 * almost always about to start it.
 */
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

/**
 * The label and colour for a status, falling back rather than throwing.
 *
 * A status that is not in `PROJECT_STATUSES` still renders — as its own raw
 * value in grey. That case arrives when a database written by a newer build is
 * opened by an older one, and a project the app cannot name is better than a
 * page that will not draw.
 */
function statusMeta(status: ProjectStatus): { label: string; colour: string } {
  const match = PROJECT_STATUSES.find((s) => s.value === status)
  return { label: match?.label ?? status, colour: match?.colour ?? '#8a8a93' }
}

/** Every project, as a board grouped by status. */
export function Projects(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  /*
    `?client=12` narrows the page to one client's work, and is how the client
    page links here. Kept in the URL rather than in state so the filtered view
    can be linked to and survives a reload — and so the query key below changes
    with it, which is what makes the two lists separate caches rather than one
    that keeps overwriting itself.
  */
  const clientFilter = searchParams.get('client')
  const [editing, setEditing] = useState<(ProjectInput & { id?: number }) | null>(null)
  const [justFinished, setJustFinished] = useState<ProjectSummary | null>(null)

  const archive = useMutation({
    mutationFn: (id: number) =>
      window.solo.invoke('projects:update', { id, patch: { archived: true } }),
    onSuccess: () => invalidate(['projects'])
  })

  /*
    `?new=1` opens the form on arrival. The dashboard's New project button and
    the command palette both navigate here with it rather than reaching into
    this component's state, so there is one way to open the form and it works
    from anywhere in the app — including a link somebody has bookmarked.
  */
  useOpenParam('new', () => setEditing({ ...BLANK }))

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(clientFilter ? Number(clientFilter) : undefined),
    queryFn: () =>
      window.solo.invoke(
        'projects:list',
        clientFilter ? { clientId: Number(clientFilter) } : {}
      )
  })

  /**
   * One mutation for create and edit, told apart by whether the draft has an id.
   *
   * `clients` is invalidated alongside `projects` because a client row carries
   * its project count and its totals; changing a project's client would
   * otherwise leave both the old and the new one showing yesterday's numbers
   * until something else happened to refetch them.
   */
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
          onMove={(project, status) => {
            save.mutate({ ...project, id: project.id, status })
            // §9.2: the only moment the details are fresh. Offered, never done.
            if (status === 'completed') setJustFinished(project)
          }}
          onArchive={(project) => archive.mutate(project.id)}
        />
      </Swap>

      <HarvestOffer project={justFinished} onClose={() => setJustFinished(null)} />

      <ProjectModal
        draft={editing}
        onChange={setEditing}
        onSave={() => editing && save.mutate(editing)}
        saving={save.isPending}
      />
    </Page>
  )
}

/**
 * The create-and-edit form.
 *
 * Controlled entirely from outside: it holds no draft of its own, so the page
 * that opened it owns what is being edited and there is no second copy to fall
 * out of step. `draft === null` is what closes it.
 */
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

          {/*
            Only when creating, and only if templates exist.

            A template seeds the folder tree and the opening task list, which
            are both things that happen once, at creation. Offering it on an
            existing project would be a control that either does nothing or
            does something alarming to work already underway.
          */}
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

          {/*
            Empty and zero are the same thing to `MoneyInput`, and both mean
            "not set" here rather than "free". A rate of null falls through to
            the client's rate and then to the default in Settings — see the
            Time guide — so storing 0 would silently price every hour on this
            project at nothing.
          */}
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

/**
 * One project: its tasks, its notes, and the figures behind it.
 *
 * Tasks first because that is what somebody opening a job wants to see. Details
 * — money, folder, deletion — sits last: it is read once when the project is
 * set up and rarely again.
 */
export function ProjectDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()

  /*
    From the URL, so it is a string and may be nonsense. `Number('abc')` is
    NaN, which is why the query below is guarded with `Number.isFinite` rather
    than trusting the route to only ever produce digits — a hand-typed or stale
    link should show an empty page, not fire a request for project NaN.
  */
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

  /*
    An empty page rather than a spinner. The fetch is from a local database and
    is usually done within a frame or two; a spinner would appear as a flash on
    every navigation and read as slowness the app does not actually have. This
    is also the state a deleted or mistyped project id lands in.
  */
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
            {/*
              One element with a shared `layoutId`, not three that fade. Motion
              sees the same node move between tabs and slides the underline
              across, which is what makes the tabs feel connected rather than
              like three separate lights switching on and off.
            */}
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
          {/*
            The wording here is the whole point of the section, and it is the
            truth rather than reassurance: deleting removes the project, its
            tasks and its notes from the database and does not touch the folder
            or a single file in it. Somebody who deletes a project and then goes
            looking for the deliverables must find them exactly where they were.
          */}
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
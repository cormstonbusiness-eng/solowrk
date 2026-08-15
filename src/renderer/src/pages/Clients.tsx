import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowLeft, FolderKanban, Mail, Phone, Plus, Trash2, Users } from 'lucide-react'
import type { ClientInput } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput } from '@/components/ui/Field'
import { ColourPicker } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Dot, Empty } from '@/components/ui/Empty'
import { keys, useInvalidate } from '@/lib/api'
import { formatRate } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'

const BLANK: ClientInput = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  vatNumber: '',
  defaultRate: null,
  paymentTermsDays: null,
  colour: '#6E56CF'
}

export function Clients(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState<ClientInput & { id?: number } | null>(null)

  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  const save = useMutation({
    mutationFn: (draft: ClientInput & { id?: number }) =>
      draft.id
        ? window.solo.invoke('clients:update', { id: draft.id, patch: draft })
        : window.solo.invoke('clients:create', draft),
    onSuccess: () => {
      invalidate(['clients', 'projects'])
      setEditing(null)
    }
  })

  return (
    <Page
      title="Clients"
      description="Who you work for, and everything filed against them."
      actions={
        <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
          <Plus size={14} strokeWidth={1.75} />
          New client
        </Button>
      }
    >
      {clients.length === 0 ? (
        <Empty
          icon={Users}
          title="No clients yet"
          body="Adding a client creates a folder for them in your workspace, and gives their projects somewhere to live."
          action={
            <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
              <Plus size={14} strokeWidth={1.75} />
              Add your first client
            </Button>
          }
        />
      ) : (
        <motion.div
          variants={listVariants}
          initial="initial"
          animate="animate"
          className="grid grid-cols-3 gap-3"
        >
          {clients.map((client) => (
            <motion.div key={client.id} variants={listItemVariants}>
              <Link to={`/clients/${client.id}`}>
                <Card className="h-full transition-colors duration-150 hover:border-line-strong">
                  <div className="mb-2 flex items-center gap-2">
                    <Dot colour={client.colour} />
                    <p className="truncate text-[14px] font-medium text-ink">{client.name}</p>
                  </div>
                  {client.contactName && (
                    <p className="truncate text-[12px] text-muted">{client.contactName}</p>
                  )}
                  <p className="mt-3 text-[11px] text-faint">
                    {formatRate(client.defaultRate)} · {client.paymentTermsDays ?? '—'} day terms
                  </p>
                </Card>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}

      <ClientModal
        draft={editing}
        onChange={setEditing}
        onSave={() => editing && save.mutate(editing)}
        saving={save.isPending}
      />
    </Page>
  )
}

function ClientModal({
  draft,
  onChange,
  onSave,
  saving
}: {
  draft: (ClientInput & { id?: number }) | null
  onChange: (draft: (ClientInput & { id?: number }) | null) => void
  onSave: () => void
  saving: boolean
}): React.JSX.Element {
  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]): void => {
    if (draft) onChange({ ...draft, [key]: value })
  }

  return (
    <Modal
      open={draft !== null}
      onClose={() => onChange(null)}
      title={draft?.id ? 'Edit client' : 'New client'}
      description={
        draft?.id
          ? 'Renaming also renames their folder, when nothing inside it is open.'
          : 'A folder is created for them in your workspace.'
      }
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => onChange(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saving || !draft?.name.trim()}
          >
            {draft?.id ? 'Save changes' : 'Create client'}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-3.5">
          <Field label="Client name">
            <TextInput
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Acme Ltd"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name">
              <TextInput
                value={draft.contactName ?? ''}
                onChange={(e) => set('contactName', e.target.value)}
              />
            </Field>
            <Field label="Email">
              <TextInput
                type="email"
                value={draft.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <TextInput
                value={draft.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
              />
            </Field>
            <Field label="VAT number">
              <TextInput
                value={draft.vatNumber ?? ''}
                onChange={(e) => set('vatNumber', e.target.value)}
              />
            </Field>
          </div>

          <Field label="Address">
            <TextInput
              value={draft.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate" hint="Blank uses your default from Settings.">
              <MoneyInput
                pence={draft.defaultRate ?? 0}
                onChangePence={(pence) => set('defaultRate', pence === 0 ? null : pence)}
              />
            </Field>
            <Field label="Payment terms" hint="Blank uses your default.">
              <NumberInput
                suffix="days"
                min={0}
                value={draft.paymentTermsDays ?? 0}
                onChangeValue={(value) => set('paymentTermsDays', value === 0 ? null : value)}
              />
            </Field>
          </div>

          <Field label="Colour">
            <ColourPicker
              value={draft.colour ?? '#6E56CF'}
              onChange={(colour) => set('colour', colour)}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}

export function ClientDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const clientId = Number(id)
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: client } = useQuery({
    queryKey: keys.client(clientId),
    queryFn: () => window.solo.invoke('clients:get', { id: clientId }),
    enabled: Number.isFinite(clientId)
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(clientId),
    queryFn: () => window.solo.invoke('projects:list', { clientId }),
    enabled: Number.isFinite(clientId)
  })

  const remove = useMutation({
    mutationFn: () => window.solo.invoke('clients:delete', { id: clientId }),
    onSuccess: () => {
      invalidate(['clients', 'projects'])
      navigate('/clients')
    }
  })

  if (!client) return <Page title="Client" />

  return (
    <Page
      title={client.name}
      description={client.contactName || 'No contact name'}
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('/clients')}>
            <ArrowLeft size={14} strokeWidth={1.75} />
            All clients
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} strokeWidth={1.75} />
            Delete
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader title="Contact" />
          <div className="flex flex-col gap-2 text-[12.5px]">
            <Detail icon={Mail} value={client.email} />
            <Detail icon={Phone} value={client.phone} />
            {client.address && <p className="text-muted">{client.address}</p>}
            {client.vatNumber && <p className="text-faint">VAT {client.vatNumber}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Terms" />
          <p className="text-[13px] text-ink">{formatRate(client.defaultRate)}</p>
          <p className="mt-1 text-[12px] text-muted">
            {client.paymentTermsDays === null
              ? 'Default payment terms'
              : `${client.paymentTermsDays} day payment terms`}
          </p>
          <p className="mt-3 text-[11px] text-faint">Folder: {client.folder}</p>
        </Card>

        <Card>
          <CardHeader title="Lifetime value" />
          <p className="numeric text-[22px] font-medium text-faint">—</p>
          <p className="mt-1 text-[11px] text-faint">Available once invoicing lands in phase 4.</p>
        </Card>
      </div>

      <div className="mt-3">
        <Card>
          <CardHeader
            title={`Projects (${projects.length})`}
            action={
              <Link to={`/projects?client=${client.id}`}>
                <Button variant="ghost" size="sm">
                  <FolderKanban size={13} strokeWidth={1.75} />
                  Open projects
                </Button>
              </Link>
            }
          />
          {projects.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-faint">
              No projects for this client yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {projects.map((project) => (
                <Link key={project.id} to={`/projects/${project.id}`}>
                  <div className="flex items-center justify-between rounded-control bg-raised px-3 py-2 transition-colors hover:bg-hover">
                    <div className="flex items-center gap-2">
                      <Dot colour={project.colour} />
                      <span className="text-[13px] text-ink">{project.name}</span>
                    </div>
                    <span className="text-[11px] text-faint">
                      {project.openTaskCount} open of {project.taskCount}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={`Delete ${client.name}?`}
        body="This removes the client and their projects from Solo. Their folder and every file inside it stays on disk untouched."
      />
    </Page>
  )
}

function Detail({
  icon: Icon,
  value
}: {
  icon: typeof Mail
  value: string
}): React.JSX.Element {
  if (!value) return <></>
  return (
    <p className="flex items-center gap-2 text-muted">
      <Icon size={13} strokeWidth={1.75} className="shrink-0 text-faint" />
      <span className="truncate">{value}</span>
    </p>
  )
}
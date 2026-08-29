import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileText,
  FolderKanban,
  Loader2,
  Lock,
  Mail,
  Phone,
  Plus,
  Send,
  Trash2,
  Users
} from 'lucide-react'
import type { ClientInput, ClientStatus } from '@shared/types'
import { CLIENT_STATUSES } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput } from '@/components/ui/Field'
import { ColourPicker } from '@/components/ui/Select'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Dot, Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { Inspect } from '@/components/detail/Inspect'
import { Toolbar } from '@/components/list/Toolbar'
import { SavedViews } from '@/components/list/SavedViews'
import { useListState } from '@/hooks/useListState'
import { useTagFilter } from '@/hooks/useTagFilter'
import { useEntityActions } from '@/hooks/useEntityActions'
import { keys, useInvalidate } from '@/lib/api'
import { useOpenParam } from '@/hooks/useOpenParam'
import { formatMoney, formatRate } from '@/lib/format'
import { useFeature } from '@/lib/features'
import { raiseLimit } from '@/lib/limits'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { DEFAULT_ENTITY_COLOUR } from '@shared/types'

const BLANK: ClientInput = {
  name: '',
  status: 'interested',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  vatNumber: '',
  defaultRate: null,
  paymentTermsDays: null,
  colour: DEFAULT_ENTITY_COLOUR
}

/** The directory columns, in reading order. */
type SortKey = 'name' | 'contactName' | 'email' | 'defaultRate' | 'paymentTermsDays' | 'status'

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Client' },
  { key: 'contactName', label: 'Contact' },
  { key: 'email', label: 'Email' },
  { key: 'defaultRate', label: 'Rate', className: 'text-right' },
  { key: 'paymentTermsDays', label: 'Terms', className: 'text-right' },
  { key: 'status', label: 'Status', className: 'text-right' }
]

/** An empty cell, so a gap in the directory reads as blank rather than as broken. */
function Blank(): React.JSX.Element {
  return <span className="text-faint">—</span>
}

/**
 * Where a client stands, as a coloured pill.
 *
 * The colour carries the meaning at a glance down a column, but the label is
 * always there too — status is not something to encode in colour alone.
 */
function StatusPill({ status }: { status: ClientStatus }): React.JSX.Element {
  const entry = CLIENT_STATUSES.find((item) => item.value === status)

  return (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap"
      style={{ borderColor: `${entry?.colour}66`, color: entry?.colour }}
    >
      {entry?.label ?? status}
    </span>
  )
}

export function Clients(): React.JSX.Element {
  const invalidate = useInvalidate()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<ClientInput & { id?: number } | null>(null)
  const list = useListState()
  const tagFilter = useTagFilter('client', list)
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'name',
    descending: false
  })

  useOpenParam('new', () => setEditing({ ...BLANK }))

  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {})
  })

  const search = list.one('q') ?? ''
  const statuses = list.values('status')

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()

    const matched = clients.filter((client) => {
      if (!tagFilter.keep(client.id)) return false
      if (statuses.length > 0 && !statuses.includes(client.status)) return false
      if (needle === '') return true
      // Every column is searchable, plus the phone number, which people
      // reach for far more often than they sort by it.
      return [client.name, client.contactName, client.email, client.phone, client.address]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle))
    })

    const direction = sort.descending ? -1 : 1

    return [...matched].sort((a, b) => {
      const left = a[sort.key]
      const right = b[sort.key]

      // Blanks sort to the bottom whichever way the column is pointing: a
      // client with no rate is not "the cheapest".
      const leftEmpty = left === null || left === '' || left === undefined
      const rightEmpty = right === null || right === '' || right === undefined
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction
      }
      if (typeof left === 'boolean' && typeof right === 'boolean') {
        return (Number(right) - Number(left)) * direction
      }

      return String(left).localeCompare(String(right), 'en-GB') * direction
    })
  }, [clients, search, statuses.join(','), sort, tagFilter.keep])

  const toggleSort = (key: SortKey): void =>
    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: false }
    )

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
      description="Your contact directory — who you work for, how to reach them, and what they are on."
      actions={
        <Button variant="primary" onClick={() => setEditing({ ...BLANK })}>
          <Plus size={14} strokeWidth={1.75} />
          New client
        </Button>
      }
    >
      <Swap
        empty={clients.length === 0}
        fallback={
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
        }
      >
        <div className="flex min-h-0 flex-col gap-3">
          <Toolbar
            search={{ placeholder: 'Search name, contact, email, phone' }}
            state={list}
            facets={[
              {
                key: 'status',
                options: CLIENT_STATUSES.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                  colour: entry.colour,
                  count: clients.filter((client) => client.status === entry.value).length
                }))
              },
              tagFilter.facet
            ]}
          >
            <SavedViews page="clients" state={list} />
          </Toolbar>

          <div className="overflow-hidden rounded-card border border-line">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-raised">
                  {COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className={cn('px-3 py-2', column.className)}>
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1 text-[10.5px] font-medium tracking-[0.08em] uppercase',
                          'transition-colors hover:text-ink',
                          sort.key === column.key ? 'text-ink' : 'text-faint'
                        )}
                      >
                        {column.label}
                        {/* Only the active column shows an arrow — one on every
                            header reads as decoration rather than as state. */}
                        {sort.key === column.key &&
                          (sort.descending ? (
                            <ArrowDown size={11} strokeWidth={2} />
                          ) : (
                            <ArrowUp size={11} strokeWidth={2} />
                          ))}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>

              <motion.tbody variants={listVariants} initial="initial" animate="animate">
                {rows.map((client) => (
                  <motion.tr
                    key={client.id}
                    variants={listItemVariants}
                    onClick={() => navigate(`/clients/${client.id}`)}
                    className={cn(
                      'group cursor-pointer border-b border-line/60 transition-colors last:border-b-0',
                      'hover:bg-raised',
                      client.status === 'not_interested' && 'opacity-60'
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Dot colour={client.colour} />
                        <span className="truncate text-[12.5px] font-medium text-ink">
                          {client.name}
                        </span>
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-[12px] text-muted">
                      {client.contactName || <Blank />}
                    </td>

                    <td className="px-3 py-2.5 text-[12px]">
                      {client.email ? (
                        // A directory exists to be acted on, so the address is a
                        // real mailto rather than text to retype. It must not
                        // also trigger the row's navigation.
                        <a
                          href={`mailto:${client.email}`}
                          onClick={(event) => event.stopPropagation()}
                          className="truncate text-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          {client.email}
                        </a>
                      ) : (
                        <Blank />
                      )}
                    </td>

                    <td className="numeric px-3 py-2.5 text-right text-[12px] text-muted">
                      {client.defaultRate === null ? <Blank /> : formatRate(client.defaultRate)}
                    </td>

                    <td className="numeric px-3 py-2.5 text-right text-[12px] text-muted">
                      {client.paymentTermsDays === null ? (
                        <Blank />
                      ) : (
                        `${client.paymentTermsDays} days`
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <StatusPill status={client.status} />
                        <Inspect
                          subject={{ type: 'client', id: client.id }}
                          siblings={rows.map((row) => ({ type: 'client' as const, id: row.id }))}
                          label={client.name}
                        />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>

            {rows.length === 0 && (
              <p className="px-3 py-8 text-center text-[12px] text-faint">
                No client matches “{search}”.
              </p>
            )}
          </div>
        </div>
      </Swap>

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

          <div className="border-t border-line pt-3.5">
            <Field
              label="Status"
              hint="Only clients you mark active count towards your new-client goal."
            >
              <div className="grid grid-cols-2 gap-2">
                {CLIENT_STATUSES.map((entry) => {
                  const chosen = (draft.status ?? 'interested') === entry.value

                  return (
                    <button
                      key={entry.value}
                      type="button"
                      onClick={() => set('status', entry.value)}
                      className={cn(
                        'rounded-control border px-3 py-2 text-left transition-colors',
                        chosen ? 'bg-raised' : 'border-line hover:border-line-strong'
                      )}
                      style={chosen ? { borderColor: entry.colour } : undefined}
                    >
                      <span
                        className="flex items-center gap-1.5 text-[12.5px]"
                        style={{ color: chosen ? entry.colour : undefined }}
                      >
                        <Dot colour={entry.colour} />
                        {entry.label}
                      </span>
                      <span className="mt-0.5 block pl-3.5 text-[11px] text-faint">
                        {entry.hint}
                      </span>
                    </button>
                  )
                })}
              </div>
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

export function ClientDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const clientId = Number(id)
  const navigate = useNavigate()
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

  const actions = useEntityActions()

  const remove = useMutation({
    mutationFn: () => actions.remove({ type: 'client', id: clientId }, client?.name ?? 'client'),
    onSuccess: () => navigate('/clients')
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
          <UpdatePackButton clientId={clientId} />
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} strokeWidth={1.5} />
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

        <AccountCard clientId={clientId} clientName={client.name} />
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
        body="This removes the client and their projects from SoloWrk. Their folder and every file inside it stays on disk untouched."
      />
    </Page>
  )
}

/**
 * The client update pack.
 *
 * Sits in the page header rather than in a card, because it is the one thing
 * on this screen you come here *to do* — everything else is a record you came
 * to read.
 *
 * Writes the file and opens the folder. The user attaches it themselves: there
 * is no hosting, no link, and no account for their client to create, which is
 * the whole reason this exists instead of a portal.
 */
function UpdatePackButton({ clientId }: { clientId: number }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const build = (format: 'html' | 'pdf'): void => {
    setBusy(true)
    setError('')
    void window.solo
      .invoke('clients:updatePack', { clientId, format })
      .then((path) => void window.solo.invoke('files:reveal', { path }))
      // A refusal goes to the upgrade modal like every other one. Only a
      // genuine failure -- a locked file, a full disk -- lands inline, and
      // those are short enough to fit.
      .catch((cause: Error) => {
        if (!raiseLimit(cause)) setError(cause.message)
      })
      .finally(() => setBusy(false))
  }

  return (
    <span className="relative flex items-center gap-1">
      <Button variant="secondary" disabled={busy} onClick={() => build('html')}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={1.5} />}
        Update pack
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        title="As a PDF instead"
        onClick={() => build('pdf')}
      >
        PDF
      </Button>
      {/*
        Wraps, and bounded. It used to be `whitespace-nowrap`, which was fine
        for "Could not write the file" and ran a gate message clean off the
        side of the window.
      */}
      {error && (
        <span className="absolute top-full right-0 mt-1 max-w-[280px] text-right text-[11.5px] leading-snug text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

/**
 * What this client has been billed, and what they still owe.
 *
 * Replaces a card that read "Available once invoicing lands in phase 4" and
 * showed a dash — invoicing landed several phases ago, and the numbers were
 * already sitting one query away.
 *
 * The statement itself is Pro. The position above it is not: knowing what
 * somebody owes you is not a feature, and a Basic user seeing the number and
 * then being asked to pay to have it typed onto headed paper is an honest
 * place to draw the line.
 */
function AccountCard({
  clientId,
  clientName
}: {
  clientId: number
  clientName: string
}): React.JSX.Element {
  const entitled = useFeature('chasing')
  const [error, setError] = useState('')

  const { data: invoices = [] } = useQuery({
    // Under the invoices key, so raising or paying one refreshes this too.
    queryKey: ['invoices', { clientId }],
    queryFn: () => window.solo.invoke('invoices:list', { clientId }),
    enabled: Number.isFinite(clientId)
  })

  // Drafts and cancelled invoices are left out for the same reason the
  // statement leaves them out: the client has never seen them.
  const billed = invoices.filter(
    (invoice) => invoice.status === 'sent' || invoice.status === 'paid'
  )
  const invoiced = billed.reduce((sum, invoice) => sum + invoice.gross, 0)
  const outstanding = billed
    .filter((invoice) => invoice.paidAt === null)
    .reduce((sum, invoice) => sum + invoice.gross, 0)

  const statement = useMutation({
    mutationFn: () => window.solo.invoke('chasing:statement', { clientId }),
    onSuccess: (path) => {
      setError('')
      void window.solo.invoke('files:open', { path })
    },
    onError: (cause: Error) => setError(cause.message)
  })

  return (
    <Card>
      <CardHeader
        title="Account"
        action={
          entitled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => statement.mutate()}
              disabled={statement.isPending || billed.length === 0}
              title={
                billed.length === 0
                  ? `${clientName} has not been invoiced yet`
                  : 'Save a statement of account'
              }
            >
              <FileText size={13} strokeWidth={1.75} />
              Statement
            </Button>
          ) : (
            <span
              title="Statements of account are part of SoloWrk Pro"
              className="flex items-center gap-1 text-[11px] text-faint"
            >
              <Lock size={11} strokeWidth={1.75} />
              Statement
            </span>
          )
        }
      />

      <p className="numeric text-[22px] font-medium text-ink">{formatMoney(invoiced)}</p>
      <p className="mt-1 text-[11px] text-faint">
        Invoiced across {billed.length} invoice{billed.length === 1 ? '' : 's'}
      </p>

      {outstanding > 0 && (
        <p className="mt-2 text-[12px] text-danger">
          <span className="numeric">{formatMoney(outstanding)}</span> outstanding
        </p>
      )}

      {error && <p className="mt-2 text-[11.5px] text-danger">{error}</p>}
    </Card>
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
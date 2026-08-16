import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  Inbox,
  Mail,
  Phone,
  RefreshCw,
  Settings as SettingsIcon,
  TriangleAlert,
  UserPlus
} from 'lucide-react'
import type { Enquiry } from '@shared/types'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { formatDate } from '@/lib/format'
import { useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Enquiries from the website's contact form.
 *
 * The one that joins the website to the business: a lead becomes a client here
 * in a click, and from there a quote and an invoice, without anything being
 * retyped.
 */
export function Enquiries(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  const [archived, setArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.solo.invoke('settings:get')
  })

  const { data: tokenSet = false } = useQuery({
    queryKey: ['enquiries', 'tokenSet'],
    queryFn: () => window.solo.invoke('enquiries:tokenSet')
  })

  const configured = (settings?.enquiriesUrl ?? '') !== '' && tokenSet

  const { data: enquiries = [] } = useQuery({
    queryKey: ['enquiries', 'list', archived],
    queryFn: () => window.solo.invoke('enquiries:list', { archived }),
    enabled: configured
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['enquiries'] })
  }

  const poll = useMutation({
    mutationFn: () => window.solo.invoke('enquiries:poll'),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not reach your website.')
  })

  const archive = useMutation({
    mutationFn: (input: { id: number; archived: boolean }) =>
      window.solo.invoke('enquiries:archive', input),
    onSuccess: refresh
  })

  const toClient = useMutation({
    mutationFn: (id: number) => window.solo.invoke('enquiries:toClient', { id }),
    onSuccess: (client) => {
      refresh()
      invalidate(['clients'])
      navigate(`/clients/${client.id}`)
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not create that client.')
  })

  const read = useMutation({
    mutationFn: (id: number) => window.solo.invoke('enquiries:read', { id }),
    onSuccess: refresh
  })

  return (
    <Page
      title="Enquiries"
      description="Everything sent through your website's contact form."
      actions={
        configured ? (
          <>
            <Button variant="ghost" onClick={() => setArchived(!archived)}>
              {archived ? 'Show open' : 'Show archived'}
            </Button>
            <Button variant="secondary" onClick={() => poll.mutate()} disabled={poll.isPending}>
              <RefreshCw
                size={14}
                strokeWidth={1.75}
                className={cn(poll.isPending && 'animate-spin')}
              />
              {poll.isPending ? 'Checking…' : 'Check now'}
            </Button>
          </>
        ) : undefined
      }
    >
      {error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5">
          <TriangleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0 text-danger" />
          <p className="flex-1 text-[12px] leading-relaxed text-ink">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[11px] text-faint hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {settings === undefined ? null : !configured ? (
        <Empty
          icon={Inbox}
          title="Enquiries are not connected yet"
          body="Your contact form can keep a copy of every enquiry and hand them to SoloWrk, so a lead becomes a client without being retyped. It needs the endpoint address and its token."
          action={
            <Link to="/settings?tab=website">
              <Button variant="primary">
                <SettingsIcon size={14} strokeWidth={1.75} />
                Set it up
              </Button>
            </Link>
          }
        />
      ) : enquiries.length === 0 ? (
        <Empty
          icon={Inbox}
          title={archived ? 'Nothing archived' : 'No enquiries yet'}
          body={
            archived
              ? 'Enquiries you have dealt with end up here.'
              : 'When someone fills in your contact form it will appear here within a few minutes, and you can turn it into a client from the card.'
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {enquiries.map((enquiry) => (
            <EnquiryCard
              key={enquiry.id}
              enquiry={enquiry}
              onRead={() => enquiry.readAt === null && read.mutate(enquiry.id)}
              onArchive={() =>
                archive.mutate({ id: enquiry.id, archived: !enquiry.archived })
              }
              onToClient={() => toClient.mutate(enquiry.id)}
              converting={toClient.isPending}
            />
          ))}
        </div>
      )}
    </Page>
  )
}

function EnquiryCard({
  enquiry,
  onRead,
  onArchive,
  onToClient,
  converting
}: {
  enquiry: Enquiry
  onRead: () => void
  onArchive: () => void
  onToClient: () => void
  converting: boolean
}): React.JSX.Element {
  const unread = enquiry.readAt === null

  return (
    <div
      onMouseEnter={onRead}
      className={cn(
        'rounded-card border bg-surface p-4 transition-colors',
        unread ? 'border-accent/40' : 'border-line'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {unread && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            )}
            <p className="text-[13.5px] font-medium text-ink">{enquiry.name || 'No name'}</p>
            {enquiry.business && (
              <span className="text-[12px] text-muted">· {enquiry.business}</span>
            )}
            {enquiry.clientId !== null && (
              <Link
                to={`/clients/${enquiry.clientId}`}
                className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted hover:text-ink"
              >
                Client created
              </Link>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px]">
            {enquiry.email && (
              <a
                href={`mailto:${enquiry.email}`}
                className="flex items-center gap-1.5 text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                <Mail size={11} strokeWidth={1.75} />
                {enquiry.email}
              </a>
            )}
            {enquiry.phone && (
              <a
                href={`tel:${enquiry.phone}`}
                className="flex items-center gap-1.5 text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                <Phone size={11} strokeWidth={1.75} />
                {enquiry.phone}
              </a>
            )}
            <span className="text-faint">{formatDate(enquiry.receivedAt)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {enquiry.clientId === null && !enquiry.archived && (
            <Button variant="ghost" size="sm" onClick={onToClient} disabled={converting}>
              <UserPlus size={12} strokeWidth={1.75} />
              Create client
            </Button>
          )}
          <button
            type="button"
            aria-label={enquiry.archived ? 'Restore' : 'Archive'}
            onClick={onArchive}
            className="rounded-control p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            {enquiry.archived ? (
              <ArchiveRestore size={13} strokeWidth={1.75} />
            ) : (
              <Archive size={13} strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {(enquiry.budget || enquiry.projectType) && (
        <p className="mt-2.5 flex flex-wrap gap-2">
          {enquiry.projectType && (
            <span className="rounded-control bg-raised px-2 py-0.5 text-[10.5px] text-muted">
              {enquiry.projectType}
            </span>
          )}
          {enquiry.budget && (
            <span className="rounded-control bg-raised px-2 py-0.5 text-[10.5px] text-muted">
              {enquiry.budget}
            </span>
          )}
        </p>
      )}

      {enquiry.message && (
        <p className="mt-2.5 border-t border-line pt-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">
          {enquiry.message}
        </p>
      )}
    </div>
  )
}

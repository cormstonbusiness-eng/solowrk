import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { Clock, Loader2, Send, TriangleAlert, X } from 'lucide-react'
import type { QueuedMail } from '@shared/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Expand } from '@/components/ui/Expand'
import { useInvalidate } from '@/lib/api'

/**
 * Chasers waiting to go, and chasers that did not.
 *
 * The outbox exists because the queue behind it is invisible otherwise, and an
 * invisible queue is one nobody trusts. Two questions have to be answerable at
 * a glance: *has this gone?* and *why not?* — and the second one is the reason
 * a failed message gets the mail server's own words rather than a red icon.
 *
 * Sent messages are not listed. The place to see that an invoice was chased is
 * the invoice; a log of everything ever sent is a thing nobody reads that makes
 * the one thing worth reading harder to find.
 */
const WAITING: QueuedMail['status'][] = ['held', 'queued', 'failed']

export function Outbox(): React.JSX.Element | null {
  const invalidate = useInvalidate()
  const queryClient = useQueryClient()
  const [reading, setReading] = useState<number | null>(null)

  const { data: mail = [] } = useQuery({
    queryKey: ['chasing', 'outbox'],
    queryFn: () => window.solo.invoke('chasing:outbox')
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['chasing'] })
    invalidate(['invoices'])
  }

  const send = useMutation({
    mutationFn: (id: number) => window.solo.invoke('chasing:send', { id }),
    onSuccess: refresh
  })

  const discard = useMutation({
    mutationFn: (id: number) => window.solo.invoke('chasing:discard', { id }),
    onSuccess: refresh
  })

  const waiting = mail.filter((item) => WAITING.includes(item.status))

  // Nothing waiting is the normal state and deserves no furniture at all.
  if (waiting.length === 0) return null

  const held = waiting.filter((item) => item.status === 'held').length

  return (
    <Card className="mb-3">
      <CardHeader
        title="Chasers waiting"
        action={
          <span className="text-[11px] text-faint">
            {held > 0 ? `${held} waiting on you` : `${waiting.length} in the queue`}
          </span>
        }
      />

      <div className="flex flex-col gap-1.5">
        {waiting.map((item) => (
          <div key={item.id} className="rounded-control border border-line bg-raised">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <StatusIcon status={item.status} />

              <button
                type="button"
                onClick={() => setReading(reading === item.id ? null : item.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-[13px] text-ink">{item.subject}</p>
                <p className="truncate text-[11.5px] text-muted">
                  To {item.to} · {describe(item)}
                </p>
              </button>

              {item.status !== 'queued' && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={send.isPending}
                  onClick={() => send.mutate(item.id)}
                >
                  <Send size={12} strokeWidth={1.75} />
                  {item.status === 'failed' ? 'Try again' : 'Send'}
                </Button>
              )}

              <button
                type="button"
                aria-label={`Discard chaser for ${item.subject}`}
                onClick={() => discard.mutate(item.id)}
                className="text-faint transition-colors hover:text-danger"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            {/*
              The note itself, on request. Nobody sends something in their own
              name without reading it first, and making them open another
              window to do that is how a feature stops being used.
            */}
            <AnimatePresence initial={false}>
              {reading === item.id && (
                <Expand contentClassName="border-t border-line px-3 py-2.5">
                  <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-muted">
                    {item.body}
                  </p>
                </Expand>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </Card>
  )
}

function StatusIcon({ status }: { status: QueuedMail['status'] }): React.JSX.Element {
  if (status === 'failed') {
    return <TriangleAlert size={14} strokeWidth={1.75} className="shrink-0 text-danger" />
  }
  if (status === 'queued') {
    return <Loader2 size={14} strokeWidth={1.75} className="shrink-0 animate-spin text-info" />
  }
  return <Clock size={14} strokeWidth={1.75} className="shrink-0 text-warning" />
}

/**
 * The one line that says where this is up to.
 *
 * A failed message gets the server's own words. "535 Incorrect authentication
 * data" tells somebody what to fix; "could not send" sends them to a support
 * page.
 */
function describe(mail: QueuedMail): string {
  if (mail.status === 'failed') return mail.lastError ?? 'Could not be sent'
  if (mail.status === 'queued') {
    return mail.lastError ? `Trying again — ${mail.lastError}` : 'Sending'
  }
  return `Note ${mail.attempt}, waiting for you`
}

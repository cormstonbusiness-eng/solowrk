import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { CalendarSubscription } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Field, TextInput, Toggle } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ColourPicker } from '@/components/ui/Select'
import { useInvalidate } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Shown verbatim, and shown here rather than in a help article.
 *
 * People choose a local-first app for exactly one reason, and the moment it
 * grows something network-facing it owes them a plain sentence about it in
 * the place the feature lives. Kept in step with the same line in
 * `main/services/subscriptions.ts`, which is where it is enforced.
 */
const PROMISE = 'SoloWrk downloads this calendar. It never uploads your SoloWrk data.'

export function Subscriptions({
  open,
  range,
  onClose
}: {
  open: boolean
  /** What an export covers — whatever the calendar is currently showing. */
  range: { from: string; to: string }
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  const { data: subscriptions = [] } = useQuery({
    queryKey: ['calendar', 'subscriptions'],
    queryFn: () => window.solo.invoke('calendar:subscriptions', undefined),
    enabled: open
  })

  const refresh = (): void => invalidate(['calendar'])

  const add = useMutation({
    mutationFn: () => window.solo.invoke('calendar:subscribe', { name: name.trim(), url }),
    onSuccess: async (created) => {
      setName('')
      setUrl('')
      setError('')
      refresh()
      // Pull it straight away rather than waiting up to an hour for the tick:
      // adding a calendar and seeing nothing appear reads as a failure.
      await window.solo.invoke('calendar:syncSubscription', { id: created.id })
      refresh()
    },
    onError: (problem) => setError(problem instanceof Error ? problem.message : 'That did not work')
  })

  const sync = useMutation({
    mutationFn: (id: number) => window.solo.invoke('calendar:syncSubscription', { id }),
    onSuccess: refresh
  })

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Partial<CalendarSubscription> }) =>
      window.solo.invoke('calendar:updateSubscription', input),
    onSuccess: refresh
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('calendar:unsubscribe', { id }),
    onSuccess: refresh
  })

  const importFile = useMutation({
    mutationFn: () => window.solo.invoke('calendar:importIcs', undefined),
    onSuccess: refresh
  })

  const exportFile = useMutation({
    mutationFn: () => window.solo.invoke('calendar:exportIcs', range)
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Calendars"
      description="Subscribe to a calendar, or move one in and out as a file."
      width={560}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-[11px] tracking-[0.06em] text-faint uppercase">Subscribed</h3>

          {subscriptions.length === 0 ? (
            <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-[12px] text-muted">
              Nothing subscribed. Paste a calendar address below.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {subscriptions.map((one) => (
                <div
                  key={one.id}
                  className="flex items-center gap-2.5 rounded-control border border-line bg-raised px-3 py-2"
                >
                  <ColourPicker
                    value={one.colour}
                    onChange={(colour) => update.mutate({ id: one.id, patch: { colour } })}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[13px] text-ink">
                      {one.name}
                      {/* A dot, and nothing else. A broken feed is not worth
                          interrupting anybody over, and the error belongs
                          where the feed is, not in front of the calendar. */}
                      {one.lastStatus === 'error' && (
                        <span
                          title={one.syncError}
                          className="size-[7px] shrink-0 rounded-full bg-danger"
                        />
                      )}
                    </p>
                    <p className="truncate text-[11px] text-faint">
                      {one.lastStatus === 'error'
                        ? one.syncError
                        : one.lastSyncedAt
                          ? `Last checked ${one.lastSyncedAt.slice(0, 16).replace('T', ' ')}`
                          : 'Not checked yet'}
                    </p>
                  </div>

                  <Toggle
                    checked={one.visible}
                    onChange={(visible) => update.mutate({ id: one.id, patch: { visible } })}
                    label=""
                  />

                  <button
                    type="button"
                    aria-label={`Refresh ${one.name}`}
                    disabled={sync.isPending}
                    onClick={() => sync.mutate(one.id)}
                    className="rounded-control p-1 text-faint transition-colors hover:text-ink disabled:opacity-40"
                  >
                    <RefreshCw
                      size={13}
                      strokeWidth={1.75}
                      className={cn(sync.isPending && 'animate-spin')}
                    />
                  </button>

                  <button
                    type="button"
                    aria-label={`Remove ${one.name}`}
                    onClick={() => remove.mutate(one.id)}
                    className="rounded-control p-1 text-faint transition-colors hover:text-danger"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_1.4fr] gap-3">
            <Field label="Name">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Dana's calendar"
              />
            </Field>
            <Field label="Address">
              <TextInput
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…/basic.ics"
              />
            </Field>
          </div>

          {error && <p className="text-[12px] text-danger">{error}</p>}

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={!url.trim() || add.isPending}
              onClick={() => add.mutate()}
            >
              Subscribe
            </Button>
            <p className="text-[11.5px] text-muted">{PROMISE}</p>
          </div>
        </section>

        <section className="border-t border-line pt-4">
          <h3 className="mb-2 text-[11px] tracking-[0.06em] text-faint uppercase">Files</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => importFile.mutate()}>
              <Upload size={13} strokeWidth={1.75} />
              Import an .ics file
            </Button>
            <Button variant="outline" onClick={() => exportFile.mutate()}>
              <Download size={13} strokeWidth={1.75} />
              Export what is showing
            </Button>
          </div>

          <p className="mt-2 text-[11.5px] text-muted">
            {importFile.isSuccess && importFile.data === 0
              ? 'Nothing new in that file.'
              : importFile.isSuccess
                ? `Added ${importFile.data} block${importFile.data === 1 ? '' : 's'}.`
                : exportFile.isSuccess && exportFile.data
                  ? `Written to ${exportFile.data}`
                  : 'An export covers the dates the calendar is showing, and only your own blocks.'}
          </p>
        </section>
      </div>
    </Modal>
  )
}

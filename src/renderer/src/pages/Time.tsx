import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Clock, Play, Plus, Square, Trash2 } from 'lucide-react'
import { secondsToHours, timeValue } from '@shared/money'
import { rangeFor, today } from '@shared/taxYear'
import { Page } from '@/components/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Dot, Empty } from '@/components/ui/Empty'
import { Swap } from '@/components/ui/Swap'
import { keys, useInvalidate } from '@/lib/api'
import { formatDuration, formatMoney } from '@/lib/format'
import { listItemVariants, listVariants } from '@/lib/motion'

/**
 * Time: one timer, this week's entries, and a way to log what you forgot.
 *
 * The page is scoped to the current week and does not offer a date range.
 * Tracking is a thing you do today; looking back over months is a question
 * about money, and that is Finance's job. Keeping this page short is what makes
 * it usable as a daily surface rather than a report.
 *
 * Two things decide whether an hour ever earns anything, and both are set
 * elsewhere: `billable`, and the rate, which falls back from the project to the
 * client to the default in Settings. This page only reads the result.
 */
export function Time(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [projectId, setProjectId] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [manual, setManual] = useState(false)

  const week = rangeFor('week')

  /**
   * The running timer, polled rather than pushed.
   *
   * Five seconds is enough to notice a timer started from the command palette
   * or stopped from the title bar, and cheap because it is a single row from a
   * local database. The elapsed figure people watch tick is drawn by the title
   * bar from `startedAt`, so this interval decides how quickly the Start button
   * becomes a Stop button, not how smoothly a clock counts.
   */
  const { data: running } = useQuery({
    queryKey: ['time', 'running'],
    queryFn: () => window.solo.invoke('time:running'),
    refetchInterval: 5000
  })

  const { data: entries = [] } = useQuery({
    queryKey: ['time', 'week', week.from],
    queryFn: () => window.solo.invoke('time:list', { from: week.from, to: week.to })
  })

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const start = useMutation({
    mutationFn: () => window.solo.invoke('time:start', { projectId, notes }),
    onSuccess: () => {
      invalidate(['time'])
      setNotes('')
    }
  })

  /*
    Stopping touches three things, which is why it invalidates three.

    The entry gains a duration (`time`), the project's tracked hours and
    profitability change (`projects`), and the unbilled figure Finance reports
    moves (`finance`). Starting a timer changes none of those yet, which is why
    `start` above only invalidates `time`.
  */
  const stop = useMutation({
    mutationFn: (id: number) => window.solo.invoke('time:stop', { id }),
    onSuccess: () => invalidate(['time', 'projects', 'finance'])
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.solo.invoke('time:delete', { id }),
    onSuccess: () => invalidate(['time', 'finance'])
  })

  const totalSeconds = entries.reduce((sum, entry) => sum + entry.duration, 0)

  /**
   * Work done and not yet charged for.
   *
   * Both halves of the filter matter. `billable` excludes the hours you were
   * never going to invoice; `invoiceLineId === null` excludes the ones already
   * on an invoice, which is what stops the same hour being counted as owing
   * twice — once here and once in what the client has been billed.
   *
   * Shown in the warning colour rather than the success one on purpose: this is
   * money you have earned and not asked for, which is a prompt rather than an
   * achievement.
   */
  const billableValue = entries
    .filter((entry) => entry.billable && entry.invoiceLineId === null)
    .reduce((sum, entry) => sum + timeValue(entry.duration, entry.rate), 0)

  /*
    Group by calendar day so a week reads as days rather than a flat list.

    The key is the first ten characters of the ISO timestamp — the local date as
    it was stored. Sliced rather than parsed to a `Date` and reformatted, which
    would push entries near midnight into the wrong day whenever the machine's
    timezone differs from the one the entry was recorded in. A day is what the
    person remembers working, not a moment on a clock.
  */
  const byDay = entries.reduce<Record<string, typeof entries>>((groups, entry) => {
    const day = entry.startedAt.slice(0, 10)
    ;(groups[day] ??= []).push(entry)
    return groups
  }, {})

  return (
    <Page
      title="Time"
      description={`This week — ${week.from} to ${week.to}`}
      actions={
        <Button variant="outline" onClick={() => setManual(true)}>
          <Plus size={14} strokeWidth={1.75} />
          Log time
        </Button>
      }
    >
      <Card className="mb-3">
        <div className="flex items-end gap-2">
          <Field label="Project" className="w-[220px]">
            <Select
              value={projectId}
              onChange={setProjectId}
              placeholder="No project"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
            />
          </Field>
          <Field label="What are you working on?" className="flex-1">
            <TextInput
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              /*
                Enter starts the timer, but only when one is not already
                running — otherwise typing a note while tracking and pressing
                Enter out of habit would start a second timer and silently
                orphan the first.
              */
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !running) start.mutate()
              }}
              placeholder="Optional note"
            />
          </Field>

          {running ? (
            <Button variant="danger" size="lg" onClick={() => stop.mutate(running.entry.id)}>
              <Square size={13} strokeWidth={2.5} />
              Stop
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => start.mutate()}>
              <Play size={14} strokeWidth={2} />
              Start
            </Button>
          )}
        </div>
      </Card>

      <div className="mb-3 grid grid-cols-3 gap-3">
        <Card className="p-3.5">
          <p className="mb-1.5 text-[11px] text-muted">Tracked this week</p>
          <p className="numeric text-[20px] font-medium text-ink">
            {secondsToHours(totalSeconds)}h
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="mb-1.5 text-[11px] text-muted">Unbilled value</p>
          <p className="numeric text-[20px] font-medium text-warning">
            {formatMoney(billableValue)}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="mb-1.5 text-[11px] text-muted">Entries</p>
          <p className="numeric text-[20px] font-medium text-ink">{entries.length}</p>
        </Card>
      </div>

      <Swap
        empty={entries.length === 0}
        fallback={
          <Empty
            icon={Clock}
            title="Nothing tracked this week"
            body="Start a timer above, or log time you have already done. Tracked time can be pulled straight onto an invoice."
          />
        }
      >
        <motion.div variants={listVariants} initial="initial" animate="animate">
          {/*
            Newest day first, sorted on the `yyyy-mm-dd` key itself: ISO dates
            compare correctly as strings, so this needs no date parsing.
          */}
          {Object.entries(byDay)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([day, dayEntries]) => (
              <div key={day} className="mb-4">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-[11px] tracking-[0.08em] text-faint uppercase">
                    {new Date(day).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short'
                    })}
                    {day === today() && ' · Today'}
                  </p>
                  <p className="numeric text-[11px] text-muted">
                    {formatDuration(dayEntries.reduce((sum, entry) => sum + entry.duration, 0))}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <AnimatePresence initial={false}>
                    {dayEntries.map((entry) => (
                      <motion.div
                        key={entry.id}
                        layout
                        variants={listItemVariants}
                        exit={{ opacity: 0, height: 0 }}
                        className="group flex items-center gap-3 rounded-control bg-raised px-3 py-2"
                      >
                        <Dot colour={entry.projectColour ?? '#5a5a63'} />
                        <div className="min-w-0 flex-1">
                          {/*
                            The note leads, because it is what distinguishes one
                            entry from another; the project name is the fallback
                            when there is no note, and drops to the second line
                            when there is. Showing both on one line would put
                            the same project name down the whole day.
                          */}
                          <p className="truncate text-[13px] text-ink">
                            {entry.notes || entry.projectName || 'Untitled'}
                          </p>
                          {entry.projectName && entry.notes && (
                            <p className="truncate text-[11px] text-faint">{entry.projectName}</p>
                          )}
                        </div>

                        {entry.invoiceLineId !== null && (
                          <span className="text-[10.5px] text-success">Billed</span>
                        )}
                        <span className="numeric text-[11.5px] text-muted">
                          {formatMoney(timeValue(entry.duration, entry.rate))}
                        </span>
                        <span className="numeric w-[62px] text-right text-[12.5px] text-ink">
                          {formatDuration(entry.duration)}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove.mutate(entry.id)}
                          aria-label="Delete entry"
                          className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                        >
                          <Trash2 size={13} strokeWidth={1.75} />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
        </motion.div>
      </Swap>

      <ManualEntryModal open={manual} onClose={() => setManual(false)} />
    </Page>
  )
}

/**
 * Time you did without the timer running, which is most of it.
 *
 * Hours as a decimal rather than a start and end time: somebody logging
 * yesterday afternoon knows it was about two hours and does not know, and
 * should not have to invent, that it ran from 14:10 to 16:05.
 */
function ManualEntryModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const invalidate = useInvalidate()
  const [projectId, setProjectId] = useState<number | null>(null)
  const [date, setDate] = useState(today())
  const [hours, setHours] = useState('1')
  const [notes, setNotes] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {})
  })

  const create = useMutation({
    mutationFn: () =>
      window.solo.invoke('time:create', {
        projectId,
        // 9am local is a neutral placeholder — the day is what matters for a
        // manual entry, not the hour it supposedly started.
        startedAt: new Date(`${date}T09:00:00`).toISOString(),
        duration: Math.round(Number.parseFloat(hours) * 3600),
        notes
      }),
    onSuccess: () => {
      invalidate(['time', 'finance'])
      onClose()
      setNotes('')
    }
  })

  /*
    The field is a text input holding a number, so it can be empty, a minus
    sign, or "1.2.3" mid-typing. Both checks are needed: `Number.isFinite`
    rejects NaN, and `> 0` rejects zero and negatives — an entry of no hours is
    a row that clutters the day and can never be invoiced.
  */
  const parsed = Number.parseFloat(hours)
  const valid = Number.isFinite(parsed) && parsed > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log time"
      description="For work you did without the timer running."
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!valid}>
            Log time
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Project">
          <Select
            value={projectId}
            onChange={setProjectId}
            placeholder="No project"
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Hours" hint="Decimals are fine: 1.5 is 1h 30m.">
            <TextInput
              type="number"
              step="0.25"
              min="0"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Note">
          <TextInput value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
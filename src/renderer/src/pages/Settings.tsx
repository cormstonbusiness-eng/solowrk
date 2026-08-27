import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUpCircle,
  Check,
  Compass,
  Download,
  FileText,
  FileArchive,
  FolderArchive,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Lock,
  TriangleAlert,
  Upload
} from 'lucide-react'
import type { BusinessSettings, Settings as SettingsType } from '@shared/types'
import { DATASETS } from '@shared/types'
import { Skeleton } from '@/components/ui/Skeleton'
import { DEFAULT_CHASE_DAYS, describeSchedule, parseChaseDays } from '@shared/chasing'
import { type ChangeKind, type Release, changelog, releaseFor } from '@shared/changelog'
import { Page } from '@/components/Page'
import { Expand } from '@/components/ui/Expand'
import { MailCard } from './settings/MailCard'
import { Automations } from './settings/Automations'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { DECOR_INTENSITIES, THEMES, isInSeason, themeById } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import { useUpdates } from '@/hooks/useUpdates'
import { cn } from '@/lib/utils'
import { currentTaxYear, today as todayString } from '@shared/taxYear'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useFeature } from '@/lib/features'
import { useTour } from '@/tour/TourProvider'

type Tab = 'business' | 'money' | 'automations' | 'account' | 'assistant' | 'appearance' | 'app'

const TABS: { value: Tab; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'money', label: 'Invoicing & tax' },
  { value: 'automations', label: 'Automations' },
  { value: 'account', label: 'Account' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'app', label: 'App' }
]

/**
 * Settings edits a local draft and saves explicitly. Auto-save would be fine
 * for toggles but wrong for text fields — half-typed VAT numbers should not
 * reach invoices.
 */
export function Settings(): React.JSX.Element {
  const queryClient = useQueryClient()
  const workspace = useWorkspace()
  const tour = useTour()
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.solo.invoke('settings:get')
  })

  const [tab, setTab] = useState<Tab>('business')
  const [draft, setDraft] = useState<SettingsType | null>(null)
  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  const save = useMutation({
    mutationFn: (patch: Partial<BusinessSettings>) => window.solo.invoke('settings:update', patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated)
      setDraft(updated)
    }
  })

  if (!draft) {
    return (
      <Page title="Settings">
        {/* Shaped like the card that is coming, so nothing moves when it does. */}
        <div className="flex max-w-[760px] flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-[168px] w-full rounded-card" />
          <Skeleton className="h-[120px] w-full rounded-card" />
        </div>
      </Page>
    )
  }

  const set = <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]): void =>
    setDraft({ ...draft, [key]: value })

  const dirty = settings ? JSON.stringify(settings) !== JSON.stringify(draft) : false

  return (
    <Page
      title="Settings"
      description="Your business, your money, your assistant and the app itself."
      actions={
        <AnimatePresence mode="wait">
          {dirty ? (
            <motion.div
              key="save"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={transition.press}
            >
              <Button
                variant="primary"
                onClick={() => save.mutate(draft)}
                disabled={save.isPending}
              >
                {save.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} strokeWidth={2} />
                )}
                Save changes
              </Button>
            </motion.div>
          ) : (
            save.isSuccess && (
              <motion.span
                key="saved"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-[12px] text-success"
              >
                <Check size={13} strokeWidth={2} />
                Saved
              </motion.span>
            )
          )}
        </AnimatePresence>
      }
    >
      <div className="mb-4 flex items-center gap-1 border-b border-line">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setTab(entry.value)}
            className="relative px-3 py-2 text-[13px]"
          >
            <span className={tab === entry.value ? 'text-ink' : 'text-muted hover:text-ink'}>
              {entry.label}
            </span>
            {tab === entry.value && (
              <motion.span
                layoutId="settings-tab"
                transition={transition.layout}
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={transition.page}
          className="flex max-w-[760px] flex-col gap-3"
        >
          {tab === 'business' && (
            <>
              <LogoCard logoFile={draft.logoFile} />
        <Card>
          <CardHeader title="Business" />
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Trading name">
                <TextInput
                  value={draft.businessName}
                  onChange={(e) => set('businessName', e.target.value)}
                />
              </Field>
              <Field label="Contact name">
                <TextInput
                  value={draft.contactName}
                  onChange={(e) => set('contactName', e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <TextInput
                  type="email"
                  value={draft.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <TextInput value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Address" />
          <div className="flex flex-col gap-3.5">
            <Field label="Address line 1">
              <TextInput
                value={draft.addressLine1}
                onChange={(e) => set('addressLine1', e.target.value)}
              />
            </Field>
            <Field label="Address line 2">
              <TextInput
                value={draft.addressLine2}
                onChange={(e) => set('addressLine2', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Town or city">
                <TextInput value={draft.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="Postcode">
                <TextInput
                  value={draft.postcode}
                  onChange={(e) => set('postcode', e.target.value)}
                />
              </Field>
              <Field label="Country">
                <TextInput value={draft.country} onChange={(e) => set('country', e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
            </>
          )}

          {tab === 'money' && <>
        <Card>
          <CardHeader title="Invoicing and tax" />
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default hourly rate">
                <MoneyInput
                  pence={draft.defaultHourlyRate}
                  onChangePence={(pence) => set('defaultHourlyRate', pence)}
                />
              </Field>
              <Field label="Payment terms">
                <NumberInput
                  suffix="days"
                  min={0}
                  value={draft.paymentTermsDays}
                  onChangeValue={(value) => set('paymentTermsDays', value)}
                />
              </Field>
            </div>

            <div className="border-t border-line pt-3.5">
              <Toggle
                checked={draft.vatRegistered}
                onChange={(checked) => set('vatRegistered', checked)}
                label="VAT registered"
                hint="Adds a VAT line to invoices and quotes."
              />
              <AnimatePresence initial={false}>
                {draft.vatRegistered && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={transition.page}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3 pt-3.5">
                      <Field label="VAT number">
                        <TextInput
                          value={draft.vatNumber}
                          onChange={(e) => set('vatNumber', e.target.value)}
                        />
                      </Field>
                      <Field label="VAT rate" hint="Percent.">
                        <NumberInput
                          suffix="%"
                          min={0}
                          max={100}
                          value={Math.round(draft.vatRate / 100)}
                          onChangeValue={(percent) => set('vatRate', percent * 100)}
                        />
                      </Field>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-line pt-3.5">
              <Field
                label="Tax set-aside"
                hint="Share of income held back for your tax bill."
              >
                <NumberInput
                  suffix="%"
                  min={0}
                  max={100}
                  value={draft.taxSetAsidePercent}
                  onChangeValue={(value) => set('taxSetAsidePercent', value)}
                />
              </Field>
              <Field label="Invoice prefix" hint={`Next: ${draft.invoicePrefix}${String(draft.nextInvoiceNumber).padStart(4, '0')}`}>
                <TextInput
                  value={draft.invoicePrefix}
                  onChange={(e) => set('invoicePrefix', e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Card>
        <ChasingCard draft={draft} set={set} />
        <MailCard draft={draft} set={set} />
            </>}

          {tab === 'automations' && <Automations />}

          {tab === 'account' && <AccountCard />}

          {tab === 'assistant' && <BusinessPlanCard />}

          {tab === 'appearance' && (
            <>
              <ThemeCard />
              <DecorCard />
            </>
          )}

          {tab === 'app' && (
            <>
        <UpdatesCard />
        <ReleaseNotesCard />
        <ExportCard />
        <Card>
          <CardHeader title="Help" />
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] text-ink">Guided tour</p>
              <p className="mt-0.5 text-[11px] text-faint">
                Walk through the app again, section by section.
              </p>
            </div>
            <Button variant="outline" onClick={tour.start} disabled={tour.isActive}>
              <Compass size={14} strokeWidth={1.75} />
              Replay tour
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Workspace" />
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">
                {workspace.status?.state === 'ready' ? workspace.status.path : 'Not set'}
              </p>
              <p className="mt-0.5 text-[11px] text-faint">
                Your files and database. Backed up daily inside _app\backups.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void window.solo.invoke('workspace:reveal')}
            >
              <FolderOpen size={14} strokeWidth={1.75} />
              Open folder
            </Button>
          </div>
        </Card>
              <VersionFooter />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </Page>
  )
}

/**
 * The chase schedule.
 *
 * Off until switched on, and switching it on is a considered act rather than a
 * default — an app that started drafting notes to a customer's clients because
 * it was installed would be indefensible, however good the drafts are.
 *
 * The hint under the input shows the schedule read back rather than echoing
 * what was typed, so "30, 7, banana" visibly becomes "Chases 7 days after and
 * 30 days after" before anyone finds out the hard way. Both sides read it with
 * the same function.
 *
 * Sending is the second switch, and it only appears once there is a mail
 * account for it to use. Two switches rather than one because they are two
 * different decisions: *tell me when an invoice needs chasing* is a reminder,
 * and *send it without asking me* is a note going to somebody else's client in
 * the user's name. Rolling them together would mean somebody who wanted the
 * first got the second.
 */
function ChasingCard({
  draft,
  set
}: {
  draft: SettingsType
  set: <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) => void
}): React.JSX.Element {
  const entitled = useFeature('chasing')

  // Whether there is an account to send through at all. Drives the second
  // switch rather than being another thing to configure here — the mail
  // account is set up once, in its own card, and used from several places.
  const { data: mailStatus } = useQuery({
    queryKey: ['mail', 'status'],
    queryFn: () => window.solo.invoke('mail:status')
  })
  const mailReady = mailStatus?.configured ?? false

  return (
    <Card>
      <CardHeader
        title="Chasing late invoices"
        action={
          !entitled && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] tracking-[0.08em] text-faint uppercase">
              Pro
            </span>
          )
        }
      />

      {!entitled ? (
        <div className="flex gap-3">
          <Lock size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" />
          <div className="min-w-0">
            <p className="text-[12.5px] leading-relaxed text-muted">
              Pro watches your due dates and tells you which invoices have gone quiet, with the
              note already written. You can still chase any overdue invoice by hand from the
              Invoices page — that has never been part of the upgrade.
            </p>
            <a
              href="https://solo-wrk.com/pricing"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[12px] text-accent hover:underline"
            >
              See what Pro includes
            </a>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Toggle
            checked={draft.chaseEnabled}
            onChange={(checked) => set('chaseEnabled', checked)}
            label="Tell me when an invoice needs chasing"
            hint="SoloWrk watches your due dates and writes the note."
          />

          <AnimatePresence initial={false}>
            {draft.chaseEnabled && (
              <Expand contentClassName="border-t border-line pt-3.5">
                <Field
                  label="Days past due"
                  hint={describeSchedule(parseChaseDays(draft.chaseDays))}
                >
                  <TextInput
                    value={draft.chaseDays}
                    placeholder={DEFAULT_CHASE_DAYS.join(', ')}
                    onChange={(e) => set('chaseDays', e.target.value)}
                  />
                </Field>
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Each one is firmer than the last.
                </p>

                {/*
                  Only offered once there is an account to send through.
                  Showing a switch that cannot do anything would be a promise
                  the app has not earned yet, and turning it on would silently
                  achieve nothing.
                */}
                {mailReady ? (
                  <div className="mt-3.5 border-t border-line pt-3.5">
                    <Toggle
                      checked={draft.chaseSend === 'auto'}
                      onChange={(checked) => set('chaseSend', checked ? 'auto' : 'hold')}
                      label="Send them without asking me"
                      hint="Off: the note waits in your outbox until you press send. On: it goes out on the schedule above, from your address."
                    />
                    {draft.chaseSend === 'auto' && (
                      <p className="mt-2.5 text-[11px] leading-relaxed text-warning">
                        Chasers will go to your clients on their own. You can read every one
                        before it goes by turning this back off, and stop chasing any single
                        invoice from the Invoices page.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3.5 border-t border-line pt-3.5 text-[11px] leading-relaxed text-faint">
                    Notes wait in your outbox until you press send. Add your email account under
                    Sending mail to have SoloWrk send them for you.
                  </p>
                )}
              </Expand>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  )
}

const KIND_LABELS: Record<ChangeKind, string> = {
  added: 'New',
  improved: 'Better',
  changed: 'Changed',
  fixed: 'Fixed'
}

const KIND_COLOURS: Record<ChangeKind, string> = {
  added: 'text-accent border-accent/40',
  improved: 'text-success border-success/40',
  changed: 'text-warning border-warning/40',
  fixed: 'text-muted border-line'
}

/**
 * What changed, and when.
 *
 * The version this build actually is comes first and open; everything before it
 * is there but collapsed, because the question is almost always "what is new"
 * and only occasionally "when did that change".
 *
 * If the running version is not in the list — a build from source, or a
 * changelog nobody updated — it says so rather than silently showing the
 * previous release's notes as though they were this one's.
 */
function ReleaseNotesCard(): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const { data: version } = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => window.solo.invoke('app:version')
  })

  const current = version ? releaseFor(version) : undefined
  const older = changelog.filter((release) => release.version !== current?.version)

  return (
    <Card>
      <CardHeader
        title="What's new"
        action={
          older.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((open) => !open)}>
              {expanded ? 'Just this version' : `Earlier versions (${older.length})`}
            </Button>
          )
        }
      />

      {current ? (
        <ReleaseNotes release={current} />
      ) : (
        <p className="text-[12px] text-faint">
          {version
            ? `No notes were written for version ${version}.`
            : 'Reading the version…'}
        </p>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition.page}
            className="overflow-hidden"
          >
            {older.map((release) => (
              <div key={release.version} className="mt-4 border-t border-line pt-4">
                <ReleaseNotes release={release} />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function ReleaseNotes({ release }: { release: Release }): React.JSX.Element {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="numeric text-[13px] font-medium text-ink">{release.version}</p>
        <p className="text-[11px] text-faint">{formatDate(release.date)}</p>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{release.headline}</p>

      <ul className="mt-3 flex flex-col gap-2.5">
        {release.changes.map((change) => (
          <li key={change.text} className="flex gap-2.5">
            <span
              className={cn(
                'mt-[1px] shrink-0 rounded-full border px-1.5 py-0.5 text-[9.5px]',
                'tracking-[0.06em] uppercase',
                KIND_COLOURS[change.kind]
              )}
            >
              {KIND_LABELS[change.kind]}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-ink">{change.text}</p>
              {change.detail && (
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{change.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Getting the work back out.
 *
 * Free in both tiers and it stays that way — "your work is yours" is the whole
 * argument for a local-first app, and an export behind a paywall makes it a
 * slogan. It also keeps working on a lapsed licence, which `/terms` promises
 * in as many words.
 *
 * The year-end pack below it is Pro, and the line is convenience rather than
 * access: every file the pack contains is obtainable from this same card, one
 * at a time, for nothing.
 */
function ExportCard(): React.JSX.Element {
  const entitled = useFeature('yearend')
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  // Files the archive could not take. Normally none, and never silent when
  // there are: a pack two files short is discovered by an accountant.
  const [missing, setMissing] = useState<string[]>([])

  async function run(label: string, work: () => Promise<string>): Promise<void> {
    setBusy(label)
    setError('')
    setDone('')
    setMissing([])
    try {
      const path = await work()
      setDone(path)
      // Straight to the folder. An export that reports a path the user then
      // has to go and find is half an export.
      void window.solo.invoke('files:reveal', { path })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed')
    } finally {
      setBusy('')
    }
  }

  const year = currentTaxYear()

  return (
    <Card>
      <CardHeader title="Your data" />

      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        Plain CSV, into the Exports folder in your workspace. Opens in Excel, Numbers or
        anything else. Free on every plan, and it keeps working even if your licence lapses —
        the work is yours.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {DATASETS.map((dataset) => (
          <Button
            key={dataset}
            variant="secondary"
            size="sm"
            disabled={busy !== ''}
            onClick={() =>
              void run(dataset, () => window.solo.invoke('export:csv', { dataset }))
            }
          >
            {busy === dataset ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Download size={13} strokeWidth={1.75} />
            )}
            <span className="capitalize">{dataset}</span>
          </Button>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] text-ink">
              Year-end pack
              {!entitled && (
                <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-faint uppercase">
                  Pro
                </span>
              )}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
              {entitled
                ? `One folder for tax year ${year.label}: a summary on a page, the records as CSV, every invoice you raised as a PDF, and every receipt image. What an accountant asks for in January.`
                : 'One folder holding the whole tax year for your accountant. Every file in it is still free above, one at a time — Pro saves you an evening assembling them.'}
            </p>
          </div>

          {entitled ? (
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== ''}
                onClick={() =>
                  void run('pack', async () => (await window.solo.invoke('yearEnd:pack', {})).folder)
                }
              >
                {busy === 'pack' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <FolderArchive size={13} strokeWidth={1.75} />
                )}
                Build it
              </Button>
              {/*
                The same files as one attachment, which is how it is actually
                sent. Asking somebody to zip eleven folders by hand in January
                is how the eleventh gets left out.
              */}
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== ''}
                onClick={() =>
                  void run('zip', async () => {
                    const pack = await window.solo.invoke('yearEnd:accountant', {})
                    setMissing(pack.missing)
                    return pack.archive ?? pack.folder
                  })
                }
              >
                {busy === 'zip' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <FileArchive size={13} strokeWidth={1.75} />
                )}
                As a ZIP
              </Button>
            </div>
          ) : (
            <a
              href="https://solo-wrk.com/pricing"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[12px] whitespace-nowrap text-accent hover:underline"
            >
              See Pro
            </a>
          )}
        </div>
      </div>

      {(busy === 'pack' || busy === 'zip') && (
        <p className="mt-3 text-[11.5px] text-muted">
          Rendering every invoice for the year and gathering the receipts. On a busy year this
          takes a minute.
        </p>
      )}
      {done !== '' && busy === '' && (
        <p className="mt-3 text-[11.5px] text-success">Saved to {done}</p>
      )}
      {missing.length > 0 && busy === '' && (
        <p className="mt-1.5 text-[11.5px] text-warning">
          {missing.length} file{missing.length === 1 ? '' : 's'} could not be read and {missing.length === 1 ? 'is' : 'are'} not in the ZIP:{' '}
          {missing.join(', ')}. The folder version has {missing.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      {error !== '' && <p className="mt-3 text-[11.5px] text-danger">{error}</p>}
    </Card>
  )
}

/**
 * The business logo, shown above the greeting on the dashboard.
 *
 * Copied into the workspace rather than referenced where it sits, so moving the
 * original does not leave a hole — the same rule as receipts and documents.
 */
function LogoCard({ logoFile }: { logoFile: string }): React.JSX.Element {
  const queryClient = useQueryClient()

  const { data: logo } = useQuery({
    queryKey: ['settings', 'logo', logoFile],
    queryFn: () => window.solo.invoke('settings:logo')
  })

  const refresh = (updated: SettingsType): void => {
    queryClient.setQueryData(['settings'], updated)
    void queryClient.invalidateQueries({ queryKey: ['settings', 'logo'] })
  }

  const choose = useMutation({
    mutationFn: async () => {
      const [file] = await window.solo.invoke('files:pick', { multiple: false })
      if (!file) return null
      return window.solo.invoke('settings:setLogo', { sourcePath: file })
    },
    onSuccess: (updated) => updated && refresh(updated)
  })

  const clear = useMutation({
    mutationFn: () => window.solo.invoke('settings:clearLogo'),
    onSuccess: refresh
  })

  return (
    <Card>
      <CardHeader title="Logo" />
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-card border border-line bg-raised">
          {logo ? (
            <img src={logo} alt="Business logo" className="h-full w-full object-contain" />
          ) : (
            <ImageIcon size={18} strokeWidth={1.5} className="text-faint" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink">Your mark, on the dashboard</p>
          <p className="mt-0.5 text-[11px] text-faint">
            PNG, JPG, WebP or SVG. Copied into Documents\Business so it travels with your
            workspace.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {logo && (
            <Button variant="ghost" onClick={() => clear.mutate()}>
              Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => choose.mutate()} disabled={choose.isPending}>
            <Upload size={14} strokeWidth={1.75} />
            {logo ? 'Replace' : 'Add logo'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * The business plan, attached as the document the user already has.
 *
 * A file rather than a textarea: everyone running a business has some version
 * of this written down already, and asking them to retype it is asking them not
 * to bother. The text is pulled out once and cached, and the preview is here so
 * you can see it read the right thing rather than taking it on trust.
 */
/**
 * The account a licence belongs to.
 *
 * Two cards rather than one, because they answer different questions: who is
 * signed in, and where the app asks. The second only matters while there is a
 * choice to make about it — once SoloWrk ships with a server baked in, that
 * card can go.
 */
function AccountCard(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [server, setServer] = useState<string | null>(null)

  const { data: auth } = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: () => window.solo.invoke('auth:state')
  })

  const settle = (next: Awaited<ReturnType<typeof window.solo.invoke<'auth:state'>>>): void => {
    queryClient.setQueryData(['auth', 'state'], next)
  }

  const setUrl = useMutation({
    mutationFn: (url: string) => window.solo.invoke('auth:setServer', { url }),
    onSuccess: (next) => {
      settle(next)
      setServer(null)
    }
  })

  const verify = useMutation({
    mutationFn: () => window.solo.invoke('auth:verify'),
    onSuccess: settle
  })

  const signOut = useMutation({
    mutationFn: () => window.solo.invoke('auth:signOut'),
    onSuccess: () => {
      queryClient.clear()
      window.location.reload()
    }
  })

  if (!auth) return <></>

  return (
    <>
      <Card>
        <CardHeader
          title="Account"
          action={
            auth.signedIn ? (
              <Button variant="ghost" size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
                {verify.isPending ? 'Checking…' : 'Check licence'}
              </Button>
            ) : undefined
          }
        />

        {auth.signedIn ? (
          <>
            <div className="flex items-center gap-3 rounded-control border border-line bg-raised px-3 py-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-[12px] font-medium text-accent">
                {(auth.account?.name || auth.account?.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] text-ink">
                  {auth.account?.name || auth.account?.email}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-faint">
                  {auth.account?.plan || 'Licensed'}
                  {auth.account?.expiresOn && ` · renews ${formatDate(auth.account.expiresOn)}`}
                  {auth.verifiedAt && ` · checked ${formatDate(auth.verifiedAt)}`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => signOut.mutate()}>
                Sign out
              </Button>
            </div>

            {auth.offline && (
              <p className="mt-2.5 text-[11.5px] text-warning">
                Could not reach the account server at the last check. SoloWrk keeps working —
                being offline is not a reason to lose access to your own records.
              </p>
            )}
          </>
        ) : auth.configured ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Not signed in. SoloWrk will ask the next time it starts.
          </p>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">
            No account server is set, so SoloWrk is not asking anyone to sign in. Set one below
            to turn licensing on.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Account server" />
        <p className="mb-3 text-[12px] leading-relaxed text-muted">
          Where SoloWrk checks licences. Leaving this empty turns sign-in off entirely, which is
          how it behaves before a licence server exists. Setting it makes signing in required on
          the next launch.
        </p>

        <div className="flex gap-2">
          <TextInput
            value={server ?? (auth.configured ? '' : '')}
            onChange={(event) => setServer(event.target.value)}
            placeholder="https://www.blockoutdigital.com/api"
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={() => setUrl.mutate(server ?? '')}
            disabled={server === null || setUrl.isPending}
          >
            {setUrl.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>

        <p className="mt-2.5 text-[11px] text-faint">
          {auth.configured
            ? 'A server is set. Clear the box and save to turn licensing off again.'
            : 'Nothing set — the app is ungated.'}
        </p>
      </Card>
    </>
  )
}

function BusinessPlanCard(): React.JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const { data: plan } = useQuery({
    queryKey: ['ai', 'businessPlan'],
    queryFn: () => window.solo.invoke('ai:businessPlan')
  })

  const attach = useMutation({
    mutationFn: async () => {
      const [file] = await window.solo.invoke('files:pick', { multiple: false })
      if (!file) return null
      return window.solo.invoke('ai:attachBusinessPlan', { sourcePath: file })
    },
    onMutate: () => setError(null),
    onSuccess: (status) => status && queryClient.setQueryData(['ai', 'businessPlan'], status),
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not read that file')
  })

  const detach = useMutation({
    mutationFn: () => window.solo.invoke('ai:detachBusinessPlan'),
    onSuccess: (status) => {
      setError(null)
      queryClient.setQueryData(['ai', 'businessPlan'], status)
    }
  })

  const attached = plan !== undefined && plan.file !== ''

  return (
    <Card>
      <CardHeader title="Business plan" />
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        Attach your business plan and the assistant reads it before every answer, so advice is
        about your business rather than freelancing in general. Word, PDF, markdown or plain
        text — it takes the words out and keeps a copy in your workspace.
      </p>

      {attached ? (
        <div className="flex items-center gap-3 rounded-control border border-line bg-raised px-3 py-2.5">
          <FileText size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] text-ink">{plan.name}</p>
            <p className="mt-0.5 text-[11px] text-faint">
              {plan.truncated ? (
                <span className="text-warning">
                  {plan.sentLength.toLocaleString('en-GB')} of{' '}
                  {plan.length.toLocaleString('en-GB')} characters sent — this document is
                  unusually large and had to be cut
                </span>
              ) : (
                `All ${plan.length.toLocaleString('en-GB')} characters are sent to the assistant`
              )}
              {plan.readAt && ` · ${formatDate(plan.readAt)}`}
            </p>
          </div>
          {/* The plan has its own page now — this card stays for attaching and
              detaching, and sends you there for anything to do with the content. */}
          <Button variant="ghost" size="sm" onClick={() => navigate('/business-plan')}>
            View plan
          </Button>
          <Button variant="ghost" size="sm" onClick={() => attach.mutate()}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" onClick={() => detach.mutate()}>
            Remove
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => attach.mutate()}
          disabled={attach.isPending}
          className="flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-line px-4 py-7 transition-colors hover:border-line-strong disabled:opacity-60"
        >
          <Upload size={18} strokeWidth={1.5} className="text-faint" />
          <span className="text-[12.5px] text-ink">
            {attach.isPending ? 'Reading…' : 'Attach your business plan'}
          </span>
          <span className="text-[11px] text-faint">PDF, Word, markdown or text</span>
        </button>
      )}

      {error && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-danger">
          <TriangleAlert size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {attached && plan.preview && (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-[10.5px] tracking-[0.06em] text-faint uppercase transition-colors hover:text-muted">
            What the assistant sees ▸
          </summary>
          {/* The whole document, scrollable. Showing the first paragraph under
              that heading implied the rest was not being read. */}
          <pre className="mt-1.5 max-h-[320px] overflow-auto rounded-control bg-ground/60 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
            {plan.preview}
          </pre>
        </details>
      )}
    </Card>
  )
}

/**
 * Theme templates.
 *
 * Every colour, font and radius in the app comes from a token, so a theme is
 * just a different set of values for those — which is why swatches here can
 * show a real preview rather than an approximation, and why changing one is
 * instant with nothing to reload.
 */
function ThemeCard(): React.JSX.Element {
  const { themeId, setThemeId } = useTheme()
  const today = todayString()

  // In-season themes come first, so the Christmas one is not buried at the
  // bottom of the list on the one day of the year anybody wants it.
  const ordered = [...THEMES].sort(
    (a, b) => Number(isInSeason(b, today)) - Number(isInSeason(a, today))
  )

  return (
    <Card>
      <CardHeader title="Theme" />
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        Changes colours, corners and the typeface across the whole app. Your choice is kept with
        the workspace, so it travels with it.
      </p>

      <div className="grid grid-cols-3 gap-2.5">
        {ordered.map((theme) => {
          const active = theme.id === themeId
          const inSeason = isInSeason(theme, today)

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setThemeId(theme.id)}
              className={cn(
                'overflow-hidden rounded-card border text-left transition-colors',
                active ? 'border-accent' : 'border-line hover:border-line-strong'
              )}
            >
              {/* A miniature of the app itself, painted in that theme's tokens —
                  a row of hex swatches would not tell you what it feels like. */}
              <div
                style={{ backgroundColor: theme.tokens.ground }}
                className="flex h-[74px] gap-1.5 p-2"
              >
                <div
                  style={{ backgroundColor: theme.tokens.surface, borderRadius: theme.radius / 2 }}
                  className="flex w-[26%] flex-col gap-1 p-1.5"
                >
                  <span
                    style={{ backgroundColor: theme.tokens.accent, borderRadius: 2 }}
                    className="h-1.5 w-full"
                  />
                  <span
                    style={{ backgroundColor: theme.tokens.line, borderRadius: 2 }}
                    className="h-1.5 w-3/4"
                  />
                  <span
                    style={{ backgroundColor: theme.tokens.line, borderRadius: 2 }}
                    className="h-1.5 w-2/3"
                  />
                </div>

                <div className="flex flex-1 flex-col gap-1.5">
                  <div
                    style={{
                      backgroundColor: theme.tokens.surface,
                      borderColor: theme.tokens.line,
                      borderRadius: theme.radius / 2
                    }}
                    className="flex flex-1 items-center gap-1.5 border p-1.5"
                  >
                    <span
                      style={{ backgroundColor: theme.tokens.ink, borderRadius: 2 }}
                      className="h-1.5 w-1/3 opacity-80"
                    />
                    <span
                      style={{ backgroundColor: theme.tokens.muted, borderRadius: 2 }}
                      className="h-1.5 w-1/4 opacity-70"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <span
                      style={{
                        backgroundColor: theme.tokens.accent,
                        borderRadius: Math.max(2, theme.radius - 4)
                      }}
                      className="h-4 w-12"
                    />
                    <span
                      style={{
                        backgroundColor: theme.tokens.raised,
                        borderRadius: Math.max(2, theme.radius - 4)
                      }}
                      className="h-4 w-8"
                    />
                    <span
                      style={{ backgroundColor: theme.tokens.success, borderRadius: 99 }}
                      className="h-4 w-4"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 border-t border-line p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-ink">
                    {theme.name}
                    {theme.season && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-1.5 py-px text-[9.5px] font-normal',
                          inSeason
                            ? 'border-accent/40 text-accent'
                            : 'border-line text-faint'
                        )}
                      >
                        {inSeason ? 'In season' : 'Seasonal'}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-faint">
                    {theme.description}
                  </p>
                </div>
                {active && (
                  <Check size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-accent" />
                )}
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/**
 * How much seasonal decoration to draw.
 *
 * Only shown when the current theme actually brings decoration with it — a dial
 * that does nothing on six of the eight themes would be furniture.
 */
function DecorCard(): React.JSX.Element | null {
  const { themeId, decorIntensity, setDecorIntensity } = useTheme()
  const theme = themeById(themeId)

  if (!theme.decor) return null

  return (
    <Card>
      <CardHeader title="Decoration" />
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        {theme.name} comes with something behind the app. It stays out of the way of your work
        and never sits over what you are reading — but on the days you would rather it did not,
        turn it off.
      </p>

      <div className="flex gap-2">
        {DECOR_INTENSITIES.map((option) => {
          const active = option.value === decorIntensity

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setDecorIntensity(option.value)}
              className={cn(
                'flex-1 rounded-control border px-3 py-2.5 text-left transition-colors',
                active
                  ? 'border-accent bg-accent/8'
                  : 'border-line hover:border-line-strong'
              )}
            >
              <p className={cn('text-[12.5px]', active ? 'text-ink' : 'text-muted')}>
                {option.label}
              </p>
              <p className="mt-0.5 text-[11px] text-faint">{option.hint}</p>
            </button>
          )
        })}
      </div>

      <p className="mt-2.5 text-[11px] text-faint">
        Hidden automatically when Windows is set to reduce animation.
      </p>
    </Card>
  )
}

/** Quiet, and deliberately the last thing on the page. */
function VersionFooter(): React.JSX.Element {
  const { data: version } = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => window.solo.invoke('app:version')
  })

  return (
    <p className="py-2 text-center text-[11px] text-white/25">
      SoloWrk v{version ?? '—'}
    </p>
  )
}

/**
 * Updates.
 *
 * The app checks and downloads on its own; this exists so the state is
 * somewhere you can look rather than something you have to trust, and so a
 * check can be forced without waiting six hours for the next one.
 */
function UpdatesCard(): React.JSX.Element {
  const updates = useUpdates()

  const { data: version } = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => window.solo.invoke('app:version')
  })

  const line = (): string => {
    switch (updates.status) {
      case 'checking':
        return 'Checking for updates…'
      case 'downloading':
        return `Downloading ${updates.version} — ${updates.percent}%`
      case 'ready':
        return `Version ${updates.version} is ready to install`
      case 'current':
        return 'You are on the latest version.'
      case 'error':
        return updates.error
      case 'unsupported':
        // Honest about why, rather than showing a check button that cannot work.
        return 'Updates apply to the installed app. This is running from source.'
      default:
        return 'Updates are checked a few times a day, and download in the background.'
    }
  }

  return (
    <Card>
      <CardHeader
        title="Updates"
        action={
          updates.status === 'ready' ? (
            <Button variant="primary" size="sm" onClick={updates.install}>
              <ArrowUpCircle size={13} strokeWidth={2} />
              Restart and update
            </Button>
          ) : updates.status === 'unsupported' ? undefined : (
            <Button
              variant="ghost"
              size="sm"
              onClick={updates.check}
              disabled={updates.status === 'checking' || updates.status === 'downloading'}
            >
              Check now
            </Button>
          )
        }
      />

      <p
        className={cn(
          'text-[12px] leading-relaxed',
          updates.status === 'error' ? 'text-danger' : 'text-muted'
        )}
      >
        {line()}
      </p>

      {updates.status === 'downloading' && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-raised">
          <motion.div
            className="h-full bg-accent"
            animate={{ width: `${updates.percent}%` }}
            transition={transition.press}
          />
        </div>
      )}

      <p className="mt-3 border-t border-line pt-2.5 text-[11px] text-faint">
        Installed version {version ?? '—'} · Nothing installs itself — an update
        waits until you restart.
      </p>
    </Card>
  )
}

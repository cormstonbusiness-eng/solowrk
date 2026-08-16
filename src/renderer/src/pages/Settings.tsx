import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Compass, FolderOpen, Image as ImageIcon, Loader2, Upload } from 'lucide-react'
import type { BusinessSettings, Settings as SettingsType } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { transition } from '@/lib/motion'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useTour } from '@/tour/TourProvider'

type Tab = 'business' | 'money' | 'assistant' | 'app'

const TABS: { value: Tab; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'money', label: 'Invoicing & tax' },
  { value: 'assistant', label: 'Assistant' },
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
        <div className="grid h-40 place-items-center">
          <Loader2 size={18} className="animate-spin text-faint" />
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
            </>}

          {tab === 'assistant' && <BusinessPlanCard />}

          {tab === 'app' && (
            <>
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

/** How long after you stop typing before the plan is written to disk. */
const PLAN_SAVE_DELAY_MS = 900

/**
 * The business plan the assistant reads before every answer.
 *
 * A real markdown file at Documents\Business Plan.md, not a settings field, so
 * it can be edited anywhere and the assistant's own file tools can reach it.
 */
function BusinessPlanCard(): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [saved, setSaved] = useState(true)
  const timer = useRef<NodeJS.Timeout | null>(null)

  const { data } = useQuery({
    queryKey: ['ai', 'businessPlan'],
    queryFn: () => window.solo.invoke('ai:businessPlan')
  })

  useEffect(() => {
    if (data && content === null) setContent(data.content)
  }, [data, content])

  const save = useMutation({
    mutationFn: (text: string) => window.solo.invoke('ai:saveBusinessPlan', { content: text }),
    onSuccess: () => setSaved(true)
  })

  function edit(text: string): void {
    setContent(text)
    setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save.mutate(text), PLAN_SAVE_DELAY_MS)
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <Card>
      <CardHeader
        title="Business plan"
        action={
          <span className="text-[10.5px] text-faint">{saved ? 'Saved' : 'Saving…'}</span>
        }
      />
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        The assistant reads this before every answer, so advice is about your business rather
        than freelancing in general. It is a real file at{' '}
        <span className="numeric text-faint">Documents\Business Plan.md</span> — edit it here or
        in any editor.
      </p>

      <textarea
        value={content ?? ''}
        onChange={(event) => edit(event.target.value)}
        rows={18}
        spellCheck
        className="w-full resize-y rounded-control border border-line bg-raised px-3 py-2 font-mono text-[12px] leading-relaxed text-ink focus:border-accent focus:outline-none"
        placeholder="Loading…"
      />
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

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  Compass,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  TriangleAlert,
  Upload
} from 'lucide-react'
import type { BusinessSettings, Settings as SettingsType } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { THEMES } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { transition } from '@/lib/motion'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useTour } from '@/tour/TourProvider'

type Tab = 'business' | 'money' | 'assistant' | 'appearance' | 'app'

const TABS: { value: Tab; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'money', label: 'Invoicing & tax' },
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

          {tab === 'appearance' && <ThemeCard />}

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

/**
 * The business plan, attached as the document the user already has.
 *
 * A file rather than a textarea: everyone running a business has some version
 * of this written down already, and asking them to retype it is asking them not
 * to bother. The text is pulled out once and cached, and the preview is here so
 * you can see it read the right thing rather than taking it on trust.
 */
function BusinessPlanCard(): React.JSX.Element {
  const queryClient = useQueryClient()
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
              {plan.length.toLocaleString('en-GB')} characters read
              {plan.readAt && ` · ${formatDate(plan.readAt)}`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void window.solo.invoke('ai:openBusinessPlan')}>
            Open
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
        <div className="mt-3">
          <p className="mb-1 text-[10.5px] tracking-[0.06em] text-faint uppercase">
            What the assistant sees
          </p>
          <pre className="max-h-[180px] overflow-auto rounded-control bg-ground/60 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
            {plan.preview}
            {plan.length > plan.preview.length && '…'}
          </pre>
        </div>
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

  return (
    <Card>
      <CardHeader title="Theme" />
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        Changes colours, corners and the typeface across the whole app. Your choice is kept with
        the workspace, so it travels with it.
      </p>

      <div className="grid grid-cols-3 gap-2.5">
        {THEMES.map((theme) => {
          const active = theme.id === themeId

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
                  <p className="truncate text-[12.5px] font-medium text-ink">{theme.name}</p>
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

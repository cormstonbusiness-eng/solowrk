import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, FolderOpen, Loader2 } from 'lucide-react'
import type { BusinessSettings, Settings as SettingsType } from '@shared/types'
import { Page } from '@/components/Page'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, MoneyInput, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { transition } from '@/lib/motion'
import { useWorkspace } from '@/hooks/useWorkspace'

/**
 * Settings edits a local draft and saves explicitly. Auto-save would be fine
 * for toggles but wrong for text fields — half-typed VAT numbers should not
 * reach invoices.
 */
export function Settings(): React.JSX.Element {
  const queryClient = useQueryClient()
  const workspace = useWorkspace()
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.solo.invoke('settings:get')
  })

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
      description="Business details, workspace and invoicing."
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
      <div className="flex max-w-[760px] flex-col gap-3">
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
      </div>
    </Page>
  )
}
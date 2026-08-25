import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { Check, Loader2, Mail, TriangleAlert } from 'lucide-react'
import type { BusinessSettings, Settings as SettingsType } from '@shared/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Expand } from '@/components/ui/Expand'
import { Field, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { presetFor } from '@shared/smtp'

/**
 * The user's own mail account.
 *
 * Its own card, and its own save, because the password does not belong to the
 * settings draft — it never goes into the workspace database and never comes
 * back out of the keychain, so it cannot travel with the rest of the patch. The
 * only thing the renderer ever learns about it is whether one is stored.
 *
 * The test button matters more than it looks. Everything else here can be typed
 * correctly and still not work: Gmail and Microsoft both want an app password
 * rather than the account password, and the way anybody finds that out should
 * be a message in Settings, not a chaser that never arrived.
 */
export function MailCard({
  draft,
  set
}: {
  draft: SettingsType
  set: <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [tested, setTested] = useState<'ok' | string | null>(null)

  const { data: status } = useQuery({
    queryKey: ['mail', 'status'],
    queryFn: () => window.solo.invoke('mail:status')
  })

  const savePassword = useMutation({
    mutationFn: (value: string) => window.solo.invoke('mail:password', { password: value }),
    onSuccess: () => {
      setPassword('')
      setTested(null)
      void queryClient.invalidateQueries({ queryKey: ['mail'] })
    }
  })

  const test = useMutation({
    mutationFn: () => window.solo.invoke('mail:test'),
    onSuccess: () => setTested('ok'),
    // The server's own words. "535 Incorrect authentication data" tells
    // somebody what to fix; "Send failed" tells them nothing.
    onError: (error: Error) => setTested(error.message)
  })

  /**
   * Filling in the host from the address is a guess, and it is only offered
   * while the host is empty — quietly rewriting a host somebody has already
   * set would be worse than not helping at all.
   */
  const suggest = (address: string): void => {
    if (draft.smtpHost.trim() !== '') return
    const preset = presetFor(address)
    if (!preset) return

    set('smtpHost', preset.host)
    set('smtpPort', preset.port)
    set('smtpSecure', preset.secure)
  }

  return (
    <Card>
      <CardHeader
        title="Sending mail"
        action={
          status?.configured && (
            <span className="flex items-center gap-1.5 text-[11px] text-success">
              <Check size={12} strokeWidth={2.5} />
              Set up
            </span>
          )
        }
      />

      <p className="mb-3.5 text-[12.5px] leading-relaxed text-muted">
        Chasers go out through your own email account, from your own address — so the reply comes
        back to you and a copy lands in your sent folder. SoloWrk does not run a mail server and
        never sees your messages.
      </p>

      <div className="flex flex-col gap-3.5">
        <Field label="Your email address" hint="What the client sees it from.">
          <TextInput
            value={draft.smtpUser}
            placeholder="you@yourbusiness.co.uk"
            onChange={(event) => set('smtpUser', event.target.value)}
            onBlur={(event) => suggest(event.target.value)}
          />
        </Field>

        <div className="flex gap-2">
          <div className="flex-1">
            <Field label="Server" hint="Your provider's outgoing (SMTP) server.">
              <TextInput
                value={draft.smtpHost}
                placeholder="smtp.gmail.com"
                onChange={(event) => set('smtpHost', event.target.value)}
              />
            </Field>
          </div>
          <div className="w-[92px]">
            <Field label="Port">
              <NumberInput
                value={draft.smtpPort}
                onChangeValue={(value) => set('smtpPort', value)}
              />
            </Field>
          </div>
        </div>

        <Toggle
          checked={draft.smtpSecure}
          onChange={(checked) => set('smtpSecure', checked)}
          label="Connect over TLS immediately"
          hint="On for port 465. Off for 587, which upgrades to TLS after connecting — either way the password is never sent in the clear."
        />

        <Field
          label="Password"
          hint={
            status?.hasPassword
              ? 'Stored in Windows. Type a new one to replace it.'
              : 'Gmail and Microsoft accounts need an app password, not your normal one.'
          }
        >
          <div className="flex gap-2">
            <TextInput
              type="password"
              value={password}
              placeholder={status?.hasPassword ? '••••••••••••' : ''}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={password === '' || savePassword.isPending}
              onClick={() => savePassword.mutate(password)}
            >
              Save
            </Button>
          </div>
        </Field>

        <div className="flex items-center gap-2 border-t border-line pt-3.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={!status?.configured || test.isPending}
            onClick={() => {
              setTested(null)
              test.mutate()
            }}
          >
            {test.isPending ? (
              <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Mail size={13} strokeWidth={1.75} />
            )}
            Send myself a test
          </Button>

          {tested === 'ok' && (
            <span className="flex items-center gap-1.5 text-[12px] text-success">
              <Check size={13} strokeWidth={2.5} />
              Sent — check your inbox
            </span>
          )}
        </div>

        <AnimatePresence initial={false}>
          {tested !== null && tested !== 'ok' && (
            <Expand>
              <div className="flex gap-2.5 rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5">
                <TriangleAlert
                  size={14}
                  strokeWidth={1.75}
                  className="mt-px shrink-0 text-danger"
                />
                <p className="text-[12px] leading-relaxed text-ink">{tested}</p>
              </div>
            </Expand>
          )}
        </AnimatePresence>
      </div>
    </Card>
  )
}

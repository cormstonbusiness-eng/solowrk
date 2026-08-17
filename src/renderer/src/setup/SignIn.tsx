import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, HardDrive, Loader2, Lock, TriangleAlert } from 'lucide-react'
import type { AuthState } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Signing in to the account a licence belongs to.
 *
 * The design problem here is a real one rather than a visual one. SoloWrk's own
 * first screen says "no cloud account, no sync, no subscription holding your
 * files" — so a login wall is, on the face of it, the app contradicting itself.
 * Anyone who bought it for that reason will feel the contradiction immediately.
 *
 * So the screen's job is to resolve it, and the strip at the bottom is doing
 * that work: it says what the account touches and what it does not, side by
 * side, because the honest answer is genuinely reassuring. It is the one piece
 * of structure here that is not a form field, and it earns its place.
 *
 * Everything else stays quiet and matches the setup wizard it hands over to.
 */
export function SignIn({
  state,
  onSignedIn
}: {
  state: AuthState
  onSignedIn: (next: AuthState) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(state.account?.email ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const joining = mode === 'up'
  const ready = email.trim() !== '' && password !== '' && (!joining || name.trim() !== '')

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready || busy) return

    setBusy(true)
    setError('')

    try {
      const next = joining
        ? await window.solo.invoke('auth:signUp', { name, email, password })
        : await window.solo.invoke('auth:signIn', { email, password })

      onSignedIn(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
      // Never the email — retyping an address you got right is a small insult.
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ground px-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-[9px] bg-accent" aria-hidden />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">SoloWrk</span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={transition.page}
          >
            <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
              {joining ? 'Create your account' : 'Sign in'}
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
              {joining
                ? 'This is the account your licence belongs to. Use the email you bought with.'
                : 'Use the account you bought your licence with.'}
            </p>

            <form onSubmit={submit} className="mt-6 flex flex-col gap-3.5">
              {joining && (
                <Field label="Your name">
                  <TextInput
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alex Fisher"
                    autoComplete="name"
                  />
                </Field>
              )}

              <Field label="Email">
                <TextInput
                  autoFocus={!joining}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@yourbusiness.com"
                  autoComplete="email"
                />
              </Field>

              <Field label="Password">
                <TextInput
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={joining ? 'At least 8 characters' : ''}
                  autoComplete={joining ? 'new-password' : 'current-password'}
                />
              </Field>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] leading-relaxed text-danger"
                >
                  <TriangleAlert size={13} strokeWidth={1.75} className="mt-px shrink-0" />
                  {error}
                </motion.p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={!ready || busy}
                className="mt-1 w-full"
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ArrowRight size={15} strokeWidth={1.75} />
                )}
                {busy
                  ? joining
                    ? 'Creating your account…'
                    : 'Signing in…'
                  : joining
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </form>

            <p className="mt-4 text-center text-[12.5px] text-muted">
              {joining ? 'Already bought SoloWrk?' : "Bought SoloWrk but haven't set up an account?"}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(joining ? 'in' : 'up')
                  setError('')
                }}
                className="text-accent underline-offset-2 hover:underline"
              >
                {joining ? 'Sign in' : 'Create one'}
              </button>
            </p>
          </motion.div>
        </AnimatePresence>

        <WhatTheAccountTouches />
        <ServerRow onChanged={onSignedIn} />
      </div>
    </div>
  )
}

/**
 * Which server is being asked, and a way to change it.
 *
 * Not a debug affordance. A sign-in screen is the one place someone can be
 * completely stuck: if the address is wrong, or the server has moved, every
 * other route into the app is behind the very screen that cannot work. Without
 * this the only way out is hand-editing JSON in AppData, which is not a thing
 * to ask of anyone.
 *
 * Clearing it turns licensing off and returns to the app. That is deliberate
 * while SoloWrk has no licence server: it means setting one is reversible. When
 * a real server ships as a compiled-in default, this becomes "change", not
 * "clear".
 */
function ServerRow({ onChanged }: { onChanged: (next: AuthState) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    setSaving(true)
    try {
      onChanged(await window.solo.invoke('auth:setServer', { url }))
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <p className="mt-4 text-center text-[11.5px] text-faint">
        Can’t sign in?{' '}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="underline-offset-2 hover:text-muted hover:underline"
        >
          Change the account server
        </button>
      </p>
    )
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-surface p-3">
      <p className="mb-2 text-[11.5px] leading-relaxed text-muted">
        Where SoloWrk checks your licence. Leave it empty to use SoloWrk without an account.
      </p>
      <div className="flex gap-2">
        <TextInput
          autoFocus
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.blockoutdigital.com/api"
          className="flex-1"
        />
        <Button variant="secondary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/**
 * The reassurance, stated as fact rather than as a promise.
 *
 * Two columns because the point is the contrast: the things that stay on this
 * machine, and the one thing that leaves it. Anything vaguer — "we respect your
 * privacy" — would be exactly the sentence nobody believes.
 */
function WhatTheAccountTouches(): React.JSX.Element {
  return (
    <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line">
      <Column
        icon={HardDrive}
        heading="Stays on this PC"
        items={['Clients and projects', 'Invoices and quotes', 'Time, files and notes']}
      />
      <Column
        icon={Lock}
        heading="On your account"
        // Kept exactly true. The app sends the computer's name so you can tell
        // your machines apart when freeing up a licence, and a list that says
        // "your licence, your email" while quietly sending a third thing is
        // the sort of small dishonesty this panel exists to avoid.
        items={['Your licence', 'Your email', 'This computer’s name']}
      />
    </div>
  )
}

function Column({
  icon: Icon,
  heading,
  items
}: {
  icon: typeof HardDrive
  heading: string
  items: string[]
}): React.JSX.Element {
  return (
    <div className="bg-surface px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
        <Icon size={11} strokeWidth={2} />
        {heading}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className={cn('text-[11.5px] leading-snug text-muted')}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

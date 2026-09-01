import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, Check, Copy, Minus, RotateCw, Square, X } from 'lucide-react'
import type { WindowState } from '@shared/ipc'
import { Timer } from './Timer'
import { themeById, type DecorKind } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import { useUpdates } from '@/hooks/useUpdates'
import { Petal, Pumpkin, Snowflake, Sparkle } from '@/components/seasonal/sprites'
import { Wordmark } from '@/components/Wordmark'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The window is frameless, so these are our own chrome controls. They mirror
 * Windows' geometry (46x32 hit areas, red close) so the app still behaves the
 * way muscle memory expects, while matching the app's palette rather than
 * sitting in a grey OS bar on top of it.
 */
function ControlButton({
  onClick,
  label,
  danger,
  children
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'no-drag grid h-8 w-[46px] place-items-center text-muted',
        'transition-colors duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]',
        danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-hover hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

/**
 * A small seasonal mark beside the wordmark. Static — the titlebar is the one
 * strip of the window that is always on screen, so nothing here should move.
 */
const MARKS: Partial<Record<DecorKind, (props: { className?: string }) => React.JSX.Element>> = {
  halloween: Pumpkin,
  christmas: Snowflake,
  newyear: Sparkle,
  spring: Petal
}

function Flourish(): React.JSX.Element | null {
  const { themeId, decorIntensity } = useTheme()
  const decor = themeById(themeId).decor
  const Mark = decorIntensity === 'off' || !decor ? null : MARKS[decor]

  if (!Mark) return null
  return <Mark className="h-3 w-3 text-muted opacity-70" />
}

/**
 * Says an update exists, from the moment one is found.
 *
 * Deliberately visible during the download as well as after it. A 190 MB
 * installer takes minutes, and staying silent for those minutes means the
 * button appears out of nowhere with no explanation of where it came from.
 * Announcing the update and then showing it arrive is the honest version.
 *
 * Nothing here ever installs on its own — the last step is always a button.
 * Nobody should have the app close on them mid-invoice.
 */
function UpdatePrompt(): React.JSX.Element | null {
  const updates = useUpdates()

  const downloading = updates.status === 'downloading'
  const ready = updates.status === 'ready'
  if (!downloading && !ready) return null

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.press}
      onClick={ready ? updates.install : undefined}
      // Not a button yet while it downloads — pressing it could not do
      // anything, and a button that ignores you is worse than a label.
      disabled={!ready}
      title={
        ready
          ? `Version ${updates.version} is downloaded — click to restart and update`
          : `Downloading version ${updates.version}`
      }
      className={cn(
        'no-drag mr-2 flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px]',
        'transition-colors',
        ready
          ? 'bg-accent text-accent-ink hover:bg-accent/85'
          : 'bg-accent/12 text-accent cursor-default'
      )}
    >
      <ArrowUpCircle
        size={11}
        strokeWidth={2}
        className={cn('shrink-0', downloading && 'animate-pulse')}
      />
      {ready ? (
        `Update to ${updates.version} — restart`
      ) : (
        <>
          Update {updates.version} downloading
          <span className="numeric opacity-70">{updates.percent}%</span>
        </>
      )}
    </motion.button>
  )
}

/**
 * Refresh, beside the wordmark.
 *
 * Three things at once, because they are the three reasons somebody thinks the
 * app looks stale: re-read everything on screen from the workspace, re-check
 * the licence, and ask whether there is a newer version.
 *
 * The licence check is in here deliberately. Buying Pro, or having a payment
 * go through, otherwise takes up to six hours to show up — and telling someone
 * to go to Settings and press a different button to see what they have just
 * paid for is not an answer.
 *
 * Deliberately not a page reload. A reload would throw away the route and
 * anything half-typed in a form, to fix a problem that is almost always just
 * cached data — and the workspace is the source of truth either way.
 */
function RefreshButton(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [note, setNote] = useState('')

  async function refresh(): Promise<void> {
    if (phase === 'working') return
    setPhase('working')
    setNote('')

    // Held for a beat even when everything answers instantly. A spinner that
    // appears and disappears inside one frame reads as a button that did
    // nothing, and the honest signal here is "I heard you", not the millisecond
    // count.
    const beat = new Promise((resolve) => setTimeout(resolve, 550))

    const [update, auth] = await Promise.all([
      window.solo.invoke('updates:check').catch(() => null),
      window.solo.invoke('auth:verify').catch(() => null),
      queryClient.invalidateQueries(),
      beat
    ])

    // Straight into the cache the sidebar and every feature gate read, so an
    // upgrade bought a minute ago unlocks without a restart.
    if (auth) queryClient.setQueryData(['auth', 'state'], auth)

    if (update?.status === 'error') {
      setNote(update.error || 'Could not check for updates')
      setPhase('failed')
    } else {
      // Nothing to say when an update is downloading or ready — the prompt in
      // the middle of the titlebar is already saying it, louder.
      setNote(update?.status === 'current' ? 'You have the latest version' : '')
      setPhase('done')
    }

    setTimeout(() => setPhase('idle'), 2400)
  }

  const working = phase === 'working'

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={working}
      aria-label="Refresh, and check for updates"
      title={
        note ||
        (working ? 'Refreshing…' : 'Refresh — reload your data and check for a new version')
      }
      className={cn(
        // 22px rather than the 24px target-size minimum, which it meets on the
        // spacing exception instead: nothing else is clickable for 200px in
        // either direction. A 24px hover square starts to dominate a 32px bar.
        'no-drag grid h-[22px] w-[22px] place-items-center rounded-[4px]',
        'transition-colors duration-150',
        // The app's global reduced-motion rule stops `animate-spin` dead, so
        // the spinner cannot be the only sign that anything is happening.
        working && 'opacity-55',
        phase === 'done'
          ? 'text-success'
          : phase === 'failed'
            ? 'text-danger'
            : // Matches the wordmark it sits beside rather than the flourish.
            // `faint` measures 2.9:1 on the titlebar, under the 3:1 floor for
            // a control somebody is meant to find and press; `muted` is 5.8:1.
            'text-muted hover:bg-hover hover:text-ink'
      )}
    >
      {phase === 'done' ? (
        <Check size={12} strokeWidth={2.5} />
      ) : (
        <RotateCw size={12} strokeWidth={2} className={cn(working && 'animate-spin')} />
      )}
    </button>
  )
}

export function TitleBar(): React.JSX.Element {
  const [state, setState] = useState<WindowState>({ isMaximized: false, isFocused: true })

  useEffect(() => {
    void window.solo.invoke('window:state').then(setState)
    return window.solo.on('window:stateChanged', setState)
  }, [])

  return (
    <header
      className={cn(
        'drag-region flex h-8 shrink-0 items-center justify-between',
        'border-b border-line bg-ground select-none',
        // Unfocused windows recede, the way native ones do.
        !state.isFocused && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2.5 pl-3">
        {/*
          The real wordmark, at the height the 11px text it replaced stood at.

          The accent square that used to sit beside it has gone: the wordmark
          carries its own orange full stop, and two orange squares within 50px
          of each other is a lockup arguing with itself.

          Held at 70% because a title bar is chrome. At full strength the
          brightest thing in the window is its own furniture, which is the
          mistake every app that puts a logo up here makes.
        */}
        <Wordmark height={11} className="opacity-70" />
        <RefreshButton />
        <Flourish />
      </div>

      {/* Centred so it reads as a status, not another control. */}
      <div className="flex flex-1 justify-center">
        <UpdatePrompt />
        <Timer />
      </div>

      <div className="flex items-center">
        <ControlButton label="Minimise" onClick={() => void window.solo.invoke('window:minimize')}>
          <Minus size={14} strokeWidth={1.75} />
        </ControlButton>
        <ControlButton
          label={state.isMaximized ? 'Restore' : 'Maximise'}
          onClick={() => void window.solo.invoke('window:toggleMaximize')}
        >
          {state.isMaximized ? (
            <Copy size={12} strokeWidth={1.75} className="-scale-x-100" />
          ) : (
            <Square size={11} strokeWidth={1.75} />
          )}
        </ControlButton>
        <ControlButton label="Close" danger onClick={() => void window.solo.invoke('window:close')}>
          <X size={15} strokeWidth={1.75} />
        </ControlButton>
      </div>
    </header>
  )
}
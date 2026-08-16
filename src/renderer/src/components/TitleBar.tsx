import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUpCircle, Copy, Minus, Square, X } from 'lucide-react'
import type { WindowState } from '@shared/ipc'
import { Timer } from './Timer'
import { themeById, type DecorKind } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import { useUpdates } from '@/hooks/useUpdates'
import { Petal, Pumpkin, Snowflake, Sparkle } from '@/components/seasonal/sprites'
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
      <div className="flex items-center gap-2 pl-3">
        <div className="h-3 w-3 rounded-[3px] bg-accent" aria-hidden />
        {/* Not uppercased: the capital W is the whole point of the wordmark. */}
        <span className="text-[11px] font-medium tracking-[0.06em] text-muted">SoloWrk</span>
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
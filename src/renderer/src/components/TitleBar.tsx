import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import type { WindowState } from '@shared/ipc'
import { Timer } from './Timer'
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
      </div>

      {/* Centred so it reads as a status, not another control. */}
      <div className="flex flex-1 justify-center">
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
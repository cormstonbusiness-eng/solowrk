import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { themeById, type DecorKind } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import { Chick, Firework, GhostFriendly, Snowman } from '@/components/seasonal/sprites'
import { transition } from '@/lib/motion'

/**
 * A seasonal stand-in for the icon, when a seasonal theme is on.
 *
 * The best place in the app for a bit of character: the screen is empty
 * anyway, so it costs nothing in attention. Read from the theme here rather
 * than passed in, so not one of the twenty call sites has to change.
 */
const CHARACTERS: Partial<Record<DecorKind, (props: { className?: string }) => React.JSX.Element>> =
  {
    halloween: GhostFriendly,
    christmas: Snowman,
    spring: Chick,
    newyear: Firework
  }

/** Shown when a list has nothing in it yet, with the action that fills it. */
export function Empty({
  icon: Icon,
  title,
  body,
  action
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: React.ReactNode
}): React.JSX.Element {
  const { themeId, decorIntensity } = useTheme()
  const decor = themeById(themeId).decor
  // Off means off everywhere, including here.
  const Character = decorIntensity === 'off' || !decor ? null : CHARACTERS[decor]

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.page}
      className="grid min-h-[280px] place-items-center rounded-card border border-dashed border-line"
    >
      <div className="max-w-sm px-6 text-center">
        {Character ? (
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center">
            <Character className="h-full w-full text-muted" />
          </div>
        ) : (
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-panel border border-line bg-surface">
            <Icon size={17} strokeWidth={1.5} className="text-faint" />
          </div>
        )}
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">{body}</p>
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </motion.div>
  )
}

/** A small coloured dot — the shared visual language for colour-coding. */
export function Dot({ colour, size = 8 }: { colour: string; size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: colour, width: size, height: size }}
      className="inline-block shrink-0 rounded-full"
    />
  )
}

export function Pill({
  colour,
  children
}: {
  colour: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      style={{ color: colour, backgroundColor: `${colour}1a`, borderColor: `${colour}33` }}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
    >
      {children}
    </span>
  )
}
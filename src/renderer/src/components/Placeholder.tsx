import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { transition } from '@/lib/motion'

/**
 * Phase 0 stand-in for sections that arrive in later phases. It states which
 * phase builds the section so the shell is honest about what is not there yet,
 * rather than showing a convincing but empty screen.
 */
export function Placeholder({
  icon: Icon,
  phase,
  summary,
  features
}: {
  icon: LucideIcon
  phase: string
  summary: string
  features: string[]
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...transition.page, delay: 0.05 }}
      className="grid h-full place-items-center"
    >
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-panel border border-line bg-surface">
          <Icon size={20} strokeWidth={1.5} className="text-accent" />
        </div>
        <p className="mb-1 text-[11px] font-medium tracking-[0.1em] text-faint uppercase">
          {phase}
        </p>
        <p className="text-[13px] leading-relaxed text-muted">{summary}</p>
        <ul className="mt-4 inline-flex flex-wrap justify-center gap-1.5">
          {features.map((feature) => (
            <li
              key={feature}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-muted"
            >
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  )
}
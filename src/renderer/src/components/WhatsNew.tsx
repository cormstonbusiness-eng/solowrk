import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import { takeUnlocked, useCelebrations } from '@/lib/celebrate'
import { EASE, transition } from '@/lib/motion'

/**
 * What a licence just unlocked, with a way into each of it.
 *
 * "Upgraded successfully" tells somebody nothing about what changed. This
 * lists the features by what they *do* and links straight into them, because
 * the moment somebody has just paid is the only moment they are guaranteed to
 * be curious — and a feature nobody finds in the first week is a feature they
 * cancel over in the second.
 *
 * Shown once. The unlock arrives while the app is already running — the
 * licence check is a background poll — so this watches the store rather than
 * reading it on mount, and takes the news the moment it lands.
 */

interface Unlocked {
  feature: string
  title: string
  body: string
  to: string
}

/**
 * Keyed on the same strings the licence server issues and `gating.ts` matches.
 * A feature with no entry here is simply not listed rather than shown as a
 * bare slug — "bank" on its own means nothing to anybody.
 */
const CATALOGUE: Record<string, Omit<Unlocked, 'feature'>> = {
  marketing: {
    title: 'Marketing',
    body: 'A pipeline, a content calendar and outreach, so work arrives before you need it.',
    to: '/marketing'
  },
  chasing: {
    title: 'Automatic chasers',
    body: 'Overdue invoices get a note drafted on a schedule. You still press send.',
    to: '/invoices'
  },
  yearend: {
    title: 'The year-end pack',
    body: 'One folder — or one ZIP — with everything your accountant asks for in January.',
    to: '/settings'
  },
  assistant: {
    title: 'The assistant',
    body: 'Runs on your own Claude account, reads your real numbers, drafts from them.',
    to: '/assistant'
  },
  bank: {
    title: 'Bank import',
    body: 'Read a statement you downloaded and match it against your invoices.',
    to: '/finance'
  }
}

export function WhatsNew(): React.JSX.Element {
  const navigate = useNavigate()
  const [items, setItems] = useState<Unlocked[]>([])

  const { unlocked } = useCelebrations()

  useEffect(() => {
    if (unlocked.length === 0) return

    // Taken, so it clears the store and cannot be shown a second time.
    setItems(
      takeUnlocked()
        .map((feature) => {
          const entry = CATALOGUE[feature]
          return entry ? { feature, ...entry } : null
        })
        .filter((one): one is Unlocked => one !== null)
    )
  }, [unlocked])

  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8, transition: { duration: 0.15, ease: EASE } }}
          transition={transition.page}
          className="fixed right-4 bottom-4 z-50 w-[340px] overflow-hidden rounded-card border border-accent/40 bg-overlay shadow-modal"
        >
          <div className="flex items-start gap-2.5 border-b border-line p-3.5">
            <Sparkles size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">Pro unlocked</p>
              <p className="mt-0.5 text-[11.5px] text-muted">Here is what you can do now.</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setItems([])}
              className="text-faint transition-colors duration-press ease-solo hover:text-ink"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>

          <div className="flex flex-col p-1.5">
            {items.map((item) => (
              <button
                key={item.feature}
                type="button"
                onClick={() => {
                  navigate(item.to)
                  setItems([])
                }}
                className="group flex items-start gap-2.5 rounded-control p-2.5 text-left transition-colors duration-press ease-solo hover:bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-ink">{item.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{item.body}</p>
                </div>
                <ArrowRight
                  size={13}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-faint transition-transform duration-press ease-solo group-hover:translate-x-0.5"
                />
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

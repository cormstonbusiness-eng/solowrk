import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Lightbulb, Search } from 'lucide-react'
import { GUIDES, GUIDE_GROUPS, searchGuides, type Guide } from '@shared/guides'
import { Page } from '@/components/Page'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { tierNameFor } from '@/lib/features'
import { useFeature } from '@/lib/features'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * How to use what you are looking at.
 *
 * The tour runs once and points at where things are. This is for three weeks
 * later, when somebody is trying to get something done and cannot remember
 * whether archiving a task loses it.
 *
 * An index down the side and one guide at a time, rather than a scrolling
 * wall of everything: a help page you have to scroll past nine other topics
 * to reach is a help page nobody reads twice.
 *
 * Guides are never gated, including the ones describing paid features.
 * Somebody deciding whether to pay for Marketing needs to be able to read
 * what it does, and a locked help page would be the single most
 * self-defeating paywall in the app.
 */
export function Guides(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(GUIDES[0]!.id)

  const found = useMemo(() => searchGuides(GUIDES, search), [search])

  // Searching narrows the index; if what you were reading falls out of it,
  // follow the search rather than leaving a selected item nothing points at.
  const open = found.find((guide) => guide.id === openId) ?? found[0]

  return (
    <Page
      title="Guides"
      description="How each part of SoloWrk works, and the bits that are not obvious."
      className="flex min-h-0 flex-col overflow-y-hidden"
    >
      <div className="flex min-h-0 flex-1 gap-5">
        <aside className="flex w-[232px] shrink-0 flex-col gap-2 overflow-y-auto">
          <div className="relative">
            <Search
              size={13}
              strokeWidth={1.75}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <TextInput
              value={search}
              placeholder="Search guides"
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
            />
          </div>

          {found.length === 0 ? (
            <p className="px-1 py-2 text-[11.5px] leading-relaxed text-faint">
              Nothing about that yet. Try a shorter word — the search looks inside the guides, not
              just at their titles.
            </p>
          ) : (
            GUIDE_GROUPS.map((group) => {
              const inGroup = found.filter((guide) => guide.group === group)
              if (inGroup.length === 0) return null

              return (
                <div key={group} className="flex flex-col gap-0.5">
                  <p className="px-1 pt-1.5 pb-1 text-[10px] font-medium tracking-[0.1em] text-faint uppercase">
                    {group}
                  </p>

                  {inGroup.map((guide) => (
                    <button
                      key={guide.id}
                      type="button"
                      onClick={() => setOpenId(guide.id)}
                      className={cn(
                        'rounded-control px-2 py-1.5 text-left text-[12.5px] transition-colors',
                        open?.id === guide.id
                          ? 'bg-raised text-ink'
                          : 'text-muted hover:bg-raised hover:text-ink'
                      )}
                    >
                      {guide.title}
                    </button>
                  ))}
                </div>
              )
            })
          )}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {open && (
              <motion.article
                key={open.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={transition.page}
                className="max-w-[680px] pb-8"
              >
                <Article guide={open} />
              </motion.article>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Page>
  )
}

function Article({ guide }: { guide: Guide }): React.JSX.Element {
  const navigate = useNavigate()
  const entitled = useFeature(guide.feature ?? 'marketing')
  const locked = guide.feature !== undefined && !entitled

  return (
    <>
      <header className="mb-5">
        <h2 className="text-[19px] font-medium text-ink">{guide.title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{guide.summary}</p>

        <div className="mt-3 flex items-center gap-2">
          {guide.route && (
            <Button variant="outline" size="sm" onClick={() => navigate(guide.route!)}>
              Open it
              <ArrowRight size={13} strokeWidth={1.75} />
            </Button>
          )}

          {/*
            Said plainly rather than hidden. Somebody deciding whether to pay
            for a feature needs to read what it does first, so the guide is
            never locked — it just tells you where the feature lives.
          */}
          {locked && (
            <span className="text-[11.5px] text-faint">
              Needs SoloWrk {tierNameFor(guide.feature!)}.
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-5">
        {guide.sections.map((section) => (
          <section key={section.heading}>
            <h3 className="mb-1.5 text-[13.5px] font-medium text-ink">{section.heading}</h3>

            {section.body?.map((paragraph) => (
              <p key={paragraph} className="mb-2 text-[13px] leading-relaxed text-muted">
                {paragraph}
              </p>
            ))}

            {section.steps && (
              <ul className="my-2 flex flex-col gap-1">
                {section.steps.map((step) => (
                  <li key={step} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            )}

            {section.tip && (
              <p className="mt-2 flex items-start gap-2 rounded-control border border-line bg-raised px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
                <Lightbulb size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
                <span>{section.tip}</span>
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  )
}

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Page } from '@/components/Page'
import { ProPanel } from '@/components/ProPanel'
import { useFeature } from '@/lib/features'
import { transition } from '@/lib/motion'
import { CampaignsTab } from './marketing/CampaignsTab'
import { ContentTab } from './marketing/ContentTab'
import { PlanTab } from './marketing/PlanTab'

/**
 * Where the next job is coming from.
 *
 * §2 specifies five tabs — Plan, Campaigns, Content, Library, Results. Three
 * are here, and Library and Results arrive with the stages that fill them. A
 * tab that opens onto "coming soon" is worse than a tab that is not there yet:
 * it costs a click to learn nothing, and it makes the ones that work look like
 * part of something broken.
 *
 * Content is the default because it is the one somebody opens most days. Plan
 * is monthly, and Results — when it exists — is quarterly.
 */

type Tab = 'content' | 'campaigns' | 'plan'

const TABS: { value: Tab; label: string }[] = [
  { value: 'content', label: 'Content' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'plan', label: 'Plan' }
]

export function Marketing(): React.JSX.Element {
  const entitled = useFeature('marketing')
  const [tab, setTab] = useState<Tab>('content')

  /**
   * Checked before any child mounts a query.
   *
   * Returning early keeps the page from firing requests the main process is
   * going to refuse, which would fill the console with rejections and flash an
   * empty calendar before the panel appeared.
   */
  if (!entitled) {
    return (
      <Page title="Marketing" description="Where the next job is coming from.">
        <ProPanel
          feature="marketing"
          title="Know where the next job is coming from"
          blurb="Say how often you mean to show up on each channel, and the calendar draws the gaps. It plans, writes and records — it does not post for you, and it never pretends to."
          does={[
            {
              title: 'A commitment you can see',
              body: 'Two a week on LinkedIn, one a month by email. The weeks you miss show up as gaps rather than as nothing at all.'
            },
            {
              title: 'A calendar and a pipeline',
              body: 'Ideas become drafts become dated posts. Drag them between days, or between stages.'
            },
            {
              title: 'The hook, on its own',
              body: 'The first line decides whether the rest gets read, so it gets a field of its own rather than being typed past.'
            },
            {
              title: 'Written down, not posted for you',
              body: 'Copy to clipboard is the whole publishing step. Your posts live in your workspace, not in an account you rent.'
            }
          ]}
        />
      </Page>
    )
  }

  return (
    <Page
      title="Marketing"
      description="Where the next job is coming from."
      className="flex min-h-0 flex-col overflow-y-hidden"
    >
      <div className="mb-4 flex shrink-0 items-center gap-1 border-b border-line">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setTab(entry.value)}
            className="relative px-3 py-2 text-[13px]"
          >
            <span className={tab === entry.value ? 'text-ink' : 'text-muted hover:text-ink'}>
              {entry.label}
            </span>
            {tab === entry.value && (
              // Its own layoutId. Sharing one with Settings' tabs would make
              // the underline fly across the app when you navigate.
              <motion.span
                layoutId="marketing-tab"
                transition={transition.layout}
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-accent"
              />
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={transition.page}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {tab === 'content' && <ContentTab />}
          {tab === 'campaigns' && <CampaignsTab />}
          {tab === 'plan' && <PlanTab />}
        </motion.div>
      </AnimatePresence>
    </Page>
  )
}

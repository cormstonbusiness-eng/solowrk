import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Megaphone, Plus } from 'lucide-react'
import type { CampaignStatus, CampaignWithCounts } from '@shared/types'
import { CAMPAIGN_STATUSES } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { formatMoney } from '@/lib/format'
import { keys, useInvalidate } from '@/lib/api'
import { listItemVariants, listVariants } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { CampaignRecord } from './CampaignRecord'

/**
 * Campaigns: the list, and the one you are looking at.
 *
 * A campaign is not a label on some posts. Three separate things hang off one
 * — the content written for it, the tasks that have to happen first, and a
 * folder for the files they produce — and the list rows say so, because
 * "4 posts, 2 of 5 tasks" is the honest state of a campaign in a way that a
 * status word on its own never is.
 *
 * Opening one replaces the list rather than sliding a drawer over it. There is
 * too much on a campaign record for 520px, and the list is not something you
 * need to see while reading the brief.
 */

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  complete: 'Complete',
  abandoned: 'Abandoned'
}

const STATUS_TONE: Record<CampaignStatus, string> = {
  planning: 'text-faint',
  active: 'text-success',
  complete: 'text-muted',
  abandoned: 'text-disabled'
}

export function CampaignsTab(): React.JSX.Element {
  const invalidate = useInvalidate()
  const [openId, setOpenId] = useState<number | null>(null)

  const { data: campaigns = [] } = useQuery({
    queryKey: keys.campaignRecords(),
    queryFn: () => window.solo.invoke('campaigns:list')
  })

  const create = useMutation({
    mutationFn: () => window.solo.invoke('campaigns:create', { name: 'New campaign' }),
    onSuccess: (campaign) => {
      invalidate(['marketing'])
      // Straight into the record: a new campaign is a name and nothing else,
      // and the whole point of making one is to say what it is for.
      setOpenId(campaign.id)
    }
  })

  if (openId !== null) {
    return <CampaignRecord id={openId} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center">
        <p className="text-[12px] text-faint">
          A push with a goal, an end date, and the work that goes into it.
        </p>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          onClick={() => create.mutate()}
        >
          <Plus size={14} strokeWidth={1.75} />
          New campaign
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Empty
          icon={Megaphone}
          title="No campaigns yet"
          body="A campaign gathers the posts, the jobs and the files for one push, so you can see what is left before the date arrives."
          action={
            <Button variant="primary" onClick={() => create.mutate()}>
              <Plus size={14} strokeWidth={1.75} />
              Start one
            </Button>
          }
        />
      ) : (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="flex max-w-[820px] flex-col gap-1 overflow-y-auto"
        >
          {campaigns.map((campaign) => (
            <Row key={campaign.id} campaign={campaign} onOpen={() => setOpenId(campaign.id)} />
          ))}
        </motion.div>
      )}
    </div>
  )
}

function Row({
  campaign,
  onOpen
}: {
  campaign: CampaignWithCounts
  onOpen: () => void
}): React.JSX.Element {
  const dates = [campaign.startsOn, campaign.endsOn].filter(Boolean)

  return (
    <motion.button
      variants={listItemVariants}
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 rounded-control border border-transparent bg-raised px-3 py-2.5 text-left transition-colors hover:border-line-strong"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] text-ink">{campaign.name}</span>
        <span className="truncate text-[11px] text-faint">
          {campaign.objective.trim() === '' ? 'No objective written yet' : campaign.objective}
        </span>
      </div>

      {/*
        Both counts, because a campaign with all its posts written and none of
        its tasks done is in a completely different state from the reverse, and
        one number cannot say which.
      */}
      <span className="numeric shrink-0 text-[11px] text-muted">
        {campaign.publishedCount}/{campaign.contentCount} posts
      </span>
      <span className="numeric shrink-0 text-[11px] text-muted">
        {campaign.taskDoneCount}/{campaign.taskCount} tasks
      </span>

      {campaign.budget > 0 && (
        <span className="numeric shrink-0 text-[11px] text-faint">
          {formatMoney(campaign.budget)}
        </span>
      )}

      {dates.length > 0 && (
        <span className="numeric shrink-0 text-[11px] text-faint">{dates.join(' – ')}</span>
      )}

      <span className={cn('w-[62px] shrink-0 text-right text-[11px]', STATUS_TONE[campaign.status])}>
        {STATUS_LABELS[campaign.status]}
      </span>
    </motion.button>
  )
}

export { CAMPAIGN_STATUSES }

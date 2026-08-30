import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Megaphone, X } from 'lucide-react'
import type { ProjectSummary } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { toast } from '@/lib/celebrate'
import { transition } from '@/lib/motion'

/**
 * "Turn this into marketing?" — asked once, when a job is finished (§9.2).
 *
 * §9.2 calls this the strongest tie between Marketing and the rest of the
 * app, and the reason to have marketing inside SoloWrk rather than in a
 * separate tool. Nothing else knows that a job just finished, how long it
 * really took, or what was delivered — and nobody writes a case study three
 * months later, because by then they would have to look all of it up again.
 *
 * **One line, and it goes away.** Not a modal: marking a project complete is
 * a bookkeeping act, and a dialog demanding a marketing decision in the
 * middle of it is an interruption. This slides in at the bottom, waits, and
 * dismisses itself if ignored.
 *
 * It stays quiet when the job has already been written up, because a helpful
 * prompt asked twice is an irritating one.
 */
export function HarvestOffer({
  project,
  onClose
}: {
  project: ProjectSummary | null
  onClose: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const entitled = useFeature('harvest')

  const { data: written } = useQuery({
    queryKey: ['projects', 'writtenUp', project?.id],
    queryFn: () => window.solo.invoke('projects:writtenUp', { projectId: project!.id }),
    enabled: project !== null && entitled
  })

  const harvest = useMutation({
    mutationFn: () => window.solo.invoke('projects:harvest', { projectId: project!.id }),
    onSuccess: (result) => {
      invalidate(['marketing'])
      onClose()
      toast('Written up', {
        body: `A case study and ${result.ideas.length} ideas are waiting in Marketing.`
      })
      navigate('/marketing')
    }
  })

  const show = project !== null && entitled && written === false

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={transition.press}
          className="fixed bottom-5 left-1/2 z-40 flex w-[520px] max-w-[calc(100vw-3rem)] -translate-x-1/2 items-center gap-3 rounded-card border border-line-strong bg-overlay px-4 py-3 shadow-modal"
        >
          <Megaphone size={16} strokeWidth={1.75} className="shrink-0 text-accent" />

          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink">
            Turn this into marketing?
            <span className="block text-[11.5px] text-faint">
              A case study with the real dates, hours and deliverables, plus three ideas. Now is
              the only time you will remember the details.
            </span>
          </p>

          <Button
            variant="primary"
            size="sm"
            disabled={harvest.isPending}
            onClick={() => harvest.mutate()}
          >
            {harvest.isPending ? 'Writing…' : 'Yes'}
          </Button>

          <button
            type="button"
            aria-label="Not now"
            onClick={onClose}
            className="shrink-0 text-faint transition-colors hover:text-ink"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

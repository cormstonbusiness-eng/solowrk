import { motion } from 'motion/react'
import { ShieldQuestion } from 'lucide-react'
import type { PermissionRequest } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { transition } from '@/lib/motion'

/**
 * The confirmation gate, as the user sees it.
 *
 * It shows the exact input the tool will receive, not a summary of it: the
 * whole value of confirming is that you can see what is actually about to
 * happen, and a paraphrase written by the thing asking for permission is not
 * that.
 */
export function PermissionCard({
  request,
  onAllow,
  onDeny
}: {
  request: PermissionRequest
  onAllow: (always: boolean) => void
  onDeny: () => void
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={transition.modal}
      className="rounded-card border border-accent/40 bg-accent/6 p-3"
    >
      <div className="mb-2 flex items-start gap-2">
        <ShieldQuestion size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{request.title}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Nothing has changed yet. This runs only if you allow it.
          </p>
        </div>
      </div>

      <pre className="mb-2.5 max-h-[200px] overflow-auto rounded-control bg-ground/60 px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
        {JSON.stringify(request.input, null, 2)}
      </pre>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => onAllow(false)}>
          Allow
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDeny()}>
          Decline
        </Button>
        <button
          type="button"
          onClick={() => onAllow(true)}
          className="ml-auto text-[11px] text-faint transition-colors hover:text-ink"
        >
          Always allow {request.toolName.replace(/_/g, ' ')}
        </button>
      </div>
    </motion.div>
  )
}
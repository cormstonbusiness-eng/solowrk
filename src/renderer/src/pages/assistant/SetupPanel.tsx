import { Sparkles } from 'lucide-react'
import type { AssistantStatus } from '@shared/types'
import { Card } from '@/components/ui/Card'

/**
 * Shown when the assistant cannot run.
 *
 * There is no public OAuth flow that lets a third-party app authorise someone's
 * Claude subscription, so SoloWrk runs the Claude Code installation already on
 * the machine and inherits its login. That means the setup step is real and
 * belongs on screen — a chat box that silently does nothing would be worse than
 * saying plainly what is missing.
 */
export function SetupPanel({ status }: { status: AssistantStatus }): React.JSX.Element {
  return (
    <div className="mx-auto max-w-[560px] pt-6">
      <Card className="p-5">
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-panel border border-line bg-surface">
          <Sparkles size={17} strokeWidth={1.5} className="text-accent" />
        </div>

        <h2 className="text-[15px] font-semibold text-ink">
          {status.reason ?? 'The assistant needs setting up'}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          {status.detail ??
            'SoloWrk uses the Claude Code installation on this PC, so the assistant runs on your ' +
              'own Claude subscription. Nothing is sent anywhere else, and no API key is stored.'}
        </p>

        <ol className="mt-4 flex flex-col gap-2.5">
          {[
            {
              title: 'Install Claude Code',
              body: 'npm install -g @anthropic-ai/claude-code'
            },
            {
              title: 'Sign in once',
              body: 'Run claude in a terminal and follow the prompt to log in.'
            },
            {
              title: 'Restart SoloWrk',
              body: 'The assistant picks up that login automatically.'
            }
          ].map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="numeric mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line text-[11px] text-muted">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] text-ink">{step.title}</p>
                <p className="numeric mt-0.5 text-[11.5px] break-all text-faint">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}
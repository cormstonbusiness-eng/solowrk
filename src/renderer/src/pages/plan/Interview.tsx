import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-react'
import type { BusinessPlanStatus } from '@shared/types'
import {
  INTERVIEW_SECTIONS,
  QUESTIONS,
  composeSection,
  progress,
  questionsFor,
  type Answers,
  type Question
} from '@shared/planInterview'
import { Button } from '@/components/ui/Button'
import { Markdown } from '@/components/ui/Markdown'
import { transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The plan, one honest question at a time.
 *
 * The alternative — a blank template with twelve headings — is what people
 * already have and already ignore. What stops somebody is not the typing, it
 * is not knowing what belongs under "Positioning", so this never shows a
 * heading without a question under it.
 *
 * Nothing here calls a model. The questions are written so the answers are
 * already prose, which means the plan says exactly what the user said, works
 * with no network, and cannot invent a fact about their business.
 *
 * Every question can be skipped and the whole thing can be finished at any
 * point. A plan with eight good sections beats one with twelve where four say
 * "N/A", and somebody who has to answer everything answers nothing.
 */

/**
 * Where a half-finished interview lives.
 *
 * A draft, not a record — the plan itself is the record, and this is cleared
 * the moment one is written. It exists because twenty answers lost to a
 * misclick is the last time anybody tries this feature.
 */
const DRAFT_KEY = 'solowrk.planInterview.draft'

function loadDraft(): Answers {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Answers) : {}
  } catch {
    // A corrupt draft is not worth a broken page. Start again.
    return {}
  }
}

export function Interview({
  onDone,
  onCancel
}: {
  onDone: (status: BusinessPlanStatus) => void
  onCancel: () => void
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Answers>(loadDraft)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  /** The few answers the app can take from the workspace rather than ask for. */
  const { data: prefill } = useQuery({
    queryKey: ['ai', 'planPrefill'],
    queryFn: () => window.solo.invoke('ai:planPrefill')
  })

  // Filled in only where the user has not written something themselves, so a
  // prefill can never overwrite an answer somebody has already given.
  useEffect(() => {
    if (!prefill) return
    setAnswers((current) => {
      const next = { ...current }
      let changed = false
      for (const question of QUESTIONS) {
        const suggested = question.prefill ? prefill[question.prefill] : undefined
        if (suggested && (next[question.id] ?? '') === '') {
          next[question.id] = suggested
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [prefill])

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(answers))
    } catch {
      // Out of quota, or storage disabled. The interview still works; only
      // recovery after a misclick is lost, and saying so would be noise.
    }
  }, [answers])

  const build = useMutation({
    mutationFn: () => window.solo.invoke('ai:buildBusinessPlan', { answers }),
    onSuccess: (status) => {
      try {
        window.localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* The plan is written; a stale draft is harmless. */
      }
      onDone(status)
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'The plan could not be written')
  })

  const total = INTERVIEW_SECTIONS.length
  const reviewing = step >= total
  const spec = INTERVIEW_SECTIONS[Math.min(step, total - 1)]!
  const done = progress(answers)

  const written = useMemo(
    () =>
      INTERVIEW_SECTIONS.map((entry) => ({
        title: entry.title,
        body: composeSection(entry.key, answers)
      })).filter((entry) => entry.body !== ''),
    [answers]
  )

  const set = (id: string, value: string): void =>
    setAnswers((current) => ({ ...current, [id]: value }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-ink">
              {reviewing ? 'Your plan' : spec.title}
            </span>
            <span className="numeric text-[11px] text-faint">
              {reviewing ? `${written.length} sections` : `${step + 1} of ${total}`}
            </span>
            <span className="numeric ml-auto text-[11px] text-faint">
              {done.answered}/{done.total} answered
            </span>
          </div>

          {/* Progress against the sections, not the questions. Questions are
              skippable, so a bar that tracked them would sit at 60% for
              somebody who had deliberately finished. */}
          <div className="h-[3px] overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full bg-accent"
              initial={false}
              animate={{ width: `${(Math.min(step, total) / total) * 100}%` }}
              transition={transition.layout}
            />
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X size={14} strokeWidth={1.75} />
          Close
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-control border border-danger/40 bg-danger/8 px-3 py-2.5 text-[12px] text-ink">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={reviewing ? 'review' : spec.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={transition.page}
            className="max-w-[720px]"
          >
            {reviewing ? (
              <Review sections={written} />
            ) : (
              <div className="flex flex-col gap-5">
                <p className="text-[12px] leading-relaxed text-faint">{spec.hint}</p>

                {questionsFor(spec.key).map((question) => (
                  <Ask
                    key={question.id}
                    question={question}
                    value={answers[question.id] ?? ''}
                    prefilled={
                      question.prefill !== undefined &&
                      prefill?.[question.prefill] !== undefined &&
                      prefill[question.prefill] === (answers[question.id] ?? '')
                    }
                    onChange={(value) => set(question.id, value)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-4 flex shrink-0 items-center gap-2 border-t border-line pt-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </Button>

        {reviewing ? (
          <Button
            variant="primary"
            className="ml-auto"
            disabled={written.length === 0 || build.isPending}
            onClick={() => build.mutate()}
          >
            <Check size={14} strokeWidth={2} />
            {build.isPending ? 'Writing…' : 'Write my plan'}
          </Button>
        ) : (
          <>
            {/* Skipping is a first-class action, not a get-out. Somebody who
                has nothing to say about competitors should move on rather
                than invent an answer that ends up in their plan. */}
            <Button variant="ghost" size="sm" onClick={() => setStep((c) => c + 1)}>
              Skip this
            </Button>

            <Button variant="primary" size="sm" className="ml-auto" onClick={() => setStep((c) => c + 1)}>
              Next
              <ArrowRight size={14} strokeWidth={1.75} />
            </Button>

            {/* Available from the first screen. Finishing early is allowed,
                and hiding it until the end would make this feel like a form
                you have to complete. */}
            <Button variant="outline" size="sm" onClick={() => setStep(total)}>
              Finish now
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function Ask({
  question,
  value,
  prefilled,
  onChange
}: {
  question: Question
  value: string
  prefilled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const shared = cn(
    'w-full rounded-control border border-line bg-raised px-3 py-2',
    'text-[13px] leading-relaxed text-ink placeholder:text-faint',
    'transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none'
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-[13px] text-ink">{question.prompt}</label>
        {/* Where a filled-in answer came from. A number that appeared in
            somebody's business plan without explanation is worse than an
            empty box. */}
        {prefilled && (
          <span className="flex items-center gap-1 text-[10.5px] text-faint">
            <Sparkles size={10} strokeWidth={2} />
            from your settings
          </span>
        )}
      </div>

      {question.hint && (
        <p className="text-[11.5px] leading-relaxed text-faint">{question.hint}</p>
      )}

      {question.kind === 'short' ? (
        <input
          value={value}
          placeholder={question.placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(shared, 'h-9 py-0')}
        />
      ) : (
        <textarea
          rows={question.kind === 'list' ? 4 : 3}
          value={value}
          placeholder={question.placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(shared, 'resize-y')}
        />
      )}
    </div>
  )
}

/** What the document will say, before it is written. */
function Review({ sections }: { sections: { title: string; body: string }[] }): React.JSX.Element {
  if (sections.length === 0) {
    return (
      <p className="text-[12.5px] leading-relaxed text-faint">
        Nothing answered yet, so there is no plan to write. Go back and answer even one question —
        a plan with one honest section is worth more than an outline of empty headings.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-relaxed text-faint">
        This is what will be written, in your words. You can edit any of it afterwards, and the
        file is plain markdown in your workspace.
      </p>

      {sections.map((section) => (
        <div key={section.title} className="rounded-card border border-line bg-surface p-4">
          <h3 className="mb-2 text-[12.5px] font-medium text-ink">{section.title}</h3>
          <Markdown text={section.body} />
        </div>
      ))}
    </div>
  )
}

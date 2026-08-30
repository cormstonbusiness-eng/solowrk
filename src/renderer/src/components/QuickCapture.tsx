import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Lightbulb } from 'lucide-react'
import { useInvalidate } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { toast } from '@/lib/celebrate'
import { transition } from '@/lib/motion'

/**
 * An idea, caught where it actually arrives (§9.4).
 *
 * The best content ideas turn up mid-work — halfway through a drawing,
 * reading an email, on a call — and never during a content planning session.
 * By the time somebody has navigated to Marketing, found the right tab and
 * decided which channel it belongs to, the thought has gone.
 *
 * So: Ctrl+Shift+I from anywhere, one line, enter, gone. No channel, no date,
 * no fields. It lands in the idea column and can be made into something on a
 * day when that is the job.
 *
 * **It closes on escape and on blur**, because an idea box that has to be
 * dealt with is an interruption rather than a capture. Anything typed and
 * abandoned is dropped: a half-idea nobody finished is not worth putting in
 * a list somebody has to tidy later.
 */
export function QuickCapture(): React.JSX.Element {
  const { pathname } = useLocation()
  const invalidate = useInvalidate()
  const entitled = useFeature('marketing')

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)

  const save = useMutation({
    mutationFn: (title: string) =>
      window.solo.invoke('content:create', {
        title,
        status: 'idea',
        /*
          Where you were when it occurred to you, kept as a note.
          §9.4 asks for the current context, and the route is the honest
          version of it — the app knows which page you were on, and guessing
          at a project from that would be inventing a link you never made.
        */
        notes: `Captured from ${pathname}`
      }),
    onSuccess: () => {
      invalidate(['marketing'])
      toast('Idea saved', { body: 'It is in Marketing, in the idea column.' })
    }
  })

  useEffect(() => {
    if (!entitled) return

    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setOpen(true)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entitled])

  useEffect(() => {
    if (open) field.current?.focus()
    else setText('')
  }, [open])

  if (!entitled) return <></>

  const commit = (): void => {
    const idea = text.trim()
    setOpen(false)
    if (idea !== '') save.mutate(idea)
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[18vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(6,6,8,0.4)]"
          />

          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={transition.press}
            className="relative w-[520px] max-w-full rounded-card border border-line-strong bg-overlay shadow-modal"
          >
            <div className="flex items-center gap-2.5 px-3.5 py-3">
              <Lightbulb size={15} strokeWidth={1.75} className="shrink-0 text-accent" />
              <input
                ref={field}
                value={text}
                placeholder="What is the idea?"
                onChange={(event) => setText(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') {
                    // Abandoned on purpose. A half-idea nobody finished is
                    // not worth putting in a list somebody has to tidy.
                    setText('')
                    setOpen(false)
                  }
                  if (event.key === 'Enter') commit()
                }}
                className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
              />
            </div>

            <p className="border-t border-line px-3.5 py-2 text-[11px] text-faint">
              Enter to keep it, Escape to forget it. No channel and no date — it goes in the idea
              column.
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

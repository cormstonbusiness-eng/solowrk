import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { transition } from '@/lib/motion'
import { CARD_WIDTH, placeCard, type Rect } from './placement'
import { tourSteps } from './steps'

/** Breathing room between the highlighted element and the spotlight edge. */
const PADDING = 8

function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

export function Tour({ onFinish }: { onFinish: () => void }): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardHeight, setCardHeight] = useState(180)
  const cardRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const step = tourSteps[index]
  const isLast = index === tourSteps.length - 1

  // Steps can specify a route; get there before measuring anything.
  useEffect(() => {
    if (step?.route && location.pathname !== step.route) navigate(step.route)
  }, [step, location.pathname, navigate])

  /**
   * Track the target every frame rather than measuring once. The app animates
   * page transitions and the sidebar pill, and the window can be resized or
   * maximised mid-tour — a single measurement would leave the spotlight behind.
   * State only updates when the rect actually changes, so this stays cheap.
   */
  useEffect(() => {
    let frame = 0

    const track = (): void => {
      const selector = step?.target ? `[data-tour="${step.target}"]` : null
      const element = selector ? document.querySelector(selector) : null

      const next: Rect | null = element
        ? (() => {
            const box = element.getBoundingClientRect()
            return {
              top: box.top - PADDING,
              left: box.left - PADDING,
              width: box.width + PADDING * 2,
              height: box.height + PADDING * 2
            }
          })()
        : null

      setRect((current) => (rectsEqual(current, next) ? current : next))
      frame = requestAnimationFrame(track)
    }

    frame = requestAnimationFrame(track)
    return () => cancelAnimationFrame(frame)
  }, [step])

  useEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [index])

  const next = useCallback(() => {
    if (isLast) onFinish()
    else setIndex((current) => current + 1)
  }, [isLast, onFinish])

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onFinish()
      if (event.key === 'ArrowRight' || event.key === 'Enter') next()
      if (event.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, onFinish])

  if (!step) return <></>

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const position = placeCard(rect, step.placement, viewport, cardHeight)

  return (
    <div className="fixed inset-0 z-50">
      {/* Swallows every click: the tour is driven by its own buttons, so the
          app underneath stays inert until the user finishes or skips. */}
      <div className="absolute inset-0" />

      <AnimatePresence>
        {rect ? (
          <motion.div
            key="spotlight"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            }}
            exit={{ opacity: 0 }}
            transition={transition.layout}
            className="pointer-events-none absolute rounded-card"
            style={{
              // The cutout is the shadow's inverse: everything outside this box
              // is dimmed, and the box itself stays clear.
              boxShadow: '0 0 0 9999px rgba(6, 6, 8, 0.72)',
              outline: '1px solid var(--color-accent)',
              outlineOffset: '-1px'
            }}
          />
        ) : (
          <motion.div
            key="dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0"
            style={{ background: 'rgba(6, 6, 8, 0.72)' }}
          />
        )}
      </AnimatePresence>

      <motion.div
        ref={cardRef}
        initial={false}
        animate={{ top: position.top, left: position.left }}
        transition={transition.layout}
        style={{ width: CARD_WIDTH }}
        className="absolute rounded-panel border border-line-strong bg-surface p-4 shadow-2xl"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={transition.press}
          >
            <p className="mb-1.5 text-[10px] font-medium tracking-[0.1em] text-faint uppercase">
              {index + 1} of {tourSteps.length}
            </p>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{step.title}</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{step.body}</p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onFinish}
            className="text-[12px] text-faint transition-colors duration-150 hover:text-muted"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={back}>
                <ArrowLeft size={13} strokeWidth={1.75} />
                Back
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={next}>
              {isLast ? 'Finish' : 'Next'}
              {isLast ? (
                <Check size={13} strokeWidth={2} />
              ) : (
                <ArrowRight size={13} strokeWidth={1.75} />
              )}
            </Button>
          </div>
        </div>

        {/* Progress rail, so the length of the tour is never a mystery. */}
        <div className="mt-3.5 flex gap-1">
          {tourSteps.map((s, i) => (
            <div key={s.id} className="h-[2px] flex-1 overflow-hidden rounded-full bg-line">
              <motion.div
                initial={false}
                animate={{ scaleX: i <= index ? 1 : 0 }}
                transition={transition.page}
                className="h-full origin-left bg-accent"
              />
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
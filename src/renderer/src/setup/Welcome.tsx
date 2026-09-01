import { motion } from 'motion/react'
import { Button } from '@/components/ui/Button'
import { Wordmark } from '@/components/Wordmark'
import { DURATION, EASE } from '@/lib/motion'

/**
 * The first screen, seen once.
 *
 * Everything else in SoloWrk is dense on purpose — a freelancer's day is
 * invoices and hours, and screens that make them scroll for those are screens
 * that waste their time. This one is the exception, and the exception is the
 * point: it is the only moment in the app where nothing is being asked of
 * anybody, so it should feel like room rather than like a form.
 *
 * So: the mark, the name, one sentence, one button, and nothing else. No step
 * indicator, because a progress bar on the first frame promises paperwork. No
 * feature list, because nobody reads one before they have seen the thing. The
 * sentence is the product's actual claim rather than a welcome — "welcome to
 * X" is the least informative sentence software has ever put in 26px type.
 *
 * The button sits low rather than under the text. That gap is doing real work:
 * it is what separates a title card from a dialog.
 */

/** Entrance order, in seconds. Nothing here exceeds the house 250ms ceiling. */
const enter = (delay: number): { duration: number; ease: typeof EASE; delay: number } => ({
  duration: DURATION.page,
  ease: EASE,
  delay
})

export function Welcome({ onContinue }: { onContinue: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center px-6 pb-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {/*
          The wordmark is the title, so it is the h1 and its alt text is the
          heading a screen reader announces.

          "for Windows" is not set anywhere near it. The line at the foot of
          the screen already says which Windows, and a logo with a platform
          bolted onto it is a logo being used as a sentence.
        */}
        <motion.h1
          initial={{ opacity: 0, scale: 0.97, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={enter(0)}
          className="relative"
        >
          {/*
            Accent at 6%, and softer than it sounds written down.

            It matters more now than it did behind the icon: a wordmark alone
            on flat near-black reads as a PNG pasted onto a rectangle, and the
            glow is what gives the screen a light source instead. Wider than
            it is tall, because the thing it is lighting is a long word. Never
            a visible coloured shape.
          */}
          <div
            aria-hidden
            className="absolute -inset-x-24 -inset-y-20 rounded-full"
            style={{
              background:
                'radial-gradient(circle closest-side, var(--color-accent-glow) 0%, transparent 100%)'
            }}
          />
          <Wordmark height={52} className="relative" />
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={enter(0.06)}
          className="mt-5 text-[15px] text-muted"
        >
          Your business, in a folder you own
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter(0.12)}
        className="w-full max-w-[380px]"
      >
        {/* The one pill in the application. Everything else uses the 8px
            control radius; this is a title card rather than a toolbar, and the
            single full-width button is the whole interface. */}
        <Button
          autoFocus
          variant="primary"
          size="lg"
          onClick={onContinue}
          className="h-11 w-full rounded-full text-[14px]"
        >
          Get started
        </Button>

        <p className="mt-4 text-center text-[11.5px] text-faint">
          Windows 10 and 11 · by Blockout Digital
        </p>
      </motion.div>
    </div>
  )
}

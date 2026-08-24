import { Lock } from 'lucide-react'
import { Card } from '@/components/ui/Card'

/**
 * Shown in place of a section the licence does not cover.
 *
 * Modelled on the assistant's SetupPanel rather than a modal or a banner: the
 * page is not broken, it is simply not included, and saying so calmly in the
 * space where the feature would be is more honest than a pop-up demanding
 * money. It lists what the section actually does, because "upgrade to unlock"
 * tells somebody nothing about whether they want it.
 *
 * There is no in-app purchase flow — Stripe checkout lives on the website — so
 * the button opens a browser rather than pretending to sell anything here.
 */
export function ProPanel({
  title,
  blurb,
  does
}: {
  title: string
  blurb: string
  does: { title: string; body: string }[]
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-[560px] pt-6">
      <Card className="p-5">
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-panel border border-line bg-surface">
          <Lock size={16} strokeWidth={1.75} className="text-accent" />
        </div>

        <p className="text-[11px] tracking-[0.14em] text-faint uppercase">SoloWrk Pro</p>
        <h2 className="mt-1.5 text-[15px] font-semibold text-ink">{title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{blurb}</p>

        <ul className="mt-4 flex flex-col gap-2.5">
          {does.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
              <div className="min-w-0">
                <p className="text-[12.5px] text-ink">{item.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {/*
          A plain link rather than an IPC call. The window's
          `setWindowOpenHandler` already sends anything with target=_blank to
          the default browser and denies opening it in the app shell, so this
          needs no new channel and cannot navigate the app away from itself.
        */}
        <a
          href={UPGRADE_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-block rounded-control bg-accent px-4 py-2 text-[12.5px] text-accent-ink transition-colors hover:bg-accent-hover"
        >
          See what Pro includes
        </a>

        <p className="mt-3 text-[11.5px] text-faint">
          Your work is unaffected either way — everything you have made is in your workspace
          folder, whichever plan you are on.
        </p>
      </Card>
    </div>
  )
}

const UPGRADE_URL = 'https://solo-wrk.com/pricing'

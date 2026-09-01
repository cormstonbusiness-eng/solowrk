import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Loader2,
  TriangleAlert
} from 'lucide-react'
import type { FolderInspection, WorkspaceSetup, WorkspaceStatus } from '@shared/types'
import { DEFAULT_BUSINESS } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Mark } from '@/setup/Mark'
import { Field, MoneyInput, NumberInput, TextInput, Toggle } from '@/components/ui/Field'
import { EASE, transition } from '@/lib/motion'
import { cn } from '@/lib/utils'

type Step = 'welcome' | 'workspace' | 'business' | 'creating'

/**
 * The welcome step exists only for a workspace that has gone missing.
 *
 * A first install has already had its welcome — the splash in `Welcome.tsx`,
 * which says the same thing with more room and no progress bar under it. Two
 * welcomes in a row is how software admits it was built in pieces.
 */
const STEP_ORDER: Step[] = ['welcome', 'workspace', 'business']
const RESUME_ORDER: Step[] = ['workspace', 'business']

/** Windows-only app, so a literal separator is honest and avoids shipping path utils. */
function joinPath(base: string, child: string): string {
  return `${base.replace(/[\\/]+$/, '')}\\${child}`
}

/**
 * Steps slide horizontally in the direction of travel, so going back feels like
 * going back rather than like a new screen arriving.
 */
const stepVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 24 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.26, ease: EASE } },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -24,
    transition: { duration: 0.16, ease: EASE }
  })
}

export function FirstRun({
  status,
  onReady
}: {
  status: Extract<WorkspaceStatus, { state: 'unconfigured' | 'missing' }>
  onReady: (status: WorkspaceStatus) => void
}): React.JSX.Element {
  // A missing workspace needs explaining before anything is asked of anyone.
  // A fresh install does not: the splash has just done it.
  const explains = status.state === 'missing'
  const stepOrder = explains ? STEP_ORDER : RESUME_ORDER
  const [step, setStep] = useState<Step>(explains ? 'welcome' : 'workspace')
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [direction, setDirection] = useState(1)
  const [path, setPath] = useState(status.suggestedPath)
  const [inspection, setInspection] = useState<FolderInspection | null>(null)
  const [business, setBusiness] = useState<WorkspaceSetup['business']>(DEFAULT_BUSINESS)
  const [error, setError] = useState<string | null>(null)

  const inspect = useCallback(async (candidate: string) => {
    const result = await window.solo.invoke('workspace:inspect', { path: candidate })
    setInspection(result)
    return result
  }, [])

  useEffect(() => {
    if (step === 'workspace') void inspect(path)
  }, [step, path, inspect])

  const goTo = (next: Step, dir: number): void => {
    setDirection(dir)
    setError(null)
    setStep(next)
  }

  const browse = async (): Promise<void> => {
    const chosen = await window.solo.invoke('workspace:browse', { startIn: path })
    if (!chosen) return

    const result = await inspect(chosen)
    // Dropping SoloWrk's folders into someone's busy Documents folder would be
    // rude, so a non-empty pick gets its own subfolder unless it is already a
    // workspace we can adopt.
    if (!result.hasExistingWorkspace && result.exists && !result.isEmpty) {
      const nested = joinPath(chosen, 'SoloWrk')
      setPath(nested)
      await inspect(nested)
    } else {
      setPath(chosen)
    }
  }

  const adoptExisting = async (): Promise<void> => {
    setError(null)
    try {
      onReady(await window.solo.invoke('workspace:adopt', { path }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that workspace')
    }
  }

  const create = async (): Promise<void> => {
    goTo('creating', 1)
    try {
      const result = await window.solo.invoke('workspace:create', { path, business })

      // The logo can only be filed once the workspace and its database exist,
      // so it is held until here rather than travelling with the setup payload.
      if (logoPath) {
        try {
          await window.solo.invoke('settings:setLogo', { sourcePath: logoPath })
        } catch {
          // A logo that will not copy must not sink the whole setup — they can
          // add it again from Settings in two clicks.
        }
      }

      // Let the success state land before the app swaps in behind it.
      await new Promise((resolve) => setTimeout(resolve, 700))
      onReady(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the workspace')
      goTo('business', -1)
    }
  }

  const stepIndex = stepOrder.indexOf(step)

  return (
    <div className="grid h-full place-items-center bg-ground px-6">
      <div className="w-full max-w-[520px]">
        {step !== 'creating' && (
          <div className="mb-7 flex items-center gap-1.5">
            {stepOrder.map((name, index) => (
              <div key={name} className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
                <motion.div
                  initial={false}
                  animate={{ scaleX: index <= stepIndex ? 1 : 0 }}
                  transition={transition.page}
                  className="h-full origin-left bg-accent"
                />
              </div>
            ))}
          </div>
        )}

        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === 'welcome' && status.state === 'missing' && (
              <WelcomeStep status={status} onContinue={() => goTo('workspace', 1)} />
            )}

            {step === 'workspace' && (
              <WorkspaceStep
                path={path}
                inspection={inspection}
                onBrowse={browse}
                onBack={explains ? () => goTo('welcome', -1) : undefined}
                onContinue={() => goTo('business', 1)}
                onAdopt={adoptExisting}
              />
            )}

            {step === 'business' && (
              <BusinessStep
                logoPath={logoPath}
                onLogo={setLogoPath}
                business={business}
                onChange={setBusiness}
                onBack={() => goTo('workspace', -1)}
                onCreate={create}
              />
            )}

            {step === 'creating' && <CreatingStep path={path} />}
          </motion.div>
        </AnimatePresence>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center gap-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger"
          >
            <TriangleAlert size={13} strokeWidth={1.75} />
            {error}
          </motion.p>
        )}
      </div>
    </div>
  )
}

/**
 * Only reached when a workspace that existed has gone missing — a moved
 * folder, an unplugged drive, a renamed parent.
 *
 * Nobody in this state needs telling what SoloWrk is. They need telling what
 * happened, where their files were last seen, and that nothing has been lost —
 * so the path is in the sentence rather than in a details panel below it, and
 * the reassurance is a plain statement rather than an apology.
 */
function WelcomeStep({
  status,
  onContinue
}: {
  status: Extract<WorkspaceStatus, { state: 'missing' }>
  onContinue: () => void
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-5 text-accent">
        <Mark size={34} />
      </div>

      <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Your workspace has moved
      </h1>

      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        SoloWrk expected to find it at <span className="text-ink">{status.path}</span>, but it is
        not there. Point SoloWrk at where it went, or start a new one.
      </p>

      <p className="mt-3 text-[13px] leading-relaxed text-faint">
        Nothing has been deleted. If the folder was moved or renamed, choosing it here picks up
        where you left off.
      </p>

      <div className="mt-7 flex justify-end">
        <Button variant="primary" size="lg" onClick={onContinue}>
          Find my workspace
          <ArrowRight size={15} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}

function WorkspaceStep({
  path,
  inspection,
  onBrowse,
  onBack,
  onContinue,
  onAdopt
}: {
  path: string
  inspection: FolderInspection | null
  onBrowse: () => void
  /** Absent on a first install, where this is the first step there is. */
  onBack?: () => void
  onContinue: () => void
  onAdopt: () => void
}): React.JSX.Element {
  const existing = inspection?.hasExistingWorkspace ?? false
  const blocked = inspection !== null && !inspection.writable

  return (
    <div>
      <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Where should SoloWrk keep your files?
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Everything SoloWrk stores goes here — including the database. Back this folder up, or point
        your own cloud drive at it, and your whole business travels with it.
      </p>

      <div className="mt-5 flex gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-control border border-line bg-raised px-3">
          <span className="truncate text-[13px] text-ink">{path}</span>
        </div>
        <Button variant="outline" size="md" onClick={onBrowse}>
          <FolderOpen size={14} strokeWidth={1.75} />
          Browse
        </Button>
      </div>

      <div className="mt-3 min-h-[52px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${existing}-${blocked}-${inspection?.exists}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={transition.press}
          >
            {blocked ? (
              <Notice tone="danger" icon={TriangleAlert}>
                SoloWrk cannot write to that folder. Choose another one.
              </Notice>
            ) : existing ? (
              <Notice tone="info" icon={Info}>
                A SoloWrk workspace already exists here. You can open it instead of creating a new one.
              </Notice>
            ) : inspection?.exists ? (
              <Notice tone="muted" icon={Info}>
                This folder exists and is empty. SoloWrk will create its folders inside it.
              </Notice>
            ) : (
              <Notice tone="muted" icon={Info}>
                This folder will be created, along with Clients, Documents, Invoices, Quotes,
                Expenses and Templates inside it.
              </Notice>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-6 flex items-center justify-between">
        {onBack ? (
          <Button variant="ghost" size="md" onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.75} />
            Back
          </Button>
        ) : (
          // Holds the primary action against the right edge whether or not
          // there is anywhere to go back to.
          <span />
        )}

        {existing ? (
          <Button variant="primary" size="lg" onClick={onAdopt}>
            Open this workspace
            <ArrowRight size={15} strokeWidth={1.75} />
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={onContinue} disabled={blocked}>
            Continue
            <ArrowRight size={15} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </div>
  )
}

function BusinessStep({
  business,
  onChange,
  logoPath,
  onLogo,
  onBack,
  onCreate
}: {
  business: WorkspaceSetup['business']
  onChange: (business: WorkspaceSetup['business']) => void
  logoPath: string | null
  onLogo: (path: string | null) => void
  onBack: () => void
  onCreate: () => void
}): React.JSX.Element {
  const set = <K extends keyof WorkspaceSetup['business']>(
    key: K,
    value: WorkspaceSetup['business'][K]
  ): void => onChange({ ...business, [key]: value })

  return (
    <div>
      <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Your business details
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        These appear on your invoices and quotes. Only the trading name is needed now — the rest can
        wait until you raise your first invoice.
      </p>

      <div className="mt-5 flex flex-col gap-3.5">
        {/* Optional, and first: a logo is the one thing that makes the app feel
            like yours rather than a demo, and it takes one click. */}
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface/40 p-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-control border border-line bg-raised">
            {logoPath ? (
              <Check size={16} strokeWidth={2} className="text-success" />
            ) : (
              <ImageIcon size={16} strokeWidth={1.5} className="text-faint" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-ink">Your logo</p>
            <p className="mt-0.5 truncate text-[11px] text-faint">
              {logoPath
                ? (logoPath.split(/[\\/]/).pop() ?? logoPath)
                : 'Optional. Appears on your dashboard.'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const [file] = await window.solo.invoke('files:pick', { multiple: false })
              if (file) onLogo(file)
            }}
          >
            {logoPath ? 'Change' : 'Choose'}
          </Button>
        </div>

        <Field label="Trading name">
          <TextInput
            autoFocus
            placeholder="Your business or your name"
            value={business.businessName}
            onChange={(e) => set('businessName', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact name">
            <TextInput
              value={business.contactName}
              onChange={(e) => set('contactName', e.target.value)}
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={business.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Default hourly rate" hint="Used for new projects and time tracking.">
            <MoneyInput
              pence={business.defaultHourlyRate}
              onChangePence={(pence) => set('defaultHourlyRate', pence)}
            />
          </Field>
          <Field label="Payment terms" hint="Days until an invoice falls due.">
            <NumberInput
              suffix="days"
              min={0}
              value={business.paymentTermsDays}
              onChangeValue={(value) => set('paymentTermsDays', value)}
            />
          </Field>
        </div>

        <div className="rounded-card border border-line bg-surface p-3.5">
          <Toggle
            checked={business.vatRegistered}
            onChange={(checked) => set('vatRegistered', checked)}
            label="VAT registered"
            hint="Adds a VAT line to invoices at 20%."
          />
          <AnimatePresence initial={false}>
            {business.vatRegistered && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={transition.page}
                className="overflow-hidden"
              >
                <div className="pt-3.5">
                  <Field label="VAT number">
                    <TextInput
                      placeholder="GB123456789"
                      value={business.vatNumber}
                      onChange={(e) => set('vatNumber', e.target.value)}
                    />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" size="md" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={onCreate}
          disabled={business.businessName.trim().length === 0}
        >
          Create workspace
          <ArrowRight size={15} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}

function CreatingStep({ path }: { path: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={transition.modal}
        className="grid h-12 w-12 place-items-center rounded-panel border border-line bg-surface"
      >
        <Loader2 size={20} strokeWidth={1.75} className="animate-spin text-accent" />
      </motion.div>
      <p className="mt-4 text-[14px] text-ink">Setting up your workspace</p>
      <p className="mt-1 max-w-sm truncate text-[12px] text-faint">{path}</p>
    </div>
  )
}

function Notice({
  tone,
  icon: Icon,
  children
}: {
  tone: 'muted' | 'info' | 'danger'
  icon: typeof Info
  children: React.ReactNode
}): React.JSX.Element {
  const tones = {
    muted: 'border-line bg-surface text-muted',
    info: 'border-accent/30 bg-accent/10 text-ink',
    danger: 'border-danger/30 bg-danger/10 text-danger'
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-control border px-3 py-2 text-[12px] leading-relaxed',
        tones[tone]
      )}
    >
      <Icon size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

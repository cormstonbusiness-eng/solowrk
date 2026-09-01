import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import type { AuthState, WorkspaceStatus } from '@shared/types'
import { TitleBar } from '@/components/TitleBar'
import { Sidebar } from '@/components/Sidebar'
import { FirstRun } from '@/setup/FirstRun'
import { Welcome } from '@/setup/Welcome'
import { SignIn } from '@/setup/SignIn'
import { WorkspaceContext } from '@/hooks/useWorkspace'
import { ThemeContext, useThemeState } from '@/hooks/useTheme'
import { TourProvider } from '@/tour/TourProvider'
import { Palette } from '@/palette/Palette'
import { Trash } from '@/pages/Trash'
import { DetailDrawer } from '@/components/detail/DetailDrawer'
import { UndoProvider } from '@/hooks/useUndo'
import { DrawerProvider } from '@/hooks/useDrawer'
import { WhatsNew } from '@/components/WhatsNew'
import { Toasts } from '@/components/Toasts'
import { SeasonalLayer } from '@/components/seasonal/SeasonalLayer'
import { transition } from '@/lib/motion'
import { raiseLimit } from '@/lib/limits'
import { LimitModal } from '@/components/LimitModal'
import { QuickCapture } from '@/components/QuickCapture'
import { TrialBar } from '@/components/TrialBar'
import {
  ArchivedProjects,
  ArchivedTasks,
  Assistant,
  BusinessPlan,
  Calendar,
  ClientDetail,
  Clients,
  Dashboard,
  Documents,
  Files,
  Finance,
  Goals,
  Invoices,
  Marketing,
  Notes,
  Guides,
  Notifications,
  ProjectDetail,
  Projects,
  Settings,
  Tasks,
  Time
} from '@/pages'

const queryClient = new QueryClient({
  defaultOptions: {
    // Local SQLite over IPC — refetching on window focus buys nothing here.
    queries: { refetchOnWindowFocus: false, staleTime: 30_000, retry: 1 },
    /**
     * Every creation in this app is a mutation, and every usage limit is
     * refused by the main process as a structured error. Catching it here
     * means one handler covers `clients:create`, `projects:create` and the
     * rest, rather than thirty pages each remembering to look for it.
     *
     * It does not swallow the rejection: a page with its own `onError` still
     * runs, and `raiseLimit` ignores anything that is not a limit, so an
     * ordinary failure is untouched.
     */
    mutations: {
      onError: (error) => {
        raiseLimit(error)
      }
    }
  }
})

/**
 * `mode="wait"` keyed on pathname: the outgoing page finishes its exit before
 * the incoming one animates in, so transitions never overlap into a smear.
 */
function AnimatedRoutes(): React.JSX.Element {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        {/* Before the :id route so "archived" is not read as a project id. */}
        <Route path="/projects/archived" element={<ArchivedProjects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/archived" element={<ArchivedTasks />} />
        <Route path="/time" element={<Time />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/business-plan" element={<BusinessPlan />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/guides" element={<Guides />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/files" element={<Files />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </AnimatePresence>
  )
}

function Shell(): React.JSX.Element {
  return (
    <HashRouter>
      {/* Inside the router: the drawer keeps which record it is showing in the
          URL, so a notification or the palette can open one, and the back
          button closes it. */}
      <DrawerProvider>
        {/* Wraps everything that can delete, which is everything. */}
        <UndoProvider>
          {/* Also inside: the tour navigates between routes as it goes. */}
          <TourProvider>
            <div className="flex min-h-0 flex-1">
              <Sidebar />
              {/* `relative` so the decoration can sit inside it, `overflow-hidden`
                  so nothing drifts out into the sidebar or the titlebar. */}
              <main className="page-light relative min-w-0 flex-1 overflow-hidden">
                <SeasonalLayer />
                <AnimatedRoutes />
              </main>
            </div>
            {/* Inside the router too: every command it runs is a navigation. */}
            <Palette />
            {/* Same reason — a toast is a shortcut to the page it is about. */}
            <Toasts />
            <WhatsNew />
            {/* Mounted once for the whole app: every list opens this one. */}
            <DetailDrawer />
            {/* Likewise — any creation anywhere can raise it. */}
            <LimitModal />
            {/* Ctrl+Shift+I from anywhere — see QuickCapture. */}
            <QuickCapture />
          </TourProvider>
        </UndoProvider>
      </DrawerProvider>
    </HashRouter>
  )
}

/**
 * Startup has three outcomes: a workspace opens and we show the app, no
 * workspace is configured (or the folder has gone) and we show the wizard, or
 * the main process failed and we say so rather than hanging on a blank screen.
 */
export function App(): React.JSX.Element {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * The account is resolved before the workspace, and deliberately so: a
   * licence is a fact about the app, a workspace is a document it opens, and
   * asking someone to pick a folder before finding out they cannot use the app
   * would be the wrong way round.
   */
  useEffect(() => {
    window.solo
      .invoke('auth:state')
      .then(setAuth)
      .catch(() =>
        // An unreadable config must not be a locked door. Nothing is locked
        // either way — the worst this costs is a restart.
        setAuth({
          signedIn: false,
          // Same reasoning as the tier below: an unreadable config must not
          // be read as holding a licence.
          licensed: false,
          account: null,
          configured: false,
          verifiedAt: null,
          offline: false,
          // Free rather than Pro. An unreadable config is the one case where
          // guessing generously would mean the app gives itself away, and
          // guessing meanly costs somebody a restart.
          tier: 'free',
          trial: { active: false, daysLeft: 0, showCountdown: false },
          paymentFailed: false,
          updatesEndedOn: '',
          foundingNumber: 0,
          error: ''
        })
      )
  }, [])

  /**
   * The background licence check only speaks up when the answer changed, so
   * every one of these is worth taking: a failed payment raises the banner, and
   * a successful one lowers it again without anyone having to restart or go
   * looking for a button in Settings.
   */
  useEffect(() => {
    return window.solo.on('auth:changed', setAuth)
  }, [])

  useEffect(() => {
    window.solo
      .invoke('workspace:status')
      .then(setStatus)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'SoloWrk could not start')
      )
  }, [])

  // Only stands in the way once an account server exists to check against.
  const needsSignIn = auth !== null && auth.configured && !auth.signedIn

  /**
   * The splash, and the single rule about when it appears.
   *
   * `unconfigured` means no workspace has ever been set up on this machine,
   * which is a first install and nothing else. A workspace that has gone
   * missing is not a first install, and somebody signing back in after signing
   * out is certainly not, so neither is welcomed.
   *
   * Dismissal is session state rather than a flag on disk, and can be: the
   * condition it is gated on stops being true the moment a workspace exists,
   * so there is nothing left to remember. Quitting from the splash and
   * relaunching shows it again, which is correct — nothing has happened yet.
   */
  const [welcomed, setWelcomed] = useState(false)
  const showsWelcome = status?.state === 'unconfigured' && !welcomed

  const workspace = useMemo(() => ({ status, setStatus }), [status])
  // Themes live in the workspace, so the stored choice can only be read once
  // one is open. Until then the default applies.
  const theme = useThemeState(status?.state === 'ready')

  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <WorkspaceContext.Provider value={workspace}>
          <ThemeContext.Provider value={theme}>
          <div className="flex h-full flex-col bg-ground">
            <TitleBar />
            {auth?.paymentFailed && <PaymentFailedBar />}
            <TrialBar />

            <AnimatePresence mode="wait">
              {error ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="grid flex-1 place-items-center px-6 text-center"
                >
                  <div>
                    <p className="text-[14px] text-ink">SoloWrk could not start</p>
                    <p className="mt-1 text-[12px] text-muted">{error}</p>
                  </div>
                </motion.div>
              ) : showsWelcome ? (
                <motion.div
                  key="welcome"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition.page}
                  className="min-h-0 flex-1"
                >
                  <Welcome onContinue={() => setWelcomed(true)} />
                </motion.div>
              ) : needsSignIn ? (
                <motion.div
                  key="signin"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition.page}
                  className="min-h-0 flex-1"
                >
                  <SignIn state={auth} onSignedIn={setAuth} />
                </motion.div>
              ) : !status || !auth ? (
                // Deliberately blank: startup is near-instant, and a spinner
                // that flashes for 80ms reads as jank rather than progress.
                <motion.div key="loading" className="flex-1" />
              ) : status.state === 'ready' ? (
                <motion.div
                  key="shell"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={transition.page}
                  className="flex min-h-0 flex-1"
                >
                  <Shell />
                </motion.div>
              ) : (
                <motion.div
                  key="setup"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition.page}
                  className="min-h-0 flex-1"
                >
                  <FirstRun status={status} onReady={setStatus} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </ThemeContext.Provider>
        </WorkspaceContext.Provider>
      </QueryClientProvider>
    </MotionConfig>
  )
}

/**
 * The strip that appears when a payment has failed.
 *
 * Its job is to be unmissable and not frightening, in that order. Someone
 * seeing this has had a card decline, not lost anything, and the sentence that
 * matters most to them is that nothing has changed yet — so that sentence is in
 * the bar rather than in a dialog they have to open.
 *
 * §3.4 holds the tier open through Stripe's retry window plus five days, so
 * this really is only a message: nothing is locked, nothing is hidden, and the
 * app behaves exactly as it did yesterday. It replaced a bar that announced the
 * app had gone read-only, which said the opposite of all of that.
 *
 * No dismiss button, because a persistent line is the whole mechanism. There is
 * a way to act on it, which is the part that stops it being a nag.
 */
function PaymentFailedBar(): React.JSX.Element {
  const [checking, setChecking] = useState(false)

  async function recheck(): Promise<void> {
    setChecking(true)
    try {
      // A full reload rather than threading state back up: this runs after a
      // renewal, once, and every query in the app is now stale.
      const next = await window.solo.invoke('auth:verify')
      if (!next.paymentFailed) window.location.reload()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-warning/25 bg-warning/10 px-4 py-2">
      <Lock size={13} strokeWidth={1.75} className="shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
        We couldn’t take your last payment.{' '}
        <span className="text-muted">
          Nothing has changed and nothing is locked — update your card and this disappears.
        </span>
      </p>
      <button
        type="button"
        onClick={() => void recheck()}
        disabled={checking}
        className="shrink-0 rounded-control px-2 py-1 text-[11.5px] font-medium text-warning underline-offset-2 hover:underline disabled:opacity-50"
      >
        {checking ? 'Checking…' : 'I’ve paid — check again'}
      </button>
    </div>
  )
}
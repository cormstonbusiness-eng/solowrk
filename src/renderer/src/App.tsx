import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WorkspaceStatus } from '@shared/types'
import { TitleBar } from '@/components/TitleBar'
import { Sidebar } from '@/components/Sidebar'
import { FirstRun } from '@/setup/FirstRun'
import { WorkspaceContext } from '@/hooks/useWorkspace'
import { ThemeContext, useThemeState } from '@/hooks/useTheme'
import { TourProvider } from '@/tour/TourProvider'
import { Palette } from '@/palette/Palette'
import { Toasts } from '@/components/Toasts'
import { SeasonalLayer } from '@/components/seasonal/SeasonalLayer'
import { transition } from '@/lib/motion'
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
    queries: { refetchOnWindowFocus: false, staleTime: 30_000, retry: 1 }
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
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/files" element={<Files />} />
        <Route path="/documents" element={<Documents />} />
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
      {/* Inside the router: the tour navigates between routes as it goes. */}
      <TourProvider>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {/* `relative` so the decoration can sit inside it, `overflow-hidden`
              so nothing drifts out into the sidebar or the titlebar. */}
          <main className="relative min-w-0 flex-1 overflow-hidden bg-ground">
            <SeasonalLayer />
            <AnimatedRoutes />
          </main>
        </div>
        {/* Inside the router too: every command it runs is a navigation. */}
        <Palette />
        {/* Same reason — a toast is a shortcut to the page it is about. */}
        <Toasts />
      </TourProvider>
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.solo
      .invoke('workspace:status')
      .then(setStatus)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'SoloWrk could not start')
      )
  }, [])

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
              ) : !status ? (
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
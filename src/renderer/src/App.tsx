import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TitleBar } from '@/components/TitleBar'
import { Sidebar } from '@/components/Sidebar'
import {
  Assistant,
  Calendar,
  Clients,
  Dashboard,
  Documents,
  Files,
  Finance,
  Invoices,
  Projects,
  Settings,
  Tasks
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
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/clients" element={<Clients />} />
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

export function App(): React.JSX.Element {
  return (
    // reducedMotion="user" is the single switch that honours the OS setting for
    // every Motion component in the app.
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <div className="flex h-full flex-col bg-ground">
            <TitleBar />
            <div className="flex min-h-0 flex-1">
              <Sidebar />
              <main className="min-w-0 flex-1 bg-ground">
                <AnimatedRoutes />
              </main>
            </div>
          </div>
        </HashRouter>
      </QueryClientProvider>
    </MotionConfig>
  )
}
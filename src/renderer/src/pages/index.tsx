import { Sparkles } from 'lucide-react'
import { Page } from '@/components/Page'
import { Placeholder } from '@/components/Placeholder'

export { Dashboard } from './Dashboard'
export { Settings } from './Settings'
export { Projects, ProjectDetail } from './Projects'
export { Tasks } from './Tasks'
export { Clients, ClientDetail } from './Clients'
export { Files } from './Files'
export { Documents } from './Documents'
export { Time } from './Time'
export { Invoices } from './Invoices'
export { Finance } from './Finance'
export { Calendar } from './Calendar'

export function Assistant(): React.JSX.Element {
  return (
    <Page title="Assistant" description="Claude, with real access to your workspace.">
      <Placeholder
        icon={Sparkles}
        phase="Phase 7"
        summary="Runs the Claude Agent SDK against your existing Claude subscription, with tools that can read your files and draft real work — every change confirmed by you first."
        features={['Your subscription', 'File access', 'App actions', 'Confirm before write']}
      />
    </Page>
  )
}

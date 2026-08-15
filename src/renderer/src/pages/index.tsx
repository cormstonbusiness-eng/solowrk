import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheckBig,
  FileText,
  FolderKanban,
  FolderOpen,
  ReceiptText,
  Sparkles,
  Users
} from 'lucide-react'
import { Page } from '@/components/Page'
import { Placeholder } from '@/components/Placeholder'

export { Dashboard } from './Dashboard'
export { Settings } from './Settings'

export function Projects(): React.JSX.Element {
  return (
    <Page title="Projects" description="Every job, its files, its budget and its state.">
      <Placeholder
        icon={FolderKanban}
        phase="Phase 2"
        summary="Projects belong to a client, own a folder on disk, and carry their own tasks, notes, time and budget."
        features={['Project list & detail', 'Folder scaffolding', 'Templates', 'Budget tracking']}
      />
    </Page>
  )
}

export function Tasks(): React.JSX.Element {
  return (
    <Page title="Tasks" description="Colour-coded, categorised, dated.">
      <Placeholder
        icon={CircleCheckBig}
        phase="Phase 2"
        summary="Board and list views over the same tasks, with categories you colour yourself, due dates, priorities and subtasks."
        features={['Board & list', 'Colour categories', 'Due dates', 'Subtasks', 'Drag to reorder']}
      />
    </Page>
  )
}

export function Calendar(): React.JSX.Element {
  return (
    <Page title="Calendar" description="Your schedule, your deadlines, your meetings.">
      <Placeholder
        icon={CalendarDays}
        phase="Phase 5, synced in phase 8"
        summary="A local calendar first — month, week and day views with task due dates alongside events. Google and Teams meetings sync in later."
        features={['Month / week / day', 'Drag to reschedule', 'Reminders', 'Google & Teams']}
      />
    </Page>
  )
}

export function Clients(): React.JSX.Element {
  return (
    <Page title="Clients" description="Who you work for, and everything attached to them.">
      <Placeholder
        icon={Users}
        phase="Phase 2"
        summary="Each client holds contacts, default rate, payment terms and VAT details, plus every project, invoice and document filed against them."
        features={['Contacts', 'Default rates', 'Lifetime value', 'Linked records']}
      />
    </Page>
  )
}

export function Invoices(): React.JSX.Element {
  return (
    <Page title="Invoices" description="Raise, send, chase and get paid.">
      <Placeholder
        icon={ReceiptText}
        phase="Phase 4"
        summary="Build invoices from unbilled time, apply VAT, export a PDF that matches the screen, and let retainers generate themselves."
        features={['Time → invoice', 'VAT', 'PDF export', 'Recurring', 'Overdue chasers']}
      />
    </Page>
  )
}

export function Finance(): React.JSX.Element {
  return (
    <Page title="Finance" description="What the business made and spent.">
      <Placeholder
        icon={ChartNoAxesCombined}
        phase="Phase 4"
        summary="Income against spending by day, month and UK tax year, with a set-aside figure so the tax bill is never a surprise."
        features={['Day / month / year', 'UK tax year', 'Tax set-aside', 'Top clients']}
      />
    </Page>
  )
}

export function Files(): React.JSX.Element {
  return (
    <Page title="Files" description="Your workspace on disk, browsable in here.">
      <Placeholder
        icon={FolderOpen}
        phase="Phase 3"
        summary="A browser over the real folder tree. Drag files in, open them in Explorer, and know exactly where everything lives — no cloud in the loop."
        features={['Drag & drop', 'Open in Explorer', 'Tagging', 'Search']}
      />
    </Page>
  )
}

export function Documents(): React.JSX.Element {
  return (
    <Page title="Documents" description="Contracts, insurance, certificates, tax.">
      <Placeholder
        icon={FileText}
        phase="Phase 3"
        summary="Business paperwork with categories and expiry dates, so a lapsing insurance policy raises a flag on the dashboard before it lapses."
        features={['Categories', 'Expiry reminders', 'Search', 'Quick preview']}
      />
    </Page>
  )
}

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

import { useMemo } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import {
  Building2,
  CalendarDays,
  CircleCheckBig,
  FileText,
  FolderKanban,
  Play,
  Plus,
  ReceiptText,
  Square,
  type LucideIcon
} from 'lucide-react'
import { dayFromDate } from '@shared/calendar'
import { invalidate, keys } from '@/lib/api'
import { allNavItems } from '@/lib/nav'
import { formatMoney } from '@/lib/format'

export interface Command {
  id: string
  label: string
  /** Shown on the right of the label — a client name, an amount, a date. */
  subtitle?: string
  group: string
  icon: LucideIcon
  /** A project or client colour, shown instead of the icon when present. */
  colour?: string
  /** Everything the fuzzy matcher searches: label plus context. */
  searchText: string
  run: () => void
}

/**
 * Everything the palette can find or do.
 *
 * Records and verbs live in one list rather than two modes, because the thing
 * you want is as often "that invoice" as it is "new invoice", and making the
 * user choose a mode first defeats the point of a single keystroke.
 */
export function useCommands({
  enabled,
  navigate,
  queryClient,
  close
}: {
  enabled: boolean
  navigate: NavigateFunction
  queryClient: QueryClient
  close: () => void
}): Command[] {
  const options = { enabled, staleTime: 10_000 }

  const { data: projects = [] } = useQuery({
    queryKey: keys.projects(),
    queryFn: () => window.solo.invoke('projects:list', {}),
    ...options
  })

  const { data: clients = [] } = useQuery({
    queryKey: keys.clients,
    queryFn: () => window.solo.invoke('clients:list', {}),
    ...options
  })

  const { data: tasks = [] } = useQuery({
    queryKey: keys.tasks(),
    queryFn: () => window.solo.invoke('tasks:list', {}),
    ...options
  })

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => window.solo.invoke('invoices:list', {}),
    ...options
  })

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: () => window.solo.invoke('documents:list', {}),
    ...options
  })

  const { data: running } = useQuery({
    queryKey: ['time', 'running'],
    queryFn: () => window.solo.invoke('time:running'),
    ...options
  })

  return useMemo(() => {
    const go = (path: string) => (): void => {
      navigate(path)
      close()
    }

    const commands: Command[] = []

    /* Verbs first: they are what a palette is for, and they are the shortest
       list, so they cannot bury the records below them. */
    commands.push(
      {
        id: 'new-project',
        label: 'New project',
        group: 'Action',
        icon: Plus,
        searchText: 'New project create add job',
        run: go('/projects?new=1')
      },
      {
        id: 'new-task',
        label: 'New task',
        group: 'Action',
        icon: Plus,
        searchText: 'New task create add to-do todo',
        run: go('/tasks?new=1')
      },
      {
        id: 'new-invoice',
        label: 'New invoice',
        group: 'Action',
        icon: Plus,
        searchText: 'New invoice create raise bill',
        run: go('/invoices?new=1')
      },
      {
        id: 'new-event',
        label: 'New event',
        group: 'Action',
        icon: Plus,
        searchText: 'New event create meeting appointment calendar',
        run: go('/calendar?new=1')
      },
      {
        id: 'new-client',
        label: 'New client',
        group: 'Action',
        icon: Plus,
        searchText: 'New client create add customer',
        run: go('/clients?new=1')
      }
    )

    if (running) {
      commands.push({
        id: 'stop-timer',
        label: `Stop timer — ${running.entry.projectName ?? 'no project'}`,
        group: 'Action',
        icon: Square,
        searchText: `Stop timer pause ${running.entry.projectName ?? ''}`,
        run: async () => {
          await window.solo.invoke('time:stop', { id: running.entry.id })
          invalidate(queryClient, ['time', 'projects', 'finance'])
          close()
        }
      })
    }

    // "Start timer on <project>" is the command this whole palette justifies:
    // two keystrokes and a project name, from anywhere in the app.
    for (const project of projects) {
      commands.push({
        id: `start-timer-${project.id}`,
        label: `Start timer on ${project.name}`,
        group: 'Action',
        icon: Play,
        colour: project.colour,
        searchText: `Start timer track ${project.name} ${project.clientName ?? ''}`,
        run: async () => {
          await window.solo.invoke('time:start', { projectId: project.id })
          invalidate(queryClient, ['time'])
          close()
        }
      })
    }

    commands.push({
      id: 'open-workspace',
      label: 'Open workspace folder',
      group: 'Action',
      icon: FolderKanban,
      searchText: 'Open workspace folder explorer files reveal',
      run: async () => {
        await window.solo.invoke('workspace:reveal')
        close()
      }
    })

    for (const project of projects) {
      commands.push({
        id: `project-${project.id}`,
        label: project.name,
        subtitle: project.clientName ?? undefined,
        group: 'Project',
        icon: FolderKanban,
        colour: project.colour,
        searchText: `${project.name} ${project.clientName ?? ''} project`,
        run: go(`/projects/${project.id}`)
      })
    }

    for (const client of clients) {
      commands.push({
        id: `client-${client.id}`,
        label: client.name,
        subtitle: client.contactName || undefined,
        group: 'Client',
        icon: Building2,
        colour: client.colour,
        searchText: `${client.name} ${client.contactName} ${client.email} client`,
        run: go(`/clients/${client.id}`)
      })
    }

    for (const task of tasks) {
      commands.push({
        id: `task-${task.id}`,
        label: task.title,
        subtitle: task.projectName ?? undefined,
        group: 'Task',
        icon: CircleCheckBig,
        colour: task.categoryColour ?? undefined,
        searchText: `${task.title} ${task.projectName ?? ''} ${task.categoryName ?? ''} task`,
        run: go('/tasks')
      })
    }

    for (const invoice of invoices) {
      commands.push({
        id: `invoice-${invoice.id}`,
        label: `${invoice.number} — ${invoice.clientName ?? 'No client'}`,
        subtitle: formatMoney(invoice.gross),
        group: 'Invoice',
        icon: ReceiptText,
        searchText: `${invoice.number} ${invoice.clientName ?? ''} invoice ${invoice.displayStatus}`,
        run: go('/invoices')
      })
    }

    for (const document of documents) {
      commands.push({
        id: `document-${document.id}`,
        label: document.title,
        subtitle: document.category,
        group: 'Document',
        icon: FileText,
        searchText: `${document.title} ${document.category} ${document.tags.join(' ')} document`,
        run: go('/documents')
      })
    }

    commands.push({
      id: 'today',
      label: "Today's schedule",
      group: 'Calendar',
      icon: CalendarDays,
      searchText: `Today schedule calendar ${dayFromDate(new Date())}`,
      run: go('/calendar')
    })

    // Navigation last: they are always reachable in the sidebar, so they are
    // the least interesting thing the palette can offer.
    for (const item of allNavItems) {
      commands.push({
        id: `nav-${item.path}`,
        label: item.label,
        group: 'Go to',
        icon: item.icon,
        searchText: `Go to ${item.label}`,
        run: go(item.path)
      })
    }

    return commands
  }, [projects, clients, tasks, invoices, documents, running, navigate, queryClient, close])
}
import { useMemo } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import {
  Building2,
  CalendarDays,
  CircleCheckBig,
  Clock,
  FileText,
  FolderKanban,
  LifeBuoy,
  Megaphone,
  NotebookPen,
  Play,
  Plus,
  ReceiptText,
  ScrollText,
  Square,
  Wallet,
  type LucideIcon
} from 'lucide-react'
import { dayFromDate } from '@shared/calendar'
import { rangeFor } from '@shared/taxYear'
import type { EntityType } from '@shared/types'
import { DRAWER_PARAM } from '@/hooks/useDrawer'
import { refToParam } from '@/lib/entities'
import { describeSeconds, parseLoggedTime } from '@shared/logEntry'
import { invalidate, keys } from '@/lib/api'
import { useFeature } from '@/lib/features'
import { allNavItems } from '@/lib/nav'
import { GUIDES } from '@shared/guides'
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
  query,
  navigate,
  queryClient,
  close
}: {
  enabled: boolean
  /**
   * What is typed, so a verb can be built out of it.
   *
   * Most commands are a fixed list the matcher filters. "Log 2h yesterday" is
   * not in any list — it only exists once somebody has typed it — so the raw
   * text has to reach here.
   */
  query: string
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

  const { data: notes = [] } = useQuery({
    queryKey: keys.standaloneNotes(),
    queryFn: () => window.solo.invoke('notes:standalone', {}),
    ...options
  })

  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => window.solo.invoke('quotes:list', {}),
    ...options
  })

  /**
   * This tax year's expenses, not every one ever recorded.
   *
   * `rangeFor('year')` is the tax year, so this resets each April rather than
   * growing without limit. Anything older is found on the Finance page, where
   * the period is a control rather than a guess.
   */
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', 'palette'],
    queryFn: () => {
      const range = rangeFor('year')
      return window.solo.invoke('expenses:list', { from: range.from, to: range.to })
    },
    ...options
  })

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: () => window.solo.invoke('documents:list', {}),
    ...options
  })

  // Marketing is Pro. Without this the palette would ask on every keystroke
  // for a section Basic cannot open, and every one would be refused.
  const marketing = useFeature('marketing')

  const { data: posts = [] } = useQuery({
    queryKey: keys.posts(),
    queryFn: () => window.solo.invoke('marketing:posts', {}),
    ...options,
    enabled: (options.enabled ?? true) && marketing
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

    /**
     * Open the record, not the list it lives on.
     *
     * Searching for INV-042 and landing on the invoices page with nothing
     * selected is barely a search result. The drawer takes a ref out of the
     * URL, so naming it here is the whole of it.
     */
    const open = (path: string, ref: { type: EntityType; id: number }) =>
      go(`${path}?${DRAWER_PARAM}=${refToParam(ref)}`)

    const commands: Command[] = []

    /**
     * "Log 2h yesterday" — a command that does not exist until it is typed.
     *
     * First in the list when it parses, because somebody who has typed a
     * duration and a day has said exactly what they want and should not have
     * to scroll past six records to get it. The label reads the parse back so
     * it can be checked before Enter commits anything.
     */
    const logged = parseLoggedTime(query, dayFromDate(new Date()))
    if (logged) {
      commands.push({
        id: 'log-time',
        label: `Log ${describeSeconds(logged.seconds)}${
          logged.note ? ` — ${logged.note}` : ''
        }`,
        subtitle: logged.date === dayFromDate(new Date()) ? 'today' : logged.date,
        group: 'Action',
        icon: Clock,
        searchText: query,
        run: async () => {
          const started = `${logged.date}T09:00:00`
          await window.solo.invoke('time:create', {
            projectId: null,
            startedAt: started,
            duration: logged.seconds,
            notes: logged.note,
            billable: true
          })
          invalidate(queryClient, ['time', 'finance'])
          close()
        }
      })
    }

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
      },
      {
        id: 'new-post',
        label: 'New post',
        group: 'Action',
        icon: Plus,
        searchText: 'New post create social marketing linkedin instagram schedule',
        run: go('/marketing?new=1')
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
        run: open('/tasks', { type: 'task', id: task.id })
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
        run: open('/invoices', { type: 'invoice', id: invoice.id })
      })
    }

    for (const document of documents) {
      commands.push({
        id: `document-${document.id}`,
        label: document.title,
        subtitle: document.category,
        group: 'Document',
        icon: FileText,
        searchText: `${document.title} ${document.category} document`,
        run: open('/documents', { type: 'document', id: document.id })
      })
    }

    for (const note of notes) {
      commands.push({
        id: `note-${note.id}`,
        label: note.title,
        subtitle: note.projectName ?? undefined,
        group: 'Note',
        icon: NotebookPen,
        searchText: `${note.title} ${note.projectName ?? ''} note`,
        run: open('/notes', { type: 'note', id: note.id })
      })
    }

    for (const quote of quotes) {
      commands.push({
        id: `quote-${quote.id}`,
        label: `${quote.number} — ${quote.clientName ?? 'No client'}`,
        subtitle: formatMoney(quote.gross),
        group: 'Quote',
        icon: ScrollText,
        searchText: `${quote.number} ${quote.clientName ?? ''} quote ${quote.status}`,
        run: open('/invoices', { type: 'quote', id: quote.id })
      })
    }

    for (const expense of expenses) {
      const label = expense.vendor || expense.description || 'Expense'
      commands.push({
        id: `expense-${expense.id}`,
        label,
        subtitle: formatMoney(expense.total),
        group: 'Expense',
        icon: Wallet,
        searchText: `${expense.vendor} ${expense.description} ${expense.category} expense`,
        run: open('/finance', { type: 'expense', id: expense.id })
      })
    }

    for (const post of posts) {
      commands.push({
        id: `post-${post.id}`,
        label: post.title || post.body.slice(0, 60) || 'Untitled post',
        subtitle: post.scheduledAt ? post.scheduledAt.replace('T', ' ') : 'Backlog',
        group: 'Post',
        icon: Megaphone,
        colour: post.campaignColour ?? post.pillarColour ?? undefined,
        searchText: `${post.title} ${post.body} ${post.campaignName ?? ''} post social`,
        run: go('/marketing')
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

    /*
      One entry per guide, matched on its summary as well as its title.
      Somebody stuck types the word confusing them — "billable", "overdue",
      "cadence" — rather than the name of the page it is documented on, and
      the palette is where they are already looking.
    */
    for (const guide of GUIDES) {
      commands.push({
        id: `guide-${guide.id}`,
        label: `${guide.title} guide`,
        group: 'Help',
        icon: LifeBuoy,
        searchText: `Guide help how to ${guide.title} ${guide.summary}`,
        run: go('/guides')
      })
    }

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
  }, [projects, clients, tasks, invoices, documents, posts, running, navigate, queryClient, close])
}
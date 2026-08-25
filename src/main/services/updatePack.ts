import type { Database } from '../db'
import type { ClientUpdatePack, UpdatePackProject } from '@shared/types'
import { today } from '@shared/taxYear'
import { getClient } from './clients'
import { listInvoices } from './invoices'
import { listProjects } from './projects'
import { listTasks } from './tasks'
import { listEntries } from './time'

/**
 * The client update pack.
 *
 * One document a freelancer sends a client saying where the work is: what has
 * moved, what is next, hours logged, and what is outstanding. It is the thing
 * a client portal exists to provide, without the portal — no hosting, no
 * accounts for the client, nothing for anybody to log into and nothing for us
 * to run.
 *
 * That is the point rather than a compromise. A portal would mean holding a
 * freelancer's clients' data on a server, which is the one thing this app is
 * built not to do, and it would be a second product to keep alive. A file they
 * email is finished the moment it is written.
 *
 * Everything here is derived from records the user already keeps. Nothing asks
 * them to maintain a status report as well as doing the work — a report that
 * needs feeding is a report that goes stale and then lies.
 */

/** Recent enough to be news, long enough to cover a quiet fortnight. */
const RECENT_DAYS = 30

function daysAgo(from: string, days: number): string {
  const [year, month, day] = from.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10)
}

export function buildUpdatePack(
  db: Database,
  clientId: number,
  options: { since?: string; asOf?: string } = {}
): ClientUpdatePack {
  const asOf = options.asOf ?? today()
  const since = options.since ?? daysAgo(asOf, RECENT_DAYS)

  const client = getClient(db, clientId)

  /**
   * Live work only.
   *
   * A completed project stays on the pack if it completed inside the window —
   * "we finished this" is the best news on the page — but one finished last
   * spring is history, and a client update that opens with history reads as
   * padding.
   */
  const projects = listProjects(db, { clientId })
    .filter((project) => !project.archived)
    .filter(
      (project) =>
        project.status !== 'cancelled' &&
        (project.status !== 'completed' || project.updatedAt.slice(0, 10) >= since)
    )
    .sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'))

  const detailed: UpdatePackProject[] = projects.map((project) => {
    const tasks = listTasks(db, { projectId: project.id })

    const entries = listEntries(db, { projectId: project.id }).filter(
      (entry) => entry.endedAt !== null
    )

    return {
      name: project.name,
      status: project.status,
      colour: project.colour,
      dueOn: project.dueOn,
      /**
       * Done inside the window, so this reads as "since we last spoke" rather
       * than as everything ever finished. `updatedAt` is when it was last
       * touched, which for a done task is when it was marked done.
       */
      completed: tasks
        .filter((task) => task.status === 'done' && task.updatedAt.slice(0, 10) >= since)
        .map((task) => task.title),
      // What is next, not everything outstanding: a client does not need the
      // backlog, they need to know the work is moving.
      next: tasks
        .filter((task) => task.status !== 'done')
        .slice(0, 5)
        .map((task) => task.title),
      hoursTotal: entries.reduce((sum, entry) => sum + entry.duration, 0) / 3600,
      hoursRecent:
        entries
          .filter((entry) => entry.startedAt.slice(0, 10) >= since)
          .reduce((sum, entry) => sum + entry.duration, 0) / 3600
    }
  })

  /**
   * Only what is genuinely owed.
   *
   * Drafts are excluded for the same reason a statement excludes them — the
   * client has never seen them — and a pack that asked for money against an
   * invoice never sent would be the worst possible thing to email anybody.
   */
  const outstanding = listInvoices(db, { clientId })
    .filter((invoice) => invoice.status === 'sent' && invoice.paidAt === null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((invoice) => ({
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      gross: invoice.gross,
      overdue: invoice.dueDate < asOf
    }))

  return {
    clientName: client.name,
    contactName: client.contactName,
    asOf,
    since,
    projects: detailed,
    outstanding,
    outstandingTotal: outstanding.reduce((sum, invoice) => sum + invoice.gross, 0),
    hoursRecent: detailed.reduce((sum, project) => sum + project.hoursRecent, 0)
  }
}

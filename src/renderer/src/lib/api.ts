import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { EntityType } from '@shared/types'

/**
 * Query keys in one place. Scattered key literals are the usual reason a
 * mutation updates the database but not the screen, so every key is built here
 * and invalidation goes through `useInvalidate`.
 */
export const keys = {
  settings: ['settings'] as const,
  clients: ['clients'] as const,
  client: (id: number) => ['clients', id] as const,
  projects: (clientId?: number) =>
    clientId === undefined ? (['projects'] as const) : (['projects', { clientId }] as const),
  project: (id: number) => ['project', id] as const,
  tasks: (filter?: unknown) => (filter ? (['tasks', filter] as const) : (['tasks'] as const)),
  categories: ['categories'] as const,
  notes: (projectId: number) => ['notes', projectId] as const,
  note: (id: number) => ['note', id] as const,
  templates: ['templates'] as const,
  events: (from: string, to: string, projectId: number | null) =>
    ['events', { from, to, projectId }] as const,
  posts: (filter?: unknown) =>
    filter ? (['marketing', 'posts', filter] as const) : (['marketing', 'posts'] as const),
  campaigns: ['marketing', 'campaigns'] as const,
  pillars: ['marketing', 'pillars'] as const,
  accounts: ['social', 'accounts'] as const,
  goals: ['goals'] as const,
  standaloneNotes: (search?: string) =>
    search ? (['notes', 'standalone', search] as const) : (['notes', 'standalone'] as const),
  related: (type: EntityType, id: number) => ['links', type, id] as const,
  activity: (type: EntityType, id: number) => ['activity', type, id] as const,
  entityLabel: (type: EntityType, id: number) => ['entity', 'label', type, id] as const,
  entityFind: (type: EntityType | undefined, query: string) =>
    ['entity', 'find', type ?? 'all', query] as const
}

/**
 * Records, folders and files are entangled — creating a project touches
 * projects, its client's project list and the task list. Rather than making
 * every mutation reason about that, mutations name the domains they touched.
 */
export type Domain =
  | 'clients'
  | 'projects'
  | 'tasks'
  | 'categories'
  | 'notes'
  | 'templates'
  | 'documents'
  | 'files'
  | 'time'
  | 'invoices'
  | 'quotes'
  | 'expenses'
  | 'finance'
  | 'events'
  | 'marketing'
  | 'social'
  | 'goals'
  | 'notifications'
  | 'links'

export function invalidate(queryClient: QueryClient, domains: Domain[]): void {
  for (const domain of domains) {
    void queryClient.invalidateQueries({ queryKey: [domain] })
  }
  // Project summaries carry task counts, so tasks changing means projects too.
  if (domains.includes('tasks')) {
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['project'] })
  }

  // Every write is recorded in the activity table by a trigger, so the drawer's
  // timeline is stale after any mutation whatsoever. Named here rather than by
  // every caller because "did this change history?" is always yes, and the
  // queries only exist while a drawer is open.
  void queryClient.invalidateQueries({ queryKey: ['activity'] })

  // Every money movement feeds the finance page, so callers never have to
  // remember to name it alongside the domain they actually touched.
  if (['invoices', 'expenses', 'time', 'quotes'].some((name) => domains.includes(name as Domain))) {
    void queryClient.invalidateQueries({ queryKey: ['finance'] })
  }
}

export function useInvalidate(): (domains: Domain[]) => void {
  const queryClient = useQueryClient()
  return (domains) => invalidate(queryClient, domains)
}
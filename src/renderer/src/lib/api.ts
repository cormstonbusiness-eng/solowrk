import { useQueryClient, type QueryClient } from '@tanstack/react-query'

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
  templates: ['templates'] as const
}

/**
 * Records, folders and files are entangled — creating a project touches
 * projects, its client's project list and the task list. Rather than making
 * every mutation reason about that, mutations name the domains they touched.
 */
export type Domain = 'clients' | 'projects' | 'tasks' | 'categories' | 'notes' | 'templates'

export function invalidate(queryClient: QueryClient, domains: Domain[]): void {
  for (const domain of domains) {
    void queryClient.invalidateQueries({ queryKey: [domain] })
  }
  // Project summaries carry task counts, so tasks changing means projects too.
  if (domains.includes('tasks')) {
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['project'] })
  }
}

export function useInvalidate(): (domains: Domain[]) => void {
  const queryClient = useQueryClient()
  return (domains) => invalidate(queryClient, domains)
}
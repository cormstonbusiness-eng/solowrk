import type { EntityType } from '@shared/types'

/**
 * Which table each linkable, history-keeping type lives in, and what to call
 * one of its rows on screen.
 *
 * One registry, shared by the links service and the activity service, because
 * both need to ask "does this row still exist?" and a second copy would drift
 * the first time a table is renamed.
 *
 * Everything here is a literal. No caller supplies a table or a column name —
 * only ids, and those are always parameters.
 */
export interface EntitySource {
  table: string
  /** The row's display name, as SQL against the given alias. */
  label: (alias: string) => string
}

export const ENTITY_SOURCES: Record<EntityType, EntitySource> = {
  client: { table: 'clients', label: (a) => `${a}.name` },
  project: { table: 'projects', label: (a) => `${a}.name` },
  task: { table: 'tasks', label: (a) => `${a}.title` },
  // Drafts have no number yet, and a blank row is unusable.
  invoice: {
    table: 'invoices',
    label: (a) => `COALESCE(NULLIF(${a}.number, ''), 'Draft invoice')`
  },
  quote: { table: 'quotes', label: (a) => `COALESCE(NULLIF(${a}.number, ''), 'Draft quote')` },
  note: { table: 'notes', label: (a) => `${a}.title` },
  document: { table: 'documents', label: (a) => `${a}.title` },
  expense: {
    table: 'expenses',
    label: (a) => `COALESCE(NULLIF(${a}.description, ''), ${a}.vendor)`
  }
}

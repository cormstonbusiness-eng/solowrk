import {
  CalendarClock,
  FileText,
  FolderKanban,
  ListChecks,
  Megaphone,
  Receipt,
  ScrollText,
  StickyNote,
  Users,
  Wallet,
  type LucideIcon
} from 'lucide-react'
import type { EntityType } from '@shared/types'

/**
 * What each kind of thing is called on screen, and what it looks like.
 *
 * The renderer's half of the registry in `main/db/entities.ts`. Kept separate
 * because the two answer different questions — that one knows which table a
 * row is in, this one knows what to draw — and putting an icon in a file the
 * database layer imports would drag lucide into the main process.
 */
export interface EntityMeta {
  /** Singular, lower case, as it appears mid-sentence. */
  noun: string
  plural: string
  icon: LucideIcon
  /**
   * The full page for one of these, where there is one. Six of the eight are
   * only ever seen in a list or in the drawer, and a link that goes nowhere is
   * worse than no link.
   */
  route?: (id: number) => string
}

export const ENTITY_META: Record<EntityType, EntityMeta> = {
  client: {
    noun: 'client',
    plural: 'Clients',
    icon: Users,
    route: (id) => `/clients/${id}`
  },
  project: {
    noun: 'project',
    plural: 'Projects',
    icon: FolderKanban,
    route: (id) => `/projects/${id}`
  },
  task: { noun: 'task', plural: 'Tasks', icon: ListChecks },
  invoice: { noun: 'invoice', plural: 'Invoices', icon: Receipt },
  quote: { noun: 'quote', plural: 'Quotes', icon: ScrollText },
  note: { noun: 'note', plural: 'Notes', icon: StickyNote },
  document: { noun: 'document', plural: 'Documents', icon: FileText },
  expense: { noun: 'expense', plural: 'Expenses', icon: Wallet },
  // "Block" rather than "event": what goes in this calendar is an hour of
  // something, and half of them are nobody's meeting.
  // No route: a link to /calendar cannot know which week the block is in, and
  // landing on today with the block off screen is worse than not offering it.
  block: { noun: 'block', plural: 'Calendar', icon: CalendarClock },
  campaign: {
    noun: 'campaign',
    plural: 'Campaigns',
    icon: Megaphone,
    route: (id) => `/marketing?campaign=${id}`
  }
}

/** `client:12`, the form a ref takes in a URL. */
export function refToParam(ref: { type: EntityType; id: number }): string {
  return `${ref.type}:${ref.id}`
}

/**
 * Read a ref back out of a URL.
 *
 * Returns null rather than throwing on anything unrecognised: the parameter is
 * whatever was in the address bar, and a typo should close the drawer rather
 * than take the page down.
 */
export function refFromParam(value: string | null): { type: EntityType; id: number } | null {
  if (!value) return null
  const [type, rawId] = value.split(':')
  if (!type || !rawId) return null
  if (!(type in ENTITY_META)) return null
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return null
  return { type: type as EntityType, id }
}

import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheckBig,
  Clock,
  FileText,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Megaphone,
  NotebookPen,
  ReceiptText,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { Feature } from '@shared/entitlements'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /**
   * The paid feature this section needs, if any.
   *
   * Only drives what the sidebar draws — a lock instead of nothing, so the
   * section is discoverable rather than hidden. The actual refusal happens in
   * the main process, and the page itself shows the upsell.
   */
  feature?: Feature
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Sidebar structure. Route components are wired up in App.tsx from this list. */
export const navGroups: NavGroup[] = [
  {
    label: 'Work',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Projects', path: '/projects', icon: FolderKanban },
      { label: 'Tasks', path: '/tasks', icon: CircleCheckBig },
      { label: 'Time', path: '/time', icon: Clock },
      { label: 'Calendar', path: '/calendar', icon: CalendarDays },
      { label: 'Notes', path: '/notes', icon: NotebookPen }
    ]
  },
  {
    label: 'Business',
    items: [
      { label: 'Business plan', path: '/business-plan', icon: BookOpen },
      { label: 'Clients', path: '/clients', icon: Users },
      { label: 'Marketing', path: '/marketing', icon: Megaphone, feature: 'marketing' },
      { label: 'Goals', path: '/goals', icon: Target },
      { label: 'Invoices', path: '/invoices', icon: ReceiptText },
      { label: 'Finance', path: '/finance', icon: ChartNoAxesCombined }
    ]
  },
  {
    label: 'Library',
    items: [
      { label: 'Files', path: '/files', icon: FolderOpen },
      { label: 'Documents', path: '/documents', icon: FileText },
      // In the library rather than pinned at the bottom: it is a place things
      // are kept, not a setting, and it wants finding when somebody is already
      // looking for something they cannot see.
      { label: 'Trash', path: '/trash', icon: Trash2 }
    ]
  }
]

/** Pinned to the bottom of the sidebar, away from the day-to-day navigation. */
export const footerNav: NavItem[] = [{ label: 'Assistant', path: '/assistant', icon: Sparkles }]

/**
 * Settings: a destination, but not a sidebar row.
 *
 * It is reached from the account menu at the foot of the sidebar, with the
 * other things that are about you rather than about the work. It had a row
 * there too, which meant two controls a few pixels apart doing the same thing.
 *
 * Still listed in `allNavItems`, so Ctrl K offers it like any other section. A
 * destination with no visible row is precisely the one people open the palette
 * to find, and dropping it from there would have turned a tidy-up into a
 * regression.
 */
export const settingsNav: NavItem = { label: 'Settings', path: '/settings', icon: Settings }

export const allNavItems: NavItem[] = [
  ...navGroups.flatMap((g) => g.items),
  ...footerNav,
  settingsNav
]
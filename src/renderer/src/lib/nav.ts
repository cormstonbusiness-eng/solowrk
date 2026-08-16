import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheckBig,
  Clock,
  FileText,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Megaphone,
  ReceiptText,
  Settings,
  Sparkles,
  Users,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
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
      { label: 'Calendar', path: '/calendar', icon: CalendarDays }
    ]
  },
  {
    label: 'Business',
    items: [
      { label: 'Clients', path: '/clients', icon: Users },
      { label: 'Marketing', path: '/marketing', icon: Megaphone },
      { label: 'Invoices', path: '/invoices', icon: ReceiptText },
      { label: 'Finance', path: '/finance', icon: ChartNoAxesCombined }
    ]
  },
  {
    label: 'Library',
    items: [
      { label: 'Files', path: '/files', icon: FolderOpen },
      { label: 'Documents', path: '/documents', icon: FileText }
    ]
  }
]

/** Pinned to the bottom of the sidebar, away from the day-to-day navigation. */
export const footerNav: NavItem[] = [
  { label: 'Assistant', path: '/assistant', icon: Sparkles },
  { label: 'Settings', path: '/settings', icon: Settings }
]

export const allNavItems: NavItem[] = [...navGroups.flatMap((g) => g.items), ...footerNav]
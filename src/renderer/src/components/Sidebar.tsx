import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { transition } from '@/lib/motion'
import { footerNav, navGroups, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

/**
 * A single shared `layoutId` on the active pill means the highlight physically
 * slides between destinations instead of blinking out and back in. It is the
 * detail that makes navigation feel continuous.
 */
function ActivePill(): React.JSX.Element {
  return (
    <motion.span
      layoutId="nav-active-pill"
      transition={transition.layout}
      className="absolute inset-0 rounded-control bg-raised"
      aria-hidden
    />
  )
}

function AssistantButton(): React.JSX.Element {
  const { pathname } = useLocation()
  const isActive = pathname === '/assistant'

  return (
    <NavLink
      to="/assistant"
      className={cn(
        'flex items-center gap-2.5 rounded-control px-2.5 py-[9px] text-[13px] font-medium',
        'transition-colors duration-150',
        // Warm orange, deliberately the only place this hue appears — the
        // accent violet is spoken for by primary actions and active nav, so
        // reusing it here would make the button disappear into the app.
        isActive
          ? 'bg-[#F2A65A] text-[#1a1207]'
          : 'bg-[#F2A65A]/16 text-[#F2A65A] hover:bg-[#F2A65A]/26'
      )}
    >
      <Sparkles size={15} strokeWidth={2} />
      Assistant
    </NavLink>
  )
}

function NavRow({ item }: { item: NavItem }): React.JSX.Element {
  const { pathname } = useLocation()
  const isActive = pathname === item.path
  const Icon = item.icon

  return (
    <NavLink
      to={item.path}
      className={cn(
        'relative flex items-center gap-2.5 rounded-control px-2.5 py-[7px]',
        'text-[13px] transition-colors duration-150',
        isActive ? 'text-ink' : 'text-muted hover:text-ink'
      )}
    >
      {isActive && <ActivePill />}
      {/* Sits above the pill so the label never gets painted over. */}
      <Icon
        size={16}
        strokeWidth={1.75}
        className={cn('relative z-10 shrink-0', isActive && 'text-accent')}
      />
      <span className="relative z-10 truncate">{item.label}</span>
    </NavLink>
  )
}

export function Sidebar(): React.JSX.Element {
  return (
    <nav
      data-tour="sidebar"
      className="flex w-[212px] shrink-0 flex-col border-r border-line bg-ground"
    >
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {navGroups.map((group) => (
          // data-tour targets are derived from the group label, so adding a
          // group cannot silently break a tour step that points at it.
          <div key={group.label} data-tour={`nav-${group.label.toLowerCase()}`} className="mb-5">
            <p className="px-2.5 pb-1.5 text-[10px] font-medium tracking-[0.1em] text-faint uppercase">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavRow key={item.path} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The assistant sits above the divider as a filled button rather than
          another grey nav row: it is the one destination people hunt for, and a
          row that looks like every other row is a row you scan past. */}
      <div className="px-2.5 pb-1.5">
        <AssistantButton />
      </div>

      <div
        data-tour="nav-footer"
        className="flex flex-col gap-0.5 border-t border-line px-2.5 py-2.5"
      >
        {footerNav
          .filter((item) => item.path !== '/assistant')
          .map((item) => (
            <NavRow key={item.path} item={item} />
          ))}
      </div>
    </nav>
  )
}
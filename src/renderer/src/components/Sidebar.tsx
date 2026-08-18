import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, LogOut, Sparkles } from 'lucide-react'
import { transition } from '@/lib/motion'
import { footerNav, navGroups, type NavItem } from '@/lib/nav'
import { themeById } from '@shared/themes'
import { useTheme } from '@/hooks/useTheme'
import { ConfirmModal } from '@/components/ui/Modal'
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

/**
 * Sits with the assistant, above the divider, because both are things you go to
 * rather than places work lives. The badge is the point: an unread count you
 * cannot see is a notification system that does not work.
 */
function NotificationsButton(): React.JSX.Element {
  const { pathname } = useLocation()
  const isActive = pathname === '/notifications'

  const { data: unread = 0 } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => window.solo.invoke('notifications:unread'),
    refetchInterval: 30_000
  })

  return (
    <NavLink
      to="/notifications"
      className={cn(
        'relative flex items-center gap-2.5 rounded-control px-2.5 py-[7px]',
        'text-[13px] transition-colors duration-150',
        isActive ? 'text-ink' : 'text-muted hover:text-ink'
      )}
    >
      {isActive && <ActivePill />}
      <span className="relative">
        <Bell size={15} strokeWidth={1.75} />
      </span>
      <span className="relative flex-1">Notifications</span>
      {unread > 0 && (
        <motion.span
          key={unread}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={transition.press}
          className="relative grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-ink"
        >
          {unread > 99 ? '99+' : unread}
        </motion.span>
      )}
    </NavLink>
  )
}

function AssistantButton(): React.JSX.Element {
  const { pathname } = useLocation()
  const { themeId } = useTheme()
  const isActive = pathname === '/assistant'

  // A tinted orange on a near-black sidebar reads as a warm button; the same
  // tint on a white one reads as a smudge. Light themes get the solid fill.
  const light = themeById(themeId).light

  return (
    <NavLink
      to="/assistant"
      className={cn(
        'flex items-center gap-2.5 rounded-control px-2.5 py-[9px] text-[13px] font-medium',
        'transition-colors duration-150',
        // Warm orange, deliberately the only place this hue appears — the
        // accent violet is spoken for by primary actions and active nav, so
        // reusing it here would make the button disappear into the app.
        isActive || light
          ? 'bg-[#E08A2E] text-white hover:bg-[#cc7c26]'
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

/**
 * Logging out, under Settings.
 *
 * The one loud thing in the sidebar, and deliberately so — everything above it
 * is a place to go, this is an action that ends the session, and it should not
 * look like another nav row you might click by accident on the way to Settings.
 * The confirm names the account, because on a shared machine whose session is
 * ending matters more than the verb.
 *
 * Hidden entirely when there is no account server, because a log-out button
 * that logs you out of nothing is a puzzle rather than a feature.
 */
function SignOutRow(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const { data: auth } = useQuery({
    queryKey: ['auth', 'state'],
    queryFn: () => window.solo.invoke('auth:state')
  })

  const signOut = useMutation({
    mutationFn: () => window.solo.invoke('auth:signOut'),
    onSuccess: () => {
      // A full reload is the honest way back to the sign-in screen: it clears
      // every cached query, and none of it belongs to the next person.
      queryClient.clear()
      window.location.reload()
    }
  })

  if (!auth?.configured || !auth.signedIn) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={cn(
          'mt-1 flex items-center justify-center gap-2 rounded-control px-2.5 py-2',
          // Mixed down from the danger token rather than used neat: #e5484d
          // under white text is about 3.9:1, which fails AA at this size. The
          // mix keeps one source of truth for the colour and lands near 5.5:1,
          // and it follows the token if the theme ever changes it.
          'bg-[color-mix(in_srgb,var(--color-danger)_85%,black)]',
          'hover:bg-[color-mix(in_srgb,var(--color-danger)_72%,black)]',
          'text-[12px] font-bold tracking-[0.09em] text-white uppercase',
          'transition-colors duration-150'
        )}
      >
        <LogOut size={15} strokeWidth={2.25} className="shrink-0" />
        Log out
      </button>

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => signOut.mutate()}
        title="Log out?"
        body={
          `You will need to sign in again as ${auth.account?.email ?? 'your account'} to use ` +
          'SoloWrk on this computer. Your workspace stays exactly where it is — nothing in it ' +
          'is touched, and nothing is uploaded.'
        }
        confirmLabel="Log out"
      />
    </>
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
      <div className="flex flex-col gap-1 px-2.5 pb-1.5">
        <NotificationsButton />
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
        <SignOutRow />
      </div>
    </nav>
  )
}
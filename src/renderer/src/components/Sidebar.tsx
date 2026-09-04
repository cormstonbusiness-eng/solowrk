import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronUp, Lock, Sparkles } from 'lucide-react'
import { EASE, transition } from '@/lib/motion'
import { useAuthState, useFeature } from '@/lib/features'
import { useUpdates } from '@/hooks/useUpdates'
import { footerNav, navGroups, type NavItem } from '@/lib/nav'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
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
      className="absolute inset-0 rounded-control bg-accent-subtle"
      aria-hidden
    >
      {/* The 3px bar rides inside the same layoutId, so it slides with the
          fill rather than being a second thing that has to keep up. */}
      <span className="absolute top-1 bottom-1 left-0 w-[3px] rounded-full bg-accent" />
    </motion.span>
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

  /**
   * A tinted fill on a near-black sidebar reads as a warm button; the same
   * tint on a white one reads as a smudge. Light themes get the solid fill.
   */
  const light = themeById(themeId).light

  return (
    <NavLink
      to="/assistant"
      data-tour="nav-assistant"
      className={cn(
        'flex items-center gap-2.5 rounded-control px-2.5 py-[9px] text-[13px] font-medium',
        'transition-colors duration-press ease-solo',
        /**
         * The accent, not a second orange.
         *
         * This button used to carry its own hue precisely because the accent
         * was violet and reusing it would have made the button disappear. Now
         * that the accent *is* orange, keeping the old one would put two
         * oranges a few pixels apart, which is the single most obvious way to
         * make a palette look unfinished.
         */
        isActive || light
          ? 'bg-accent text-accent-ink hover:bg-accent-hover'
          : 'bg-accent-subtle text-accent hover:bg-accent/25'
      )}
    >
      <Sparkles size={15} strokeWidth={2} />
      Assistant
    </NavLink>
  )
}

/**
 * A padlock leaving.
 *
 * 300ms with a 60ms stagger down the sidebar, so the locks come off in the
 * order the eye reads them rather than all at once — which looks like a
 * rendering fault rather than like something being given.
 *
 * The row it leaves behind fades from `disabled` to full colour on its own
 * transition, which is why the lock rotates and fades rather than simply
 * vanishing: something has to visibly *go* for the colour change to read as a
 * consequence.
 */
const UNLOCK_MS = 0.3
const UNLOCK_STAGGER = 0.06

function NavRow({ item, unlockIndex }: { item: NavItem; unlockIndex: number }): React.JSX.Element {
  const { pathname } = useLocation()
  const isActive = pathname === item.path
  const Icon = item.icon

  /**
   * A locked section still navigates.
   *
   * Hiding it would be tidier and worse: somebody who has read the pricing page
   * would wonder where Marketing went and conclude the app is broken rather
   * than that they are on Basic. The page behind it explains itself.
   */
  // `marketing` stands in for "no gate at all" so the hook is called
  // unconditionally; `locked` is what actually decides, and it checks for the
  // absence of a feature first.
  const entitled = useFeature(item.feature ?? 'marketing')
  const locked = item.feature !== undefined && !entitled

  return (
    <NavLink
      to={item.path}
      className={cn(
        'relative flex items-center gap-2.5 rounded-control px-2.5 py-[7px]',
        'text-[13px] transition-colors duration-press ease-solo',
        isActive
          ? 'text-ink'
          : locked
            ? 'text-disabled hover:bg-surface hover:text-faint'
            : 'text-muted hover:bg-surface hover:text-ink'
      )}
    >
      {isActive && <ActivePill />}
      {/* Sits above the pill so the label never gets painted over. */}
      <Icon
        size={18}
        strokeWidth={1.5}
        className={cn('relative z-10 shrink-0', isActive && 'text-accent')}
      />
      <span className="relative z-10 truncate">{item.label}</span>
      <AnimatePresence>
        {locked && (
          <motion.span
            key="lock"
            className="relative z-10 ml-auto shrink-0"
            initial={false}
            exit={{ opacity: 0, rotate: -90, scale: 0.6 }}
            transition={{
              duration: UNLOCK_MS,
              ease: EASE,
              // Only the rows that were actually locked are staggered, so a
              // sidebar with two locks in it does not pause on the eleven
              // rows between them.
              delay: unlockIndex * UNLOCK_STAGGER
            }}
          >
            <Lock size={11} strokeWidth={2} aria-label="Part of SoloWrk Pro" />
          </motion.span>
        )}
      </AnimatePresence>
    </NavLink>
  )
}

/**
 * The account chip, pinned to the bottom of the sidebar.
 *
 * It replaces a filled red LOG OUT button that was, by a distance, the
 * highest-contrast element in the entire application — which put the strongest
 * visual emphasis in the app on the action least worth taking. Logging out
 * still lives here, one click deeper, in `danger` text rather than as a slab
 * of red.
 *
 * Shown whether or not an account server is configured: on an unlicensed build
 * it is still the way to Settings and to check for updates, and a sidebar
 * whose bottom is empty on some installs and not others looks broken on the
 * install that has less.
 */
function AccountChip(): React.JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const auth = useAuthState()
  const updates = useUpdates()

  const signOut = useMutation({
    mutationFn: () => window.solo.invoke('auth:signOut'),
    onSuccess: () => {
      // A full reload is the honest way back to the sign-in screen: it clears
      // every cached query, and none of it belongs to the next person.
      queryClient.clear()
      window.location.reload()
    }
  })

  // Closes on any click that is not inside it, and on Escape. A popover you
  // have to click exactly the right pixel to dismiss is a popover people learn
  // to avoid opening.
  useEffect(() => {
    if (!open) return

    const close = (): void => setOpen(false)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = auth?.account?.name?.trim() || auth?.account?.email?.split('@')[0] || 'Your account'
  const tier = auth?.configured ? (auth.account?.plan ?? 'Not signed in') : 'Unlicensed'

  return (
    <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left',
          'transition-colors duration-press ease-solo hover:bg-surface'
        )}
      >
        <Avatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-ink">{name}</span>
          <span className="block truncate text-[11px] text-faint">{tier}</span>
        </span>
        <ChevronUp
          size={14}
          strokeWidth={1.5}
          className={cn(
            'shrink-0 text-faint transition-transform duration-press ease-solo',
            !open && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={transition.press}
            className={cn(
              'absolute bottom-[calc(100%+6px)] left-0 z-50 w-[196px] origin-bottom',
              'rounded-card border border-line bg-overlay p-1 shadow-modal'
            )}
          >
            {auth?.configured && (
              <>
                <MenuLink href={`${SITE}/account`}>Account settings</MenuLink>
                <MenuLink href={`${SITE}/account`}>Manage subscription</MenuLink>
              </>
            )}
            <MenuButton
              onClick={() => {
                updates.check()
                setOpen(false)
              }}
            >
              Check for updates
            </MenuButton>
            <MenuButton
              onClick={() => {
                navigate('/settings')
                setOpen(false)
              }}
            >
              Settings
            </MenuButton>

            {/*
              There is always an account action here, and there did not used
              to be: a signed-out user got no way to sign *in* from the one
              menu named after their account, and somebody holding a licence
              with no session got no way to clear it either.

              Log out appears whenever there is something to clear — a session
              or a licence — because signing out drops both, and a machine
              still holding a Pro licence for somebody who has left is the
              case that matters most.
            */}
            <div className="my-1 h-px bg-line" />

            {auth?.signedIn || auth?.licensed ? (
              <MenuButton
                danger
                onClick={() => {
                  setOpen(false)
                  setConfirming(true)
                }}
              >
                Log out
              </MenuButton>
            ) : (
              <MenuButton
                onClick={() => {
                  navigate('/settings?tab=account')
                  setOpen(false)
                }}
              >
                Sign in
              </MenuButton>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => signOut.mutate()}
        title="Log out?"
        body={
          `You will need to sign in again as ${auth?.account?.email ?? 'your account'} to use ` +
          'SoloWrk on this computer. Your workspace stays exactly where it is — nothing in it ' +
          'is touched, and nothing is uploaded.'
        }
        confirmLabel="Log out"
      />
    </div>
  )
}

const SITE = 'https://solo-wrk.com'

/** Initials on a tinted circle, until there is a logo to put here instead. */
function Avatar({ name }: { name: string }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-subtle text-[11px] font-semibold text-accent"
    >
      {initials || '·'}
    </span>
  )
}

const MENU_ITEM =
  'block w-full rounded-chip px-2.5 py-1.5 text-left text-[12.5px] transition-colors duration-press ease-solo'

function MenuButton({
  onClick,
  danger,
  children
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(MENU_ITEM, danger ? 'text-danger hover:bg-danger/12' : 'text-muted hover:bg-hover hover:text-ink')}
    >
      {children}
    </button>
  )
}

/**
 * Opens in the browser rather than in the app shell. The window's
 * `setWindowOpenHandler` routes `target=_blank` out to the default browser and
 * refuses to navigate the app away from itself, so this needs no IPC channel.
 */
function MenuLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      role="menuitem"
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(MENU_ITEM, 'text-muted hover:bg-hover hover:text-ink')}
    >
      {children}
    </a>
  )
}

export function Sidebar(): React.JSX.Element {
  const auth = useAuthState()

  /**
   * Where each locked row sits among the locked rows, top to bottom.
   *
   * Worked out here rather than inside the row, because the stagger has to
   * count only the rows that actually carry a padlock. A sidebar with a lock
   * at the top and another at the bottom should take them off 60ms apart, not
   * pause through the eleven unlocked rows in between.
   */
  const unlockOrder = useMemo(() => {
    const held = new Set(auth?.account?.features ?? [])
    const unlicensed = auth !== undefined && auth.configured

    const order = new Map<string, number>()
    let index = 0

    for (const item of [...navGroups.flatMap((group) => group.items), ...footerNav]) {
      if (item.feature === undefined) continue
      if (unlicensed && !held.has(item.feature)) order.set(item.path, index++)
    }

    return order
  }, [auth])

  return (
    <nav
      data-tour="sidebar"
      className="flex w-[212px] shrink-0 flex-col border-r border-line bg-ground"
    >
      {/* Above everything, because it is the widest piece of context in the
          app: every row below means something different depending on which
          business is open. */}
      <WorkspaceSwitcher />

      <div className="flex-1 overflow-y-auto px-2.5 pt-1 pb-3">
        {navGroups.map((group) => (
          // data-tour targets are derived from the group label, so adding a
          // group cannot silently break a tour step that points at it.
          <div key={group.label} data-tour={`nav-${group.label.toLowerCase()}`} className="mb-5">
            <p className="px-2.5 pb-1.5 text-[10px] font-medium tracking-[0.1em] text-faint uppercase">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavRow
                  key={item.path}
                  item={item}
                  unlockIndex={unlockOrder.get(item.path) ?? 0}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The assistant sits above the divider as a filled button rather than
          another grey nav row: it is the one destination people hunt for, and a
          row that looks like every other row is a row you scan past. */}
      <div data-tour="sidebar-tools" className="flex flex-col gap-1 px-2.5 pb-1.5">
        <NotificationsButton />
        <AssistantButton />
      </div>

      <div
        data-tour="nav-footer"
        className="flex flex-col gap-0.5 border-t border-line px-2.5 py-2.5"
      >
        {/* Only the account chip now. Settings used to sit here as a row as
            well as inside the chip's menu, which is one destination wearing two
            controls; the menu keeps it, because settings are about the person
            rather than the work. `footerNav` is not mapped here at all any
            more: the Assistant is its only member and it is drawn above as its
            own button, so a map over this list could only ever render nothing. */}
        <AccountChip />
      </div>
    </nav>
  )
}
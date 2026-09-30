'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePersistentBoolean } from '@/hooks/use-persistent-boolean'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, ArrowUpDown, UserX, StickyNote, ScrollText,
  Shield, GraduationCap, UserCog, Settings, LogOut, Briefcase,
  Menu, X, KeyRound, Timer, Download,
  FileText, FileSignature, Gavel, FolderSearch, Map,
  History, FolderUp, PanelLeftClose, PanelLeftOpen, ChevronDown, Megaphone,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/context/auth-context'
import { hasAnyPermission, hasPermission, type Permission } from '@/lib/permissions'
import Image from 'next/image'
import { useFetch } from '@/hooks/use-fetch'
import { unitIconComponent } from '@/components/units/unit-icon'
import type { NavigationUnit } from '@/lib/unit-navigation'

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  permission?: Permission
  color?: string
}

interface NavContentProps {
  pathname: string
  onNavigate: () => void
  user: { displayName: string; avatarUrl?: string | null; permissions?: string[] | null; groups?: { id: string; name: string }[] } | null
  logout: () => Promise<void>
  /** Schmale Icon-Leiste: Beschriftungen nur als Tooltip. */
  compact?: boolean
}

export const mainNav: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard:view', color: '#0a84ff' },
  { name: 'Ordnungen', href: '/ordnungen', icon: FileText, color: '#8e8e93' },
  { name: 'Aushänge', href: '/publications', icon: Megaphone, permission: 'publications:manage', color: '#ff9f0a' },
  { name: 'Dienstzeiten', href: '/duty-times', icon: Timer, permission: 'duty-times:view', color: '#30d158' },
  { name: 'Agents', href: '/agents', icon: Users, permission: 'agents:view', color: '#0a84ff' },
  { name: 'Decknamen', href: '/codenames', icon: KeyRound, permission: 'codenames:view', color: '#636366' },
  { name: 'Rangänderungen', href: '/promotions', icon: ArrowUpDown, permission: 'rank-changes:view', color: '#5e5ce6' },
  { name: 'Kündigungen', href: '/terminations', icon: UserX, permission: 'terminations:view', color: '#ff453a' },
  // Ohne `permission`: Sanktionen und Katalog sind für jeden eingeloggten Agent einsehbar.
  { name: 'Sanktionen', href: '/sanktionen', icon: Gavel, color: '#ff375f' },
  { name: 'Korruptionskontrollen', href: '/corruption-checks', icon: Shield, color: '#bf5af2' },
  { name: 'Ermittlungen', href: '/investigations', icon: FolderSearch, permission: 'investigations:view', color: '#30b0c7' },
  { name: 'Karte', href: '/map', icon: Map, permission: 'map:view', color: '#34c759' },
  { name: 'Notizen', href: '/notes', icon: StickyNote, permission: 'notes:view', color: '#ff9f0a' },
  { name: 'Vereinbarungen', href: '/vertraege', icon: FileSignature, permission: 'agreements:view', color: '#ac8e68' },
  { name: 'Uploads', href: '/uploads', icon: FolderUp, permission: 'uploads:view', color: '#64d2ff' },
]

export const adminNav: NavItem[] = [
  { name: 'Protokoll', href: '/logs', icon: ScrollText, permission: 'logs:view', color: '#8e8e93' },
  { name: 'Ränge', href: '/admin/ranks', icon: Shield, permission: 'ranks:manage', color: '#8e8e93' },
  { name: 'Ausbildungen', href: '/admin/trainings', icon: GraduationCap, permission: 'trainings:manage', color: '#8e8e93' },
  { name: 'Units verwalten', href: '/admin/units', icon: Briefcase, permission: 'units:manage', color: '#8e8e93' },
  { name: 'Benutzer', href: '/admin/users', icon: UserCog, permission: 'users:manage', color: '#8e8e93' },
  { name: 'Benutzergruppen', href: '/admin/user-groups', icon: Users, permission: 'groups:manage', color: '#8e8e93' },
  { name: 'API-Tokens', href: '/admin/api-tokens', icon: KeyRound, permission: 'groups:manage', color: '#8e8e93' },
  { name: 'Exporte', href: '/exports', icon: Download, permission: 'exports:view', color: '#8e8e93' },
  { name: 'Einstellungen', href: '/admin/settings', icon: Settings, permission: 'settings:manage', color: '#8e8e93' },
]

export const accountNav: NavItem[] = [
  { name: 'Mein Konto', href: '/account', icon: KeyRound, color: '#0a84ff' },
  { name: 'Build-Historie', href: '/releases', icon: History, color: '#636366' },
]

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function SavedSection({ name, compact, children }: { name: string; compact?: boolean; children: ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = usePersistentBoolean(`fib:nav:${user?.id ?? 'guest'}:${name}`, true)
  // In der Icon-Leiste gibt es nichts aufzuklappen – dort trennt nur eine Linie die Gruppen.
  if (compact) {
    return <section aria-label={name} className="mt-2 space-y-[2px] border-t border-[#3a3a3c] pt-2 first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </section>
  }
  return <section className="mt-3 first:mt-0">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
      className="flex w-full items-center justify-between rounded-[6px] px-2 pb-1 pt-2 text-[11.5px] font-semibold text-[#8e8e93] transition-colors hover:text-[#c7c7cc]">
      {name}
      <ChevronDown size={13} className={cn('transition-transform duration-200 motion-reduce:transition-none', !open && '-rotate-90')} />
    </button>
    {open && <div className="space-y-[2px]">{children}</div>}
  </section>
}

function NavLink({ item, pathname, onNavigate, compact, badge }: { item: NavItem; pathname: string; onNavigate: () => void; compact?: boolean; badge?: number }) {
  const active = isActivePath(pathname, item.href)
  const Icon = item.icon
  const badgeLabel = badge ? (badge > 99 ? '99+' : String(badge)) : null

  // macOS-Einstellungen: farbige, flache Icon-Kachel; die aktive Zeile in Systemblau.
  const tile = (
    <span
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-white"
      style={{ backgroundColor: item.color ?? '#8e8e93' }}
      aria-hidden
    >
      <Icon size={15} strokeWidth={2} />
    </span>
  )

  const link = (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? `${item.name}${badgeLabel ? ` (${badgeLabel} offen)` : ''}` : undefined}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center rounded-[8px] text-[13.5px] transition-colors duration-100',
        compact ? 'mx-auto h-10 w-10 justify-center' : 'gap-2.5 px-2 py-[5px]',
        active
          ? compact ? 'bg-[#3a3a3c]' : 'bg-[#0a84ff] text-white font-medium'
          : 'text-[#e5e5ea] hover:bg-[#2c2c2e]'
      )}
    >
      {tile}
      {!compact && <span className="truncate">{item.name}</span>}
      {badgeLabel && (compact ? (
        <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-[#ff453a] ring-2 ring-[#161617]" aria-hidden />
      ) : (
        <span className={cn(
          'ml-auto min-w-[20px] rounded-full px-1.5 py-px text-center text-[11px] font-semibold tabular-nums',
          active ? 'bg-white/25 text-white' : 'bg-[#ff453a] text-white',
        )}>
          {badgeLabel}
          <span className="sr-only"> offen</span>
        </span>
      ))}
    </Link>
  )
  if (!compact) return link
  return <Tooltip side="right" content={badgeLabel ? `${item.name} · ${badgeLabel} offen` : item.name}>{link}</Tooltip>
}

function NavContent({ pathname, onNavigate, user, logout, compact = false }: NavContentProps) {
  const { data: leadershipAccess } = useFetch<{ allowed: boolean }>(user ? '/api/leadership/groups/access' : null, 120_000)
  const { data: bodycamAccess } = useFetch<{ allowed: boolean }>(user && !hasPermission(user, 'investigations:view') ? '/api/investigations/clips/access' : null, 120_000)
  const { data: navigationUnits } = useFetch<NavigationUnit[]>(user ? '/api/navigation/units' : null, 120_000)
  const { data: navBadges } = useFetch<Record<string, number>>(user ? '/api/navigation/badges' : null, 60_000)
  const unitNav: NavItem[] = (navigationUnits ?? []).map((unit) => ({
    name: unit.name,
    href: unit.href,
    icon: unitIconComponent(unit.icon),
    color: unit.color,
  }))
  const showAdmin = hasAnyPermission(user, [
    'logs:view',
    'ranks:manage',
    'trainings:manage',
    'units:manage',
    'users:manage',
    'groups:manage',
    'exports:view',
    'settings:manage',
  ])

  return (
    <div className="flex flex-col h-full">
      {compact ? (
        <div className="flex shrink-0 justify-center py-3">
          <Image src="/shield.webp" alt="FIB" width={28} height={28} className="rounded-full" />
        </div>
      ) : (
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <Image src="/shield.webp" alt="FIB" width={40} height={40} className="rounded-full" priority />
          <div className="min-w-0">
            <span className="block text-[15px] font-semibold text-white leading-tight tracking-[-0.01em]">FIB</span>
            <span className="block text-[12px] text-[#8e8e93] mt-0.5">Department</span>
          </div>
        </div>
      </div>
      )}

      <nav aria-label="Hauptnavigation" className={cn('flex-1 overflow-y-auto pb-4', compact ? 'px-1.5' : 'px-2.5')}>
        {[
          { label: 'Arbeitsplatz', paths: ['/dashboard', '/duty-times', '/notes'] },
          { label: 'Personal', paths: ['/agents', '/codenames', '/promotions', '/terminations', '/vertraege'] },
          { label: 'Ermittlungen & Disziplin', paths: ['/investigations', '/sanktionen', '/corruption-checks', '/map'] },
          { label: 'Unterlagen', paths: ['/ordnungen', '/publications', '/uploads'] },
        ].map(group => {
          const items = mainNav.filter(item => group.paths.includes(item.href) && (!item.permission || hasPermission(user, item.permission)))
          return items.length > 0 && <SavedSection key={group.label} name={group.label} compact={compact}>
            {items.map(item => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} compact={compact} badge={navBadges?.[item.href]} />)}
          </SavedSection>
        })}
        {!hasPermission(user, 'investigations:view') && bodycamAccess?.allowed && <NavLink item={{ name: 'Bodycams', href: '/investigations/clips', icon: FolderSearch }} pathname={pathname} onNavigate={onNavigate} compact={compact} />}

        {unitNav.length > 0 && (
          <SavedSection name="Units" compact={compact}>
            {unitNav.map((item) => <NavLink key={`${item.href}:${item.name}`} item={item} pathname={pathname} onNavigate={onNavigate} compact={compact} />)}
          </SavedSection>
        )}

        {leadershipAccess?.allowed && (
          <SavedSection name="Leadership" compact={compact}>
            <NavLink item={{ name: 'Ermittlungsgruppen', href: '/leadership/groups', icon: Users }} pathname={pathname} onNavigate={onNavigate} compact={compact} />
          </SavedSection>
        )}

        {showAdmin && (
          <SavedSection name="Administration" compact={compact}>
            {adminNav
              .filter((item) => !item.permission || hasPermission(user, item.permission))
              .map((item) => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} compact={compact} />)}
          </SavedSection>
        )}

        <SavedSection name="Konto" compact={compact}>
          {accountNav.map((item) => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} compact={compact} />)}
        </SavedSection>
      </nav>

      <div className={cn('shrink-0 border-t border-[#3a3a3c] pt-2.5', compact ? 'px-1.5 pb-2' : 'px-2.5 pb-2.5')}>
        {user && compact && (
          <div className="flex flex-col items-center gap-1">
            {user.avatarUrl ? (
              <span
                className="h-7 w-7 rounded-full bg-cover bg-center ring-1 ring-[#d4d4d4]/25"
                style={{ backgroundImage: `url(${user.avatarUrl})` }}
                role="img"
                aria-label={user.displayName}
                title={user.displayName}
              />
            ) : (
              <div title={user.displayName} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#636366] text-[11px] font-semibold text-white">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <Tooltip side="right" content="Abmelden">
              <button
                type="button"
                onClick={logout}
                aria-label="Abmelden"
                className="flex h-8 w-8 items-center justify-center rounded-md text-[#8e8e93] transition-colors hover:bg-[#2c2c2e] hover:text-[#d4d4d4]"
              >
                <LogOut size={14} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
        )}
        {user && !compact && (
          <div className="group/user relative flex items-center gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[#2c2c2e]">
            {user.avatarUrl ? (
              <span
                className="h-7 w-7 shrink-0 rounded-full bg-cover bg-center shadow-[0_1px_3px_rgba(212,212,212,0.25)] ring-1 ring-[#d4d4d4]/25"
                style={{ backgroundImage: `url(${user.avatarUrl})` }}
                aria-hidden
              />
            ) : (
              <div className="h-7 w-7 shrink-0 rounded-full bg-[#636366] flex items-center justify-center text-[11px] font-semibold text-white">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-white/90 truncate leading-tight">{user.displayName}</p>
              <p className="text-[11px] text-[#8e8e93] truncate leading-tight mt-0.5">
                {user.groups?.[0]?.name ?? 'Mitglied'}
              </p>
            </div>
            <Tooltip content="Abmelden">
              <button
                type="button"
                onClick={logout}
                className="flex h-8 w-8 items-center justify-center rounded-md text-[#8e8e93] hover:text-[#d4d4d4] hover:bg-[#2c2c2e] transition-colors -mr-1"
                aria-label="Abmelden"
              >
                <LogOut size={14} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = usePersistentBoolean(`fib:sidebar:${user?.id ?? 'guest'}`, false)

  const closeMobile = () => setMobileOpen(false)

  // Mobiles Menü: Escape schließt, der Inhalt dahinter scrollt nicht mit.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen])

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-12 flex items-center justify-between px-3 border-b border-[#38383a] bg-[#161617]/85 backdrop-blur-xl">
        <button
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-[#d4d4d4] hover:bg-[#2c2c2e] transition-colors"
          aria-label="Menü öffnen"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Image src="/shield.webp" alt="FIB" width={22} height={22} className="rounded-full" priority />
          <span className="text-[13px] font-semibold text-white tracking-[-0.01em]">FIB</span>
        </div>
        <div className="w-9" aria-hidden />
      </div>

      <aside className={cn('hidden lg:flex lg:flex-col sidebar-gradient border-r border-[#38383a]/70 fixed left-0 top-0 bottom-0 z-30 transition-[width] duration-200 motion-reduce:transition-none', collapsed ? 'w-14' : 'w-[244px]')}>
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
          aria-label={collapsed ? 'Navigation ausklappen' : 'Navigation minimieren'}
          title={collapsed ? 'Navigation ausklappen' : 'Navigation minimieren'}
          className="flex h-11 shrink-0 items-center justify-center gap-2 border-b border-[#38383a] text-[#98989d] hover:bg-[#2c2c2e] hover:text-white focus-visible:outline focus-visible:outline-2">
          {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={16} /><span className="text-xs">Navigation minimieren</span></>}
        </button>
        <div className="min-h-0 flex-1"><NavContent pathname={pathname} onNavigate={closeMobile} user={user} logout={logout} compact={collapsed} /></div>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              aria-hidden
              className="lg:hidden fixed inset-0 bg-[#000000]/75 backdrop-blur-sm z-40"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-[264px] max-w-[85vw] sidebar-gradient border-r border-[#38383a]/70 z-50 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Menü schließen"
                className="absolute top-4 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-md text-[#8e8e93] transition-colors hover:bg-[#2c2c2e] hover:text-[#d4d4d4]"
              >
                <X size={18} />
              </button>
              <NavContent pathname={pathname} onNavigate={closeMobile} user={user} logout={logout} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className={cn("hidden lg:block lg:shrink-0 transition-[width] duration-200 motion-reduce:transition-none", collapsed ? "lg:w-14" : "lg:w-[244px]")} />
    </>
  )
}

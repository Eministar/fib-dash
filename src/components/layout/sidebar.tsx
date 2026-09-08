'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Users, ArrowUpDown, UserX, StickyNote, ScrollText, ChartNoAxesCombined,
  Shield, GraduationCap, UserCog, Settings, LogOut, Briefcase,
  Menu, X, KeyRound, Timer, Upload, CalendarDays, Download,
  FileText, Gavel, FolderSearch, Map,
  History,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { hasAnyPermission, hasPermission, type Permission } from '@/lib/permissions'
import Image from 'next/image'
import { useFetch } from '@/hooks/use-fetch'
import { unitIconComponent } from '@/components/units/unit-icon'
import type { NavigationUnit } from '@/lib/unit-navigation'

interface NavItem {
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
}

const mainNav: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, permission: 'dashboard:view' },
  { name: 'Statistiken', href: '/statistics', icon: ChartNoAxesCombined, permission: 'dashboard:view' },
  { name: 'Ordnungen', href: '/ordnungen', icon: FileText },
  { name: 'Kalender', href: '/calendar', icon: CalendarDays, permission: 'calendar:view' },
  { name: 'Dienstzeiten', href: '/duty-times', icon: Timer, permission: 'duty-times:view' },
  { name: 'Agents', href: '/agents', icon: Users, permission: 'agents:view' },
  { name: 'Decknamen', href: '/codenames', icon: KeyRound, permission: 'codenames:view' },
  { name: 'Up-/D-Rank-Listen', href: '/promotions', icon: ArrowUpDown, permission: 'rank-changes:view' },
  { name: 'Kündigungen', href: '/terminations', icon: UserX, permission: 'terminations:view' },
  // Ohne `permission`: Sanktionen sind für jeden eingeloggten Agent einsehbar.
  { name: 'Sanktionen', href: '/sanktionen', icon: Gavel },
  { name: 'Korruptionskontrollen', href: '/corruption-checks', icon: Shield },
  { name: 'Ermittlungen', href: '/investigations', icon: FolderSearch, permission: 'investigations:view' },
  { name: 'Karte', href: '/map', icon: Map, permission: 'map:view' },
  { name: 'Notizen', href: '/notes', icon: StickyNote, permission: 'notes:view' },
  { name: 'Protokoll', href: '/logs', icon: ScrollText, permission: 'logs:view' },
]

const adminNav: NavItem[] = [
  { name: 'Ränge', href: '/admin/ranks', icon: Shield, permission: 'ranks:manage' },
  { name: 'Ausbildungen', href: '/admin/trainings', icon: GraduationCap, permission: 'trainings:manage' },
  { name: 'Units verwalten', href: '/admin/units', icon: Briefcase, permission: 'units:manage' },
  { name: 'Benutzer', href: '/admin/users', icon: UserCog, permission: 'users:manage' },
  { name: 'Benutzergruppen', href: '/admin/user-groups', icon: Users, permission: 'groups:manage' },
  { name: 'API-Tokens', href: '/admin/api-tokens', icon: KeyRound, permission: 'groups:manage' },
  { name: 'Exporte', href: '/exports', icon: Download, permission: 'exports:view' },
  { name: 'Uploads', href: '/admin/uploads', icon: Upload, permission: 'settings:manage' },
  { name: 'Einstellungen', href: '/admin/settings', icon: Settings, permission: 'settings:manage' },
]

const accountNav: NavItem[] = [
  { name: 'Mein Konto', href: '/account', icon: KeyRound },
  { name: 'Build-Historie', href: '/releases', icon: History },
]

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 mb-1.5 mt-1 text-[9.5px] font-bold text-[#808080] uppercase tracking-[0.16em] flex items-center gap-1.5">
      <span className="h-px flex-1 bg-gradient-to-r from-[#343434]/60 to-transparent" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-gradient-to-l from-[#343434]/60 to-transparent" />
    </p>
  )
}

function SectionDivider() {
  return <div className="my-3 mx-3 h-px bg-gradient-to-r from-transparent via-[#d4d4d4]/10 to-transparent" />
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = isActivePath(pathname, item.href)
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-[9px] rounded-lg text-[13.5px] transition-all duration-200 overflow-hidden',
        active
          ? 'bg-gradient-to-r from-[#d4d4d4] to-[#a4a4a4] text-[#181818] font-semibold shadow-[0_2px_8px_rgba(212,212,212,0.25)]'
          : 'text-[#a6a6a6] hover:bg-[#212121] hover:text-[#f4f4f4] hover:translate-x-0.5'
      )}
    >
      {!active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-0 rounded-r-full bg-[#d4d4d4] transition-all duration-300 group-hover:h-[14px]" />
      )}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[20px] rounded-r-full bg-[#cfcfcf] shadow-[0_0_8px_rgba(207,207,207,0.6)]" />
      )}
      <Icon
        size={18}
        strokeWidth={active ? 2.25 : 1.75}
        style={!active && item.color ? { color: item.color } : undefined}
        className={cn('shrink-0 transition-transform duration-200', !active && 'group-hover:scale-110')}
      />
      <span className="truncate">{item.name}</span>
      {active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#181818]/40" />
      )}
    </Link>
  )
}

function NavContent({ pathname, onNavigate, user, logout }: NavContentProps) {
  const { data: bodycamAccess } = useFetch<{ allowed: boolean }>(user ? '/api/investigations/clips/access' : null)
  const { data: navigationUnits } = useFetch<NavigationUnit[]>(user ? '/api/navigation/units' : null)
  const unitNav: NavItem[] = (navigationUnits ?? []).map((unit) => ({
    name: unit.name,
    href: unit.href,
    icon: unitIconComponent(unit.icon),
    color: unit.color,
  }))
  const showAdmin = hasAnyPermission(user, [
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
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative h-[52px] w-[52px] rounded-[13px] bg-gradient-to-br from-[#1e1e1e] to-[#161616] border border-[#d4d4d4]/30 flex items-center justify-center overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(212,212,212,0.08)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(212,212,212,0.12),transparent_70%)]" />
            <Image src="/shield.webp" alt="FIB" width={46} height={46} className="rounded-full relative" priority />
          </div>
          <div className="min-w-0">
            <span className="block text-[15px] font-semibold text-white leading-tight tracking-[-0.01em]">FIB</span>
            <span className="block text-[10.5px] font-semibold text-[#d4d4d4]/80 tracking-[0.14em] uppercase mt-0.5">Department</span>
          </div>
        </div>
        <div className="relative mt-4 h-px bg-gradient-to-r from-transparent via-[#d4d4d4]/25 to-transparent">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-[#d4d4d4] shadow-[0_0_6px_rgba(212,212,212,0.6)]" />
        </div>
      </div>

      <nav className="flex-1 space-y-[2px] overflow-y-auto px-2.5 lg:pb-12">
        <SectionLabel>Navigation</SectionLabel>
          {mainNav
          .filter((item) => !item.permission || hasPermission(user, item.permission))
            .map((item) => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
          {bodycamAccess?.allowed && <NavLink item={{ name: 'Bodycam-Katalog', href: '/investigations/clips', icon: FolderSearch }} pathname={pathname} onNavigate={onNavigate} />}

        {unitNav.length > 0 && (
          <>
            <SectionDivider />
            <SectionLabel>Units</SectionLabel>
            {unitNav.map((item) => <NavLink key={`${item.href}:${item.name}`} item={item} pathname={pathname} onNavigate={onNavigate} />)}
          </>
        )}

        {showAdmin && (
          <>
            <SectionDivider />
            <SectionLabel>Administration</SectionLabel>
            {adminNav
              .filter((item) => !item.permission || hasPermission(user, item.permission))
              .map((item) => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
          </>
        )}

        <SectionDivider />
        <SectionLabel>Konto</SectionLabel>
        {accountNav.map((item) => <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
      </nav>

      <div className="px-2.5 pb-2.5 shrink-0">
        {user && (
          <div className="group/user relative flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#1c1c1c]/50 border border-white/[0.04] hover:border-[#d4d4d4]/20 transition-colors">
            {user.avatarUrl ? (
              <span
                className="h-7 w-7 shrink-0 rounded-full bg-cover bg-center shadow-[0_1px_3px_rgba(212,212,212,0.25)] ring-1 ring-[#d4d4d4]/25"
                style={{ backgroundImage: `url(${user.avatarUrl})` }}
                aria-label={user.displayName}
              />
            ) : (
              <div className="h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-[#d4d4d4] to-[#989898] flex items-center justify-center text-[10px] font-bold text-[#181818] shadow-[0_1px_3px_rgba(212,212,212,0.25)]">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11.5px] font-medium text-white/90 truncate leading-tight">{user.displayName}</p>
              <p className="text-[9.5px] text-[#808080] truncate leading-tight mt-0.5">
                {user.groups?.[0]?.name ?? 'Mitglied'}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="p-1.5 rounded-md text-[#909090] hover:text-[#d4d4d4] hover:bg-[#212121] transition-all -mr-0.5"
              title="Abmelden"
            >
              <LogOut size={13} strokeWidth={1.75} />
            </button>
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

  const closeMobile = () => setMobileOpen(false)

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-12 flex items-center justify-between px-3 sidebar-gradient border-b border-[#d4d4d4]/15 backdrop-blur-md">
        <button
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-[#d4d4d4] hover:bg-[#212121] transition-colors"
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

      <aside className="hidden lg:flex lg:flex-col lg:w-[244px] lg:min-h-screen sidebar-gradient border-r border-[#d4d4d4]/10 fixed left-0 top-0 bottom-0 z-30">
        <NavContent pathname={pathname} onNavigate={closeMobile} user={user} logout={logout} />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-[#080808]/75 backdrop-blur-sm z-40"
            />
            <motion.aside
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-[244px] sidebar-gradient border-r border-[#d4d4d4]/10 z-50 shadow-2xl"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-3 p-1.5 rounded-md text-[#909090] hover:text-[#d4d4d4]"
              >
                <X size={16} />
              </button>
              <NavContent pathname={pathname} onNavigate={closeMobile} user={user} logout={logout} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="hidden lg:block lg:w-[244px] lg:shrink-0" />
    </>
  )
}

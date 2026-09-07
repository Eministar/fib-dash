import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleDateString('de-DE', { 
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export function formatRelativeTime(date: Date | string | null | undefined, now: Date = new Date()): string {
  if (!date) return '—'
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  if (!Number.isFinite(diffMs)) return '—'
  if (diffMs < 0) return 'gerade eben'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 45) return 'gerade eben'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `vor ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `vor ${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  if (days < 7) return `vor ${days}d`
  return formatDate(d)
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Aktiv',
    AWAY: 'Abgemeldet',
    INACTIVE: 'Inaktiv',
    TERMINATED: 'Gekündigt',
  }
  return labels[status] || status
}

export function getStatusDot(status: string): string {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-[#34d399]',
    AWAY: 'bg-[#38bdf8]',
    INACTIVE: 'bg-[#aaa]',
    TERMINATED: 'bg-[#f87171]',
  }
  return colors[status] || 'bg-[#aaa]'
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    ACTIVE: 'text-[#111] dark:text-[#eee]',
    AWAY: 'text-[#888]',
    INACTIVE: 'text-[#aaa]',
    TERMINATED: 'text-[#aaa]',
  }
  return colors[status] || 'text-[#888]'
}

export function getUnitLabel(unit: string | null | undefined): string {
  if (!unit) return '—'
  const labels: Record<string, string> = {
    HR_LEITUNG: 'HR Leitung',
    HR_TRAINEE: 'HR Trainee',
    HR_OFFICER: 'HR Officer',
    ACADEMY: 'Academy',
    SRU: 'S.R.U.',
    AIR_SUPPORT: 'Air-Support Division',
  }
  return labels[unit] || unit
}

export function getUnitBadgeClass(unit: string | null | undefined): string {
  const map: Record<string, string> = {
    HR_LEITUNG: 'bg-[#3a1f4d] text-[#e0c8ff] border-[#7c3aed]/40',
    HR_TRAINEE: 'bg-[#2d2d2d] text-[#cecece] border-[#3b82f6]/40',
    HR_OFFICER: 'bg-[#303030] text-[#9eddee] border-[#06b6d4]/40',
    ACADEMY: 'bg-[#3a2f17] text-[#f3d8a3] border-[#d4d4d4]/40',
    SRU: 'bg-[#3a1818] text-[#f1b6b6] border-[#dc2626]/40',
    AIR_SUPPORT: 'bg-[#292929] text-[#dedede] border-[#38bdf8]/40',
  }
  if (!unit) return 'bg-transparent text-[#808080] border-transparent'
  return map[unit] || 'bg-[#212121] text-[#c3c3c3] border-[#343434]/60'
}

/**
 * Markierungen / Flags für Agents (rot/orange/gelb). Gibt einen Tooltip-Label,
 * eine Punkt-Farbe und eine vollständige Zeilen-Hervorhebung (links 3px Balken,
 * leichter Hintergrundfarb-Tönung) zurück.
 */
export function getFlagLabel(flag: string | null | undefined): string {
  if (!flag) return 'Keine Markierung'
  const labels: Record<string, string> = {
    RED: 'Rot',
    ORANGE: 'Orange',
    YELLOW: 'Gelb',
    BLUE: 'Blau',
  }
  return labels[flag] || flag
}

export function getFlagColor(flag: string | null | undefined): string {
  if (!flag) return 'transparent'
  const colors: Record<string, string> = {
    RED: '#ef4444',
    ORANGE: '#f97316',
    YELLOW: '#facc15',
    BLUE: '#38bdf8',
  }
  return colors[flag] || 'transparent'
}

export function getFlagDotClass(flag: string | null | undefined): string {
  const map: Record<string, string> = {
    RED: 'bg-[#ef4444]',
    ORANGE: 'bg-[#f97316]',
    YELLOW: 'bg-[#facc15]',
    BLUE: 'bg-[#38bdf8]',
  }
  if (!flag) return 'bg-transparent'
  return map[flag] || 'bg-transparent'
}

export function getFlagRowClass(flag: string | null | undefined): string {
  const map: Record<string, string> = {
    RED: 'bg-[rgba(239,68,68,0.07)] hover:bg-[rgba(239,68,68,0.12)]',
    ORANGE: 'bg-[rgba(249,115,22,0.07)] hover:bg-[rgba(249,115,22,0.12)]',
    YELLOW: 'bg-[rgba(250,204,21,0.07)] hover:bg-[rgba(250,204,21,0.12)]',
    BLUE: 'bg-[rgba(56,189,248,0.07)] hover:bg-[rgba(56,189,248,0.12)]',
  }
  if (!flag) return ''
  return map[flag] || ''
}

/**
 * Stabile, numerische Sortierung von Dienstnummern. Nicht-numerische Bestandteile
 * (z. B. ein Präfix wie "FIB-") werden nach hinten gestellt; bei gleicher Zahl wird
 * lexikographisch verglichen, damit Reihenfolge deterministisch bleibt.
 */
export function compareBadgeNumbers(a: string, b: string): number {
  const na = parseInt((a.match(/\d+/)?.[0] ?? ''), 10)
  const nb = parseInt((b.match(/\d+/)?.[0] ?? ''), 10)
  const aHas = Number.isFinite(na)
  const bHas = Number.isFinite(nb)
  if (aHas && bHas && na !== nb) return na - nb
  if (aHas && !bHas) return -1
  if (!aHas && bHas) return 1
  return a.localeCompare(b, 'de')
}

import {
  ScrollText, FileText, BookOpen, Scale, Briefcase, Library, Shield, Gavel,
  ClipboardList, Users, Siren, Plane, Search, TriangleAlert, Landmark, FileCheck,
  type LucideIcon,
} from 'lucide-react'

/** Kuratierte Icon-Auswahl für Ordnungen & Kategorien. Nur diese Namen sind gültig. */
export const ORDNUNG_ICONS: Record<string, LucideIcon> = {
  ScrollText, FileText, BookOpen, Scale, Briefcase, Library, Shield, Gavel,
  ClipboardList, Users, Siren, Plane, Search, TriangleAlert, Landmark, FileCheck,
}

export const ORDNUNG_ICON_NAMES = Object.keys(ORDNUNG_ICONS)

export function ordnungIcon(name: string): LucideIcon {
  return ORDNUNG_ICONS[name] ?? FileText
}

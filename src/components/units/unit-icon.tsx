import {
  Badge,
  Briefcase,
  Building2,
  Car,
  FileText,
  Fingerprint,
  GraduationCap,
  HeartPulse,
  ListChecks,
  Newspaper,
  Plane,
  Radio,
  Scale,
  Search,
  Shield,
  Siren,
  Star,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { createElement } from 'react'

import { sanitizeUnitIcon, type UnitIconKey } from '@/lib/unit-modules'

const ICONS: Record<UnitIconKey, LucideIcon> = {
  briefcase: Briefcase,
  'list-checks': ListChecks,
  newspaper: Newspaper,
  shield: Shield,
  plane: Plane,
  fingerprint: Fingerprint,
  'graduation-cap': GraduationCap,
  radio: Radio,
  scale: Scale,
  search: Search,
  'heart-pulse': HeartPulse,
  wrench: Wrench,
  car: Car,
  siren: Siren,
  building: Building2,
  users: Users,
  badge: Badge,
  star: Star,
  target: Target,
  'file-text': FileText,
}

export function unitIconComponent(icon: unknown) {
  return ICONS[sanitizeUnitIcon(icon)]
}

export function UnitIcon({ icon, ...props }: { icon: unknown } & React.ComponentProps<LucideIcon>) {
  return createElement(ICONS[sanitizeUnitIcon(icon)], props)
}

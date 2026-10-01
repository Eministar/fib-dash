/**
 * Aktionen der Befehlspalette (Strg+K). Reine Daten, damit Rechteprüfung und
 * Trefferlogik ohne React testbar sind.
 */
import { hasPermission, type Permission } from '@/lib/permissions'

export type PaletteActionIcon = 'investigation' | 'person' | 'vehicle' | 'sanction' | 'absence' | 'agent' | 'timeline'

export interface PaletteTarget {
  path: string
  action?: string
}

/** Öffnet auf einer Seite einen Dialog – siehe `usePageAction`. */
export interface PageActionDef {
  id: string
  title: string
  /** Zusätzliche Suchwörter, damit „anlegen“, „neu“, „erstellen“ alle treffen. */
  keywords: string[]
  icon: PaletteActionIcon
  permission: Permission
  path: string
  action: string
}

/** Wirkt auf einen Agent – erst Aktion wählen, dann den Agent. */
export interface AgentActionDef {
  id: 'sanction' | 'absence' | 'timeline'
  title: string
  /** „Sanktion für Max Mustermann“ */
  forAgent: (name: string) => string
  keywords: string[]
  icon: PaletteActionIcon
  permission: Permission
  /** Zielseite; mit `action` öffnet sie dort direkt den passenden Dialog. */
  target: (agentId: string) => PaletteTarget
}

export const PAGE_ACTIONS: PageActionDef[] = [
  {
    id: 'new-investigation',
    title: 'Ermittlung anlegen',
    keywords: ['neue akte', 'einsatzakte', 'erstellen', 'neu'],
    icon: 'investigation',
    permission: 'investigations:manage',
    path: '/investigations',
    action: 'new',
  },
  {
    id: 'new-person',
    title: 'Person anlegen',
    keywords: ['personenakte', 'neue person', 'erfassen', 'neu'],
    icon: 'person',
    permission: 'investigations:manage',
    path: '/investigations/persons',
    action: 'new',
  },
  {
    id: 'new-vehicle',
    title: 'Fahrzeug anlegen',
    keywords: ['fahrzeugakte', 'kennzeichen', 'neues fahrzeug', 'erfassen', 'neu'],
    icon: 'vehicle',
    permission: 'investigations:manage',
    path: '/investigations/vehicles',
    action: 'new',
  },
  {
    id: 'own-absence',
    title: 'Abmeldung eintragen',
    keywords: ['abwesenheit', 'urlaub', 'abmelden'],
    icon: 'absence',
    permission: 'dashboard:view',
    path: '/dashboard',
    action: 'absence',
  },
]

export const AGENT_ACTIONS: AgentActionDef[] = [
  {
    id: 'sanction',
    title: 'Sanktion ausstellen …',
    forAgent: (name) => `Sanktion für ${name}`,
    keywords: ['neue sanktion', 'strafe', 'verwarnung', 'erstellen'],
    icon: 'sanction',
    permission: 'sanctions:manage',
    target: (agentId) => ({ path: `/agents/${agentId}`, action: 'sanction' }),
  },
  {
    id: 'absence',
    title: 'Abmeldung für Agent eintragen …',
    forAgent: (name) => `Abmeldung für ${name}`,
    keywords: ['abwesenheit', 'urlaub'],
    icon: 'absence',
    permission: 'agents:write',
    target: (agentId) => ({ path: `/agents/${agentId}`, action: 'absence' }),
  },
  {
    id: 'timeline',
    title: 'Personalakte öffnen …',
    forAgent: (name) => `Personalakte von ${name}`,
    keywords: ['zeitstrahl', 'verlauf', 'akte'],
    icon: 'timeline',
    permission: 'agents:view',
    target: (agentId) => ({ path: `/agents/${agentId}/timeline` }),
  },
]

type UserLike = { permissions?: string[] | null } | null | undefined

export function allowedPageActions(user: UserLike) {
  return PAGE_ACTIONS.filter((action) => hasPermission(user, action.permission))
}

export function allowedAgentActions(user: UserLike) {
  return AGENT_ACTIONS.filter((action) => hasPermission(user, action.permission))
}

/**
 * Kontextaktionen zu einem Agent-Treffer. Nur für den ersten Treffer, damit
 * die Liste bei breiten Suchen nicht explodiert.
 */
export function agentHitActions(user: UserLike, agentId: string, agentName: string) {
  return allowedAgentActions(user).map((action) => ({
    id: `${action.id}:${agentId}`,
    title: action.forAgent(agentName),
    icon: action.icon,
    target: action.target(agentId),
  }))
}

/**
 * Nachrichten für das Ermittlungs-Forum auf Discord: Aktenkarte, Familienakte,
 * angepinnte Übersicht und kurze Verlaufsmeldungen. Reine Logik ohne
 * Datenbank und Netzwerk, damit Aufbau und Längen testbar sind.
 */
import { actionRow, componentMessage, iconLine, linkButton, markdownRows, markdownSubheading, mediaGallery, separator, textDisplay } from '@/lib/discord/discord-components'
import { INVESTIGATION_PRIORITY_LABELS, INVESTIGATION_STATUS_LABELS } from '@/lib/investigations/investigations'

export type InvestigationStatusKey = keyof typeof INVESTIGATION_STATUS_LABELS
export type InvestigationPriorityKey = keyof typeof INVESTIGATION_PRIORITY_LABELS

/** Farbstreifen der Aktenkarte je Status. */
export const STATUS_ACCENT: Record<InvestigationStatusKey, number> = {
  OPEN: 0x0a84ff,
  ACTIVE: 0x30d158,
  SUSPENDED: 0xff9f0a,
  CLOSED: 0x8e8e93,
  ARCHIVED: 0x48484a,
}
const STATUS_ICON: Record<InvestigationStatusKey, string> = {
  OPEN: '🔵',
  ACTIVE: '🟢',
  SUSPENDED: '🟠',
  CLOSED: '⚪',
  ARCHIVED: '⚫',
}
const PRIORITY_ICON: Record<InvestigationPriorityKey, string> = { LOW: '▫️', NORMAL: '▪️', HIGH: '🔸', CRITICAL: '🔺' }
export const DOSSIER_ACCENT = 0xa78bfa
export const OVERVIEW_ACCENT = 0xd4af37

/** Discord erlaubt 100 Zeichen für Beitragstitel. */
export function forumThreadName(code: string, title: string) {
  const name = `${code} · ${title}`.replace(/\s+/g, ' ').trim()
  return name.length <= 100 ? name : `${name.slice(0, 99)}…`
}

function clip(text: string, max: number) {
  const clean = text.trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

function quote(text: string) {
  return text.split('\n').map((line) => `> ${line}`).join('\n')
}

const unix = (date: Date) => Math.floor(date.getTime() / 1000)

export type InvestigationCardData = {
  caseNumber: string
  title: string
  summary: string | null
  status: InvestigationStatusKey
  priority: InvestigationPriorityKey
  leadAgentName: string | null
  assigneeCount: number
  entryCount: number
  clipCount: number
  createdAt: Date
  updatedAt: Date
  url?: string
}

/** Startnachricht eines Akten-Beitrags; wird bei jeder Änderung neu geschrieben. */
export function investigationCard(data: InvestigationCardData) {
  const facts = [
    `${iconLine(STATUS_ICON[data.status], `**${INVESTIGATION_STATUS_LABELS[data.status]}**`)}　${iconLine(PRIORITY_ICON[data.priority], `Priorität ${INVESTIGATION_PRIORITY_LABELS[data.priority]}`)}`,
    iconLine('🕵️', `**Fallführung** ${data.leadAgentName ?? '_nicht zugewiesen_'}`),
    `${iconLine('👥', `${data.assigneeCount} Ermittler`)}　${iconLine('📝', `${data.entryCount} Einträge`)}　${iconLine('🎥', `${data.clipCount} Clips`)}`,
  ].join('\n')

  return componentMessage([
    textDisplay(`# ${data.title}\n-# 🗂️ Einsatzakte \`${data.caseNumber}\` · angelegt <t:${unix(data.createdAt)}:D>`),
    separator(),
    textDisplay(facts),
    ...(data.summary?.trim() ? [separator(), textDisplay(quote(clip(data.summary, 700)))] : []),
    textDisplay(`-# Zuletzt geändert <t:${unix(data.updatedAt)}:R> · Verlauf steht unten im Beitrag`),
    ...(data.url ? [actionRow([linkButton('Akte im Dashboard öffnen', data.url)])] : []),
  ], { accentColor: STATUS_ACCENT[data.status] })
}

export type ForumCaseLink = {
  caseNumber: string
  title: string
  status: InvestigationStatusKey
  threadId: string | null
}

/** So viele Akten passen sicher in eine Nachricht; der Rest wird gezählt. */
export const DOSSIER_LINK_LIMIT = 40

function caseLine(item: ForumCaseLink) {
  const label = item.threadId ? `<#${item.threadId}>` : `\`${item.caseNumber}\` ${clip(item.title, 60)}`
  return iconLine(STATUS_ICON[item.status], label)
}

export type DossierCardData = {
  title: string
  leader: string | null
  description: string | null
  address: string | null
  personCount: number
  vehicleCount: number
  cases: ForumCaseLink[]
  url?: string
}

function caseSection(icon: string, heading: string, cases: ForumCaseLink[]) {
  if (cases.length === 0) return null
  return `${iconLine(icon, `**${heading}**`)}\n${cases.map(caseLine).join('\n')}`
}

/** Startnachricht einer Familienakte mit den Links zu allen Ermittlungs-Beiträgen. */
export function dossierCard(data: DossierCardData) {
  const shown = data.cases.slice(0, DOSSIER_LINK_LIMIT)
  const running = shown.filter((item) => item.status === 'OPEN' || item.status === 'ACTIVE' || item.status === 'SUSPENDED')
  const done = shown.filter((item) => !running.includes(item))
  const hidden = data.cases.length - shown.length
  const facts = [
    data.leader ? iconLine('👑', `**Fraktionsleiter:** ${data.leader}`) : null,
    data.address ? iconLine('📍', `Anwesen: ${data.address}`) : null,
    `${iconLine('🗂️', `${data.cases.length} Einsatzakten`)}　${iconLine('👤', `${data.personCount} Personen`)}　${iconLine('🚗', `${data.vehicleCount} Fahrzeuge`)}`,
  ].filter(Boolean).join('\n')

  const links = [caseSection('🔎', 'Laufende Ermittlungen', running), caseSection('📕', 'Abgeschlossen', done)].filter(Boolean).join('\n\n')

  return componentMessage([
    textDisplay(`# ${data.title}\n-# 📚 Familienakte`),
    separator(),
    textDisplay(facts),
    ...(data.description?.trim() ? [textDisplay(quote(clip(data.description, 500)))] : []),
    separator(),
    textDisplay(links || '_Noch keine Einsatzakten verknüpft._'),
    ...(hidden > 0 ? [textDisplay(`-# … und ${hidden} weitere im Dashboard`)] : []),
    ...(data.url ? [actionRow([linkButton('Familienakte im Dashboard öffnen', data.url)])] : []),
  ], { accentColor: DOSSIER_ACCENT })
}

export type OverviewDossier = { title: string; threadId: string | null; caseCount: number }

export const OVERVIEW_LIMIT = 60

/** Angepinnter Beitrag: alle Familienakten auf einen Blick. */
export function dossierOverview(dossiers: OverviewDossier[]) {
  const shown = dossiers.slice(0, OVERVIEW_LIMIT)
  const lines = shown.map((item) => iconLine('📁', `${item.threadId ? `<#${item.threadId}>` : item.title} · ${item.caseCount} Akten`))

  return componentMessage([
    textDisplay('# 📚 Familienregister\n-# Alle Familien und Fraktionen – jede mit Links zu ihren Ermittlungen.'),
    separator(),
    textDisplay(lines.join('\n') || '_Noch keine Familienakten angelegt._'),
    ...(dossiers.length > shown.length ? [textDisplay(`-# … und ${dossiers.length - shown.length} weitere im Dashboard`)] : []),
  ], { accentColor: OVERVIEW_ACCENT })
}

export type ForumEventType = 'status' | 'clip' | 'closed' | 'assignee' | 'handover' | 'entry' | 'photos'

const EVENT_TITLE: Record<ForumEventType, [icon: string, title: string]> = {
  status: ['🔄', 'Status geändert'],
  clip: ['🎥', 'Neuer Bodycam-Clip'],
  closed: ['📕', 'Ermittlung abgeschlossen'],
  assignee: ['👤', 'Ermittler zugewiesen'],
  handover: ['🤝', 'Fallführung übergeben'],
  entry: ['📝', 'Neuer Eintrag'],
  photos: ['🖼️', 'Neue Bilder'],
}

/** Kurze Verlaufsmeldung im Beitrag einer Akte. */
export function forumEventMessage(input: {
  type: ForumEventType
  rows?: Array<{ label: string; value: string | null | undefined }>
  note?: string | null
  actorName?: string | null
  at?: Date
  /** Zeitpunkt als Datum statt „vor x Minuten“ – für Chronologie-Einträge. */
  dated?: boolean
  /** Dateinamen der mitgeschickten Anhänge; erscheinen eingebettet unter dem Text. */
  media?: string[]
}) {
  const rows = markdownRows(input.rows ?? [])
  const time = `<t:${unix(input.at ?? new Date())}:${input.dated ? 'f' : 'R'}>`
  const body = [
    markdownSubheading(...EVENT_TITLE[input.type]),
    rows || null,
    input.note?.trim() ? quote(clip(input.note, 1200)) : null,
    `-# ${[input.actorName, time].filter(Boolean).join(' · ')}`,
  ].filter(Boolean).join('\n')
  return componentMessage([
    textDisplay(body),
    ...(input.media?.length ? [mediaGallery(input.media.map((name) => `attachment://${name}`))] : []),
  ])
}

export type ForumEntryData = {
  kindLabel: string
  title: string
  location: string | null
  content: string | null
  authorName: string | null
  occurredAt: Date
}

/** Chronologie-Eintrag im Akten-Beitrag. Dieselbe Darstellung beim Anlegen und beim Bearbeiten. */
export function forumEntryMessage(entry: ForumEntryData, media?: string[]) {
  return forumEventMessage({
    type: 'entry',
    rows: [{ label: entry.kindLabel, value: entry.title }, { label: 'Ort', value: entry.location }],
    note: entry.content,
    actorName: entry.authorName,
    at: entry.occurredAt,
    dated: true,
    media,
  })
}

export type OverviewCase = ForumCaseLink & { family: string | null }

/** So viele laufende Akten stehen höchstens in der Übersicht; der Rest wird gezählt. */
export const OVERVIEW_CASE_LIMIT = 60

function overviewLine(item: OverviewCase) {
  return `${caseLine(item)}${item.family ? ` · ${clip(item.family, 40)}` : ''}`
}

/** Zweite Nachricht im Übersichts-Beitrag: alle laufenden Einsatzakten nach Status. */
export function caseOverview(cases: OverviewCase[]) {
  const order = ['ACTIVE', 'OPEN', 'SUSPENDED'] as const
  const sorted = order.flatMap((status) => cases.filter((item) => item.status === status))
  // Discord erlaubt 4000 Zeichen Text pro Nachricht; Kopf und Fuß brauchen ihren Teil.
  const budget = 3300
  const shown: OverviewCase[] = []
  let used = 0
  for (const item of sorted.slice(0, OVERVIEW_CASE_LIMIT)) {
    const length = overviewLine(item).length + 1
    if (used + length > budget) break
    shown.push(item)
    used += length
  }
  const sections = order
    .map((status) => {
      const items = shown.filter((item) => item.status === status)
      if (!items.length) return null
      return `**${INVESTIGATION_STATUS_LABELS[status]}**\n${items.map(overviewLine).join('\n')}`
    })
    .filter(Boolean)

  return componentMessage([
    textDisplay(`# 🗂️ Laufende Einsatzakten\n-# ${cases.length} ${cases.length === 1 ? 'Akte' : 'Akten'} · nach Status, mit zugehöriger Familie`),
    separator(),
    textDisplay(sections.join('\n\n') || '_Derzeit laufen keine Ermittlungen._'),
    ...(cases.length > shown.length ? [textDisplay(`-# … und ${cases.length - shown.length} weitere im Dashboard`)] : []),
  ], { accentColor: OVERVIEW_ACCENT })
}

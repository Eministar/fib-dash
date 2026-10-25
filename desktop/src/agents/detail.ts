import { api } from '../api'
import { backend } from '../backend'
import { $, errorText, escapeHtml } from '../dom'
import { formatAgo, formatDateTime } from '../format'
import { icon, type IconName } from '../icons'
import { can } from '../store'
import { confirmAction, openForm, type Field } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import { invalidateList, listLookups, pill, unitChips } from './list'
import { openSanctionDialog } from './sanction-dialog'
import {
  agentName,
  avatar,
  badgeNumber,
  durationLabel,
  FLAG,
  FLAG_COLOR,
  SANCTION_STATUS,
  SANCTION_TONE,
  STATUS,
  STATUS_TONE,
  CONTRACT_STATUS,
  type Achievement,
  type AgentDetail,
  type CodenameHistory,
  type OpenTask,
  type Licenses,
  type LicenseRow,
  type Rank,
  type Records,
  type TimelineEntry,
  type Unit,
} from './model'

// Agent-Akte wie im Dashboard: Kopf mit Befehlen, darunter die Bereiche als Reiter.

type Tab = 'profile' | 'activity' | 'career' | 'licenses' | 'records' | 'management' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Profil' },
  { id: 'activity', label: 'Dienst & Abwesenheit' },
  { id: 'career', label: 'Ausbildung & Laufbahn' },
  { id: 'licenses', label: 'Lizenzen' },
  { id: 'records', label: 'Dokumente & Notizen' },
  { id: 'management', label: 'Verwaltung' },
  { id: 'history', label: 'Verlauf' },
]

let agent: AgentDetail | null = null
let tab: Tab = 'profile'
/** Zusatzdaten der Reiter – erst geladen, wenn der Reiter geöffnet wird. */
let records: Records | null = null
let licenses: Licenses | null = null
let timeline: TimelineEntry[] | null = null
let profileExtras: { tasks: OpenTask[]; achievements: Achievement[]; codenames: CodenameHistory | null } | null = null
let onBack: () => void = () => {}
const base = () => `/api/agents/${agent!.id}`
const terminated = () => agent?.status === 'TERMINATED'

// ── Bausteine ────────────────────────────────────────────────────────

function actionButton(action: string, iconName: IconName, label: string, id = '') {
  return `<fluent-button appearance="subtle" size="small" icon-only title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" data-action="${action}" data-id="${escapeHtml(id)}">${icon(iconName)}</fluent-button>`
}

function textButton(action: string, label: string, id = '') {
  return `<fluent-button appearance="subtle" size="small" data-action="${action}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</fluent-button>`
}

function commandButton(action: string, iconName: IconName, label: string) {
  return `<fluent-button appearance="subtle" data-action="${action}">${icon(iconName).replace('<i ', '<i slot="start" ')}${escapeHtml(label)}</fluent-button>`
}

function sectionHeader(title: string, buttons = '') {
  return `<div class="section-header"><h2 class="type-body-strong">${escapeHtml(title)}</h2><span class="spacer"></span>${buttons}</div>`
}

function empty(text: string) {
  return `<div class="empty small">${escapeHtml(text)}</div>`
}

function prop(label: string, value: string) {
  return `<div class="prop"><span class="type-caption muted">${escapeHtml(label)}</span><span class="prop-value">${value}</span></div>`
}

function date(value: string | null | undefined) {
  return value ? escapeHtml(formatDateTime(new Date(value))) : '<span class="muted">–</span>'
}

function dateOnly(value: string | null | undefined) {
  return value ? escapeHtml(new Date(value).toLocaleDateString('de-DE')) : '–'
}

function text(value: string | null | undefined) {
  return value ? escapeHtml(value) : '<span class="muted">–</span>'
}

function stat(label: string, value: string) {
  return `<div class="stat-tile"><span class="stat-text"><span class="type-caption muted">${escapeHtml(label)}</span><span class="type-body-strong">${escapeHtml(value)}</span></span></div>`
}

/** Speichern mit Rückmeldung und frischen Daten. */
async function mutate(work: () => Promise<unknown>, success: string) {
  try {
    await work()
    toast(success)
    await reload()
    invalidateList()
  } catch (error) {
    toast(errorText(error), 'error')
  }
}

// ── Kopf ─────────────────────────────────────────────────────────────

function renderHeader(a: AgentDetail) {
  const active = !terminated()
  const commands = [
    can('agents:write') && active ? commandButton('edit', 'edit', 'Bearbeiten') : '',
    can('agents:write') && active ? commandButton('flag', 'board', 'Markierung') : '',
    can('rank-changes:manage') && active ? commandButton('rank-change', 'arrowUpload', 'Rang ändern') : '',
    can('agents:write') && active ? commandButton('absence', 'timer', 'Abmeldung eintragen') : '',
    commandButton('open-dashboard', 'open', 'Im Dashboard öffnen'),
  ].join('')
  const flag = a.flag ? `<span class="flag-dot large" style="background:${FLAG_COLOR[a.flag] ?? 'transparent'}" title="Markierung: ${escapeHtml(FLAG[a.flag as keyof typeof FLAG] ?? a.flag)}"></span>` : ''
  const openSanctions = a.sanctions.filter((s) => s.status === 'ISSUED' || s.status === 'IN_COURT').length
  $('ag-detail-header').innerHTML = `
    <nav class="breadcrumb" aria-label="Pfad">
      <button class="crumb" data-action="back">Agents</button>
      <span class="crumb-sep">${icon('chevronRight')}</span>
      <span class="crumb current">${escapeHtml(agentName(a))}</span>
    </nav>
    <div class="detail-title agent-title">
      ${avatar(a, 'large')}
      <div class="agent-title-text">
        <h1 class="type-title">${escapeHtml(agentName(a))}${flag}</h1>
        <span class="type-body muted"><span class="rank-dot" style="background:${escapeHtml(a.rank.color)}"></span>${escapeHtml(a.rank.name)} · #${escapeHtml(badgeNumber(a.badgeNumber))}</span>
      </div>
      <div class="case-badges">
        ${pill(STATUS[a.status as keyof typeof STATUS] ?? a.status, STATUS_TONE[a.status] ?? 'subtle')}
        ${a.onLeave ? pill('Beurlaubt', 'brand') : ''}
        ${a.promotionBlocked ? pill('Uprank-Sperre', 'warning') : ''}
      </div>
    </div>
    <div class="command-bar">${commands}</div>
    <fluent-tablist id="ag-tabs" activeid="ag-tab-${tab}">
      ${TABS.map((t) => `<fluent-tab id="ag-tab-${t.id}" data-tab="${t.id}"><span class="tab-label">${t.label}${t.id === 'management' && openSanctions ? `<span class="tab-count">${openSanctions}</span>` : ''}</span></fluent-tab>`).join('')}
    </fluent-tablist>`
}

// ── Reiter ───────────────────────────────────────────────────────────

function profileHtml(a: AgentDetail) {
  const discord = !a.discordId
    ? '<span class="muted">nicht verknüpft</span>'
    : `${escapeHtml(a.discordId)} ${a.discordMember?.checked ? pill(a.discordMember.inGuild ? 'auf dem Server' : 'nicht auf dem Server', a.discordMember.inGuild ? 'success' : 'danger') : ''}`
  const status = `${pill(STATUS[a.status as keyof typeof STATUS] ?? a.status, STATUS_TONE[a.status] ?? 'subtle')}${a.status === 'INACTIVE' && can('agents:write') ? ` ${textButton('reset-inactivity', 'Fehlzeit zurücksetzen')}` : ''}`
  return `
    <div class="two-col">
      <div class="card col props">
        ${sectionHeader('Persönliche Daten')}
        ${prop('Name', escapeHtml(agentName(a)))}
        ${prop('Dienstnummer', `#${escapeHtml(badgeNumber(a.badgeNumber))}`)}
        ${prop('Rang', escapeHtml(a.rank.name))}
        ${prop('Status', status)}
        ${prop('Units', unitChips(a) || '<span class="muted">keine Unit</span>')}
        ${prop('Markierung', a.flag ? `<span class="flag-label"><span class="flag-dot" style="background:${FLAG_COLOR[a.flag]}"></span>${escapeHtml(FLAG[a.flag as keyof typeof FLAG] ?? a.flag)}</span>` : '<span class="muted">keine</span>')}
        ${prop('Notizen', a.notes ? `<span class="prose">${escapeHtml(a.notes)}</span>` : '<span class="muted">–</span>')}
      </div>
      <div class="card col props">
        ${sectionHeader('Kontakt & Dienst')}
        ${prop('Discord', discord)}
        ${prop('Telefonnummer', text(a.phoneNumber))}
        ${prop('Eintritt', `${dateOnly(a.hireDate)}${a.hiredBy?.displayName ? ` <span class="muted">· eingestellt von ${escapeHtml(a.hiredBy.displayName)}</span>` : ''}`)}
        ${prop('Zuletzt online', a.lastOnline ? escapeHtml(formatAgo(new Date(a.lastOnline))) : '<span class="muted">nie</span>')}
        ${a.onLeave ? prop('Beurlaubt seit', `${date(a.onLeaveSince)}${a.onLeaveReason ? `<span class="muted">${escapeHtml(a.onLeaveReason)}</span>` : ''}`) : ''}
        ${prop('Uprank-Sperre', a.promotionBlocked ? 'gesetzt' : '<span class="muted">nein</span>')}
      </div>
    </div>
    ${profileExtrasHtml()}`
}

const TIER = ['', 'Bronze', 'Silber', 'Gold']
const RELEASE_REASON: Record<string, string> = { MANUAL: 'manuell freigegeben', REASSIGNED: 'neu zugewiesen', TERMINATED: 'Agent gekündigt', RETIRED: 'Deckname gesperrt' }

function profileExtrasHtml() {
  if (!profileExtras) return ''
  const { tasks, achievements, codenames } = profileExtras
  const kind: Record<OpenTask['kind'], string> = { training: 'Ausbildung', contract: 'Vertrag', task: 'Aufgabe' }
  return `
    ${tasks.length ? `
      ${sectionHeader('Offene Punkte', `<span class="type-caption muted">${tasks.length}</span>`)}
      <div class="card"><div class="checklist">${tasks.map((task) => `
        <div class="check-row">
          ${pill(kind[task.kind], task.overdue ? 'danger' : task.inProgress ? 'brand' : 'subtle')}
          <span><span class="type-body-strong">${escapeHtml(task.title)}</span><br><span class="type-caption muted">${escapeHtml(task.detail)}${task.dueDate ? ` · fällig ${dateOnly(task.dueDate)}` : ''}</span></span>
          ${task.kind === 'training' ? '<button class="link-button" data-goto="career">Zur Ausbildung</button>' : ''}
        </div>`).join('')}</div></div>` : ''}
    ${achievements.length ? `
      ${sectionHeader('Auszeichnungen')}
      <div class="achievements">${achievements.map((item) => `
        <div class="card achievement tier-${item.tier}" title="${escapeHtml(TIER[item.tier])}">
          <span class="type-body-strong">${escapeHtml(item.title)}</span>
          <span class="type-caption muted">${escapeHtml(item.description)}</span>
        </div>`).join('')}</div>` : ''}
    ${codenames ? `
      ${sectionHeader('Decknamen', codenames.current ? `<span class="type-caption">Aktuell: <span class="type-body-strong">${escapeHtml([codenames.prefix, codenames.current.name].filter(Boolean).join(' '))}</span></span>` : '')}
      <div class="card">${codenames.items.length ? `<div class="checklist">${codenames.items.map((item) => `
        <div class="check-row">
          <span>${icon('history')}</span>
          <span><span class="type-body-strong">${escapeHtml([codenames.prefix, item.codename?.name].filter(Boolean).join(' '))}</span>
            <br><span class="type-caption muted">${date(item.assignedAt)} – ${item.releasedAt ? date(item.releasedAt) : 'aktuell'} · von ${escapeHtml(item.assignedBy?.displayName ?? 'gelöschtem Benutzer')}${item.releaseReason ? ` · ${escapeHtml(RELEASE_REASON[item.releaseReason] ?? item.releaseReason)}` : ''}</span>
            ${item.note ? `<br><span class="type-caption muted">${escapeHtml(item.note)}</span>` : ''}</span>
        </div>`).join('')}</div>` : empty('Noch keine Zuweisungen.')}</div>` : ''}`
}

function activityHtml(a: AgentDetail) {
  const duty = a.dutyTime
  const absences = a.absences
  const absenceRow = (absence: { id: string; startsAt: string; endsAt: string; reason: string }, label: string) => `
    <div class="check-row">
      <span>${icon('timer')}</span>
      <span><span class="type-body-strong">${escapeHtml(label)}</span> <span class="muted">${dateOnly(absence.startsAt)} – ${dateOnly(absence.endsAt)}</span><br><span class="type-caption muted">${escapeHtml(absence.reason)}</span></span>
    </div>`
  const absenceRows = [
    ...(absences?.active ? [absenceRow(absences.active, 'Aktuell abgemeldet')] : []),
    ...(absences?.upcoming ?? []).map((absence) => absenceRow(absence, 'Geplant')),
    ...(absences?.recent ?? []).slice(0, 5).map((absence) => absenceRow(absence, 'Vergangen')),
  ]
  const daily = a.playtime?.daily ?? []
  const maxDay = Math.max(1, ...daily.map((day) => day.durationMs))
  return `
    ${sectionHeader('Dienstzeit')}
    ${duty ? `
      <div class="stat-strip">
        ${stat('Diese Woche (Dienst)', durationLabel(duty.weekDurationMs))}
        ${stat('Diese Woche (Spielzeit)', durationLabel(duty.playtimeWeekDurationMs))}
        ${stat('Gesamt', durationLabel(duty.totalDurationMs))}
        ${stat('Schichten', String(duty.sessionCount))}
        ${stat('Ø Schicht', durationLabel(duty.averageSessionMs))}
        ${stat('Längste', durationLabel(duty.longestSessionMs))}
      </div>
      ${duty.activeSession ? `<p class="type-body">${pill('Im Dienst', 'success')} seit ${date(duty.activeSession.clockInAt)}</p>` : ''}` : empty('Keine Dienstzeiten erfasst.')}
    ${sectionHeader('Abmeldungen', can('agents:write') && !terminated() ? commandButton('absence', 'add', 'Abmeldung eintragen') : '')}
    <div class="card">${absenceRows.length ? `<div class="checklist">${absenceRows.join('')}</div>` : empty('Keine Abmeldungen.')}</div>
    ${daily.length ? `
      ${sectionHeader('Spielzeit der letzten Tage')}
      <div class="card playtime-bars">
        ${daily.map((day) => `<div class="playtime-day" title="${escapeHtml(day.durationLabel)}"><span class="playtime-bar"><span style="height:${(day.durationMs / maxDay) * 100}%"></span></span><span class="type-caption muted">${escapeHtml(day.label)}</span></div>`).join('')}
      </div>` : ''}`
}

function careerHtml(a: AgentDetail) {
  const canTrain = can('agent-trainings:manage') && !terminated()
  const trainings = [...a.trainings].sort((x, y) => x.training.sortOrder - y.training.sortOrder)
  const promotions = [...a.promotionLogs].sort((x, y) => y.createdAt.localeCompare(x.createdAt))
  return `
    ${sectionHeader('Ausbildungen', `<span class="type-caption muted">${trainings.filter((t) => t.completed).length} von ${trainings.length} abgeschlossen</span>`)}
    <div class="card">
      ${trainings.length ? `<div class="checklist">${trainings.map((row) => `
        <div class="check-row">
          <fluent-checkbox data-training="${escapeHtml(row.trainingId)}" ${row.completed ? 'checked' : ''} ${canTrain ? '' : 'disabled'}></fluent-checkbox>
          <span class="${row.completed ? '' : 'muted'}">${escapeHtml(row.training.label)}${row.training.minRank ? ` <span class="type-caption muted">ab ${escapeHtml(row.training.minRank.name)}</span>` : ''}</span>
        </div>`).join('')}</div>` : empty('Keine Ausbildungsarten angelegt.')}
    </div>
    ${sectionHeader('Rangänderungen', can('rank-changes:manage') && !terminated()
      ? `${textButton('list-promotion', 'Zur Up-Rank-Liste')}${textButton('list-demotion', 'Zur D-Rank-Liste')}${commandButton('rank-change', 'arrowUpload', 'Rang ändern')}`
      : '')}
    <div class="card">
      ${promotions.length ? `<div class="checklist">${promotions.map((log) => {
        const up = log.newRank.sortOrder < log.oldRank.sortOrder
        return `
        <div class="check-row">
          ${pill(up ? 'Beförderung' : 'Degradierung', up ? 'success' : 'warning')}
          <span>${escapeHtml(log.oldRank.name)} → <span class="type-body-strong">${escapeHtml(log.newRank.name)}</span>${log.note ? `<br><span class="type-caption muted">${escapeHtml(log.note)}</span>` : ''}</span>
          <span class="type-caption muted">${date(log.createdAt)}${log.performedBy ? ` · ${escapeHtml(log.performedBy.displayName)}` : ''}</span>
        </div>`
      }).join('')}</div>` : empty('Noch keine Rangänderungen.')}
    </div>`
}

function licenseState(row: LicenseRow) {
  if (row.state === 'GRANTED') return pill('Erteilt', 'success')
  if (row.state === 'REVOKED') {
    const blocked = row.regainableAt && new Date(row.regainableAt) > new Date()
    return blocked ? pill(`Entzogen · wieder ab ${dateOnly(row.regainableAt)}`, 'danger') : pill('Entzogen · wieder erteilbar', 'warning')
  }
  return pill('Nicht erteilt', 'subtle')
}

function licensesHtml() {
  if (!licenses) return empty('Lade Lizenzen …')
  const manage = can('licenses:manage') && !terminated()
  const granted = licenses.licenses.filter((row) => row.state === 'GRANTED').length
  return `
    ${sectionHeader('Lizenzen', `<span class="type-caption muted">${granted} von ${licenses.licenses.length} erteilt</span>`)}
    <div class="card list">
      ${licenses.licenses.length ? licenses.licenses.map((row) => `
        <div class="list-row license-row">
          <span class="license-text">
            <span class="type-body-strong">${escapeHtml(row.license.label)}</span>
            ${row.license.description ? `<span class="type-caption muted license-desc">${escapeHtml(row.license.description)}</span>` : ''}
          </span>
          ${licenseState(row)}
          ${manage ? (row.state === 'GRANTED' ? textButton('license-revoke', 'Entziehen', row.license.id) : textButton('license-grant', 'Erteilen', row.license.id)) : ''}
        </div>`).join('') : empty('Noch keine Lizenzarten angelegt.')}
    </div>
    ${licenses.history.length ? `
      ${sectionHeader('Historie')}
      <div class="card"><div class="checklist">${licenses.history.map((entry) => `
        <div class="check-row">
          ${pill(entry.action === 'GRANTED' ? 'Erteilt' : 'Entzogen', entry.action === 'GRANTED' ? 'success' : 'danger')}
          <span><span class="type-body-strong">${escapeHtml(entry.licenseLabel)}</span>${entry.overrodeCooldown ? ` ${pill('Sperrfrist übersteuert', 'warning')}` : ''}${entry.bulk ? ` <span class="type-caption muted">Erstausstattung</span>` : ''}
            ${entry.reason ? `<br><span class="type-caption muted">${escapeHtml(entry.reason)}</span>` : ''}
            ${entry.sanction ? `<br><span class="type-caption muted">Sanktion: ${escapeHtml(entry.sanction.label)}</span>` : ''}
            ${entry.regainableAt ? `<br><span class="type-caption muted">Wieder möglich ab ${dateOnly(entry.regainableAt)}</span>` : ''}</span>
          <span class="type-caption muted">${date(entry.createdAt)} · ${escapeHtml(entry.actorName ?? 'Gelöscht')}</span>
        </div>`).join('')}</div></div>` : ''}`
}

function recordsHtml(a: AgentDetail) {
  const manageRecords = can('agents:write')
  const manageNotes = can('notes:manage')
  const entries = records?.entries ?? []
  return `
    ${sectionHeader(`Akteneinträge${records ? ` · ${records.positive} positiv · ${records.negative} negativ` : ''}`, manageRecords ? commandButton('add-record', 'add', 'Eintrag hinzufügen') : '')}
    <div class="card">
      ${!records ? empty('Lade Einträge …') : entries.length ? `<div class="checklist">${entries.map((entry) => `
        <div class="check-row">
          ${pill(entry.kind === 'POSITIVE' ? 'Positiv' : 'Negativ', entry.kind === 'POSITIVE' ? 'success' : 'danger')}
          <span><span class="type-body-strong">${escapeHtml(entry.title)}</span>${entry.content ? `<br><span class="type-caption muted">${escapeHtml(entry.content)}</span>` : ''}<br><span class="type-caption muted">${date(entry.createdAt)} · ${escapeHtml(entry.author ?? 'Gelöscht')}</span></span>
          ${manageRecords ? actionButton('delete-record', 'delete', 'Eintrag löschen', entry.id) : ''}
        </div>`).join('')}</div>` : empty('Keine Einträge.')}
    </div>
    ${sectionHeader('Notizen', manageNotes ? commandButton('add-note', 'add', 'Notiz hinzufügen') : '')}
    <div class="card">
      ${a.agentNotes.length ? `<div class="checklist">${a.agentNotes.map((note) => `
        <div class="check-row">
          <span>${icon('document')}</span>
          <span>${note.title ? `<span class="type-body-strong">${escapeHtml(note.title)}</span><br>` : ''}<span class="prose">${escapeHtml(note.content)}</span><br><span class="type-caption muted">${date(note.createdAt)} · ${escapeHtml(note.author?.displayName ?? 'Gelöscht')}</span></span>
          ${manageNotes ? actionButton('delete-note', 'delete', 'Notiz löschen', note.id) : ''}
        </div>`).join('')}</div>` : empty('Keine Notizen.')}
    </div>
    ${contractsHtml(a)}`
}

function contractsHtml(a: AgentDetail) {
  if (!a.contracts && !a.jobApplication) return ''
  const manage = can('contracts:manage') && !terminated()
  const contracts = a.contracts ?? []
  return `
    ${sectionHeader('Verträge', manage ? commandButton('create-contract', 'add', 'Vertrag erstellen und senden') : '')}
    <div class="card">
      ${contracts.length ? `<div class="checklist">${contracts.map((c) => {
        const status = CONTRACT_STATUS[c.status] ?? { label: c.status, tone: 'subtle' }
        const detail = c.status === 'SIGNED' ? `Unterschrieben ${date(c.signedAt)}${c.signedName ? ` als ${escapeHtml(c.signedName)}` : ''}`
          : c.status === 'DECLINED' ? `Abgelehnt ${date(c.declinedAt)}${c.declineReason ? ` · ${escapeHtml(c.declineReason)}` : ''}`
            : c.sentAt ? `Zuletzt gesendet ${date(c.sentAt)} (${c.sendCount}×)` : 'Noch nicht versendet'
        return `
        <div class="check-row">
          ${pill(status.label, status.tone)}
          <span><span class="type-body-strong">${escapeHtml(c.title)}</span><br><span class="type-caption muted">${detail}</span>${c.lastSendError ? `<br><span class="type-caption error-text">Versand: ${escapeHtml(c.lastSendError)}</span>` : ''}</span>
          ${manage && (c.status === 'DRAFT' || c.status === 'SENT') ? textButton('send-contract', c.status === 'DRAFT' ? 'Senden' : 'Erneut senden', c.id) : ''}
        </div>`
      }).join('')}</div>` : empty('Noch kein Vertrag.')}
    </div>
    ${a.jobApplication ? `
      ${sectionHeader('Bewerbung')}
      <div class="card props">
        ${prop('Bewerber', escapeHtml(a.jobApplication.applicantDisplayName))}
        ${prop('Status', escapeHtml(a.jobApplication.statusText))}
        ${prop('Eingereicht', date(a.jobApplication.submittedAt))}
      </div>` : ''}`
}

function managementHtml(a: AgentDetail) {
  const canSanction = can('sanctions:manage')
  const canConfirm = can('sanctions:confirm')
  const sanctions = [...a.sanctions].sort((x, y) => y.createdAt.localeCompare(x.createdAt))
  const actions = [
    can('agents:leave') && !terminated() ? textButton(a.onLeave ? 'end-leave' : 'start-leave', a.onLeave ? 'Beurlaubung aufheben' : 'Beurlauben') : '',
    can('agents:promotion-block') && !terminated() ? textButton('promotion-block', a.promotionBlocked ? 'Uprank-Sperre aufheben' : 'Uprank-Sperre setzen') : '',
    can('agents:write') && terminated() ? textButton('reactivate', 'Reaktivieren') : '',
    can('terminations:manage') && !terminated() ? textButton('terminate', 'Kündigen') : '',
    can('agents:delete') ? textButton('delete-agent', 'Agent löschen') : '',
  ].filter(Boolean)
  return `
    ${sectionHeader('Sanktionen', canSanction && !terminated() ? commandButton('issue-sanction', 'add', 'Sanktion ausstellen') : '')}
    <div class="card">
      ${sanctions.length ? `<div class="checklist">${sanctions.map((s) => `
        <div class="check-row sanction-row">
          ${pill(SANCTION_STATUS[s.status] ?? s.status, SANCTION_TONE[s.status] ?? 'subtle')}
          <span>
            <span class="type-body-strong">Penal Grade ${escapeHtml(s.penalGrade)} · Stufe ${escapeHtml(s.level)}</span>
            <br><span class="prose">${escapeHtml(s.reason)}</span>
            ${s.penalty ? `<br><span class="type-caption muted">Auflage: ${escapeHtml(s.penalty)}</span>` : ''}
            ${s.suspendedUntil ? `<br><span class="type-caption muted">Suspendiert bis ${date(s.suspendedUntil)}</span>` : ''}
            <br><span class="type-caption muted">${date(s.createdAt)} · ${escapeHtml(s.issuedBy?.displayName ?? 'Gelöscht')}${s.confirmedBy ? ` · bestätigt von ${escapeHtml(s.confirmedBy.displayName)}` : ''}</span>
          </span>
          <span class="row-actions">
            ${canSanction && s.status === 'ISSUED' ? textButton('sanction-execute', 'Vollzogen', s.id) : ''}
            ${canConfirm && (s.status === 'ISSUED' || s.status === 'EXECUTED' || s.status === 'IN_COURT') && !s.confirmedAt ? textButton('sanction-confirm', 'Bestätigen', s.id) : ''}
            ${canSanction && s.status === 'ISSUED' ? textButton('sanction-edit', 'Bearbeiten', s.id) : ''}
            ${canSanction && s.status !== 'REVOKED' ? textButton('sanction-revoke', 'Aufheben', s.id) : ''}
          </span>
        </div>`).join('')}</div>` : empty('Keine Sanktionen.')}
    </div>
    ${actions.length ? `${sectionHeader('Personalmaßnahmen')}<div class="card management-actions">${actions.join('')}</div>` : ''}`
}

const TIMELINE_TONE: Record<TimelineEntry['tone'], string> = { positive: 'success', negative: 'danger', neutral: 'subtle' }

function historyHtml() {
  if (!timeline) return empty('Lade Verlauf …')
  if (!timeline.length) return empty('Noch keine Einträge.')
  return `
    <div class="card"><div class="checklist">${timeline.map((entry) => `
      <div class="check-row">
        <span class="timeline-dot tone-${TIMELINE_TONE[entry.tone]}"></span>
        <span>
          <span class="type-body-strong">${escapeHtml(entry.title)}</span>${entry.description ? ` <span class="muted">· ${escapeHtml(entry.description)}</span>` : ''}
          ${entry.details.length ? `<br><span class="type-caption muted">${entry.details.map((d) => `${escapeHtml(d.label)}: ${escapeHtml(d.value)}`).join(' · ')}</span>` : ''}
        </span>
        <span class="type-caption muted">${date(entry.occurredAt)}</span>
      </div>`).join('')}</div></div>`
}

function renderTab() {
  if (!agent) return
  $('ag-tabs')?.setAttribute('activeid', `ag-tab-${tab}`)
  const body = $('ag-detail-body')
  switch (tab) {
    case 'profile': body.innerHTML = profileHtml(agent); break
    case 'activity': body.innerHTML = activityHtml(agent); break
    case 'career': body.innerHTML = careerHtml(agent); break
    case 'licenses': body.innerHTML = licensesHtml(); break
    case 'records': body.innerHTML = recordsHtml(agent); break
    case 'management': body.innerHTML = managementHtml(agent); break
    case 'history': body.innerHTML = historyHtml(); break
  }
  void loadTabData()
}

/** Reiter mit eigenen Daten laden, sobald sie gebraucht werden. */
async function loadTabData() {
  if (!agent) return
  const id = agent.id
  try {
    if (tab === 'profile' && !profileExtras) {
      const [tasks, achievements, codenames] = await Promise.all([
        api.get<OpenTask[]>(`/api/agents/${id}/open-tasks`).catch(() => []),
        api.get<Achievement[]>(`/api/agents/${id}/achievements`).catch(() => []),
        can('codenames:view') ? api.get<CodenameHistory>(`/api/agents/${id}/codename?page=1&pageSize=10`).catch(() => null) : null,
      ])
      profileExtras = { tasks, achievements, codenames }
    } else if (tab === 'licenses' && !licenses) licenses = await api.get<Licenses>(`/api/agents/${id}/licenses`)
    else if (tab === 'records' && !records) records = await api.get<Records>(`/api/agents/${id}/records`)
    else if (tab === 'history' && !timeline) timeline = (await api.get<{ items: TimelineEntry[] }>(`/api/agents/${id}/timeline`)).items
    else return
  } catch (error) {
    toast(errorText(error), 'error')
    return
  }
  if (agent?.id === id) renderTab()
}

function render() {
  if (!agent) return
  renderHeader(agent)
  renderTab()
}

async function reload() {
  if (!agent) return
  const id = agent.id
  const [next] = await Promise.all([
    api.get<AgentDetail>(`/api/agents/${id}`),
    tab === 'licenses' ? api.get<Licenses>(`/api/agents/${id}/licenses`).then((data) => (licenses = data)) : (licenses = null),
    tab === 'records' ? api.get<Records>(`/api/agents/${id}/records`).then((data) => (records = data)) : (records = null),
  ])
  timeline = null
  profileExtras = null
  agent = next
  render()
}

export async function openAgent(id: string) {
  try {
    const next = await api.get<AgentDetail>(`/api/agents/${id}`)
    agent = next
    records = null
    licenses = null
    timeline = null
    profileExtras = null
    tab = 'profile'
    $('ag-list-view').hidden = true
    $('ag-detail-view').hidden = false
    $('content').scrollTop = 0
    render()
  } catch (error) {
    toast(`Akte konnte nicht geladen werden: ${errorText(error)}`, 'error')
  }
}

// ── Dialoge ──────────────────────────────────────────────────────────

async function ranksAndUnits(): Promise<{ ranks: Rank[]; units: Unit[] }> {
  let ranks = listLookups.ranks()
  let units = listLookups.units()
  if (!ranks.length) ranks = await api.get<Rank[]>('/api/ranks')
  if (!units.length) units = await api.get<Unit[]>('/api/units?active=true').catch(() => [])
  return { ranks, units }
}

async function editAgent(a: AgentDetail) {
  const { units } = await ranksAndUnits()
  const current = new Set(a.units?.length ? a.units : a.unit ? [a.unit] : [])
  const unitFields: Field[] = units.map((unit) => ({ name: `unit:${unit.key}`, label: unit.name, type: 'checkbox', value: current.has(unit.key) }))
  const saved = await openForm({
    title: 'Agent bearbeiten',
    submitLabel: 'Speichern',
    fields: [
      { name: 'firstName', label: 'Vorname', type: 'text', required: true, value: a.firstName },
      { name: 'lastName', label: 'Nachname', type: 'text', required: true, value: a.lastName },
      { name: 'badgeNumber', label: 'Dienstnummer', type: 'text', value: a.badgeNumber },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS).filter(([key]) => key !== 'TERMINATED').map(([value, label]) => ({ value, label })), value: a.status },
      { name: 'discordId', label: 'Discord-ID', type: 'text', value: a.discordId ?? '' },
      { name: 'phoneNumber', label: 'Telefonnummer', type: 'text', value: a.phoneNumber ?? '' },
      { name: 'hireDate', label: 'Eintrittsdatum', type: 'text', value: a.hireDate.slice(0, 10), placeholder: 'JJJJ-MM-TT' },
      { name: 'notes', label: 'Notizen', type: 'textarea', value: a.notes ?? '' },
      ...unitFields,
    ],
    onSubmit: async (values) => {
      await api.patch(`/api/agents/${a.id}`, {
        firstName: values.firstName,
        lastName: values.lastName,
        badgeNumber: values.badgeNumber,
        status: values.status,
        discordId: values.discordId || null,
        phoneNumber: values.phoneNumber || null,
        hireDate: values.hireDate || undefined,
        notes: values.notes || null,
        units: units.filter((unit) => values[`unit:${unit.key}`] === true).map((unit) => unit.key),
      })
      toast('Agent aktualisiert')
    },
  })
  if (saved) {
    await reload()
    invalidateList()
  }
}

async function changeFlag(a: AgentDetail) {
  const saved = await openForm({
    title: 'Markierung',
    fields: [{
      name: 'flag',
      label: 'Markierung',
      type: 'select',
      span: 2,
      options: [{ value: 'NONE', label: 'Keine Markierung' }, ...Object.entries(FLAG).map(([value, label]) => ({ value, label }))],
      value: a.flag ?? 'NONE',
    }],
    submitLabel: 'Speichern',
    onSubmit: async (values) => {
      await api.patch(`/api/agents/${a.id}`, { flag: values.flag === 'NONE' ? null : values.flag })
      toast(values.flag === 'NONE' ? 'Markierung entfernt' : `Markierung: ${FLAG[values.flag as keyof typeof FLAG]}`)
    },
  })
  if (saved) {
    await reload()
    invalidateList()
  }
}

async function changeRank(a: AgentDetail) {
  const { ranks } = await ranksAndUnits()
  const saved = await openForm({
    title: 'Rang ändern',
    description: `Aktuell: ${a.rank.name}. Ohne Dienstnummer vergibt das Dashboard die nächste freie des neuen Rangs.`,
    fields: [
      { name: 'newRankId', label: 'Neuer Rang', type: 'select', required: true, span: 2, options: ranks.filter((rank) => rank.id !== a.rankId).map((rank) => ({ value: rank.id, label: rank.name })) },
      { name: 'newBadgeNumber', label: 'Neue Dienstnummer', type: 'text', placeholder: 'automatisch' },
      { name: 'note', label: 'Notiz', type: 'textarea' },
    ],
    submitLabel: 'Rang ändern',
    onSubmit: async (values) => {
      await api.post('/api/promotions', {
        agentId: a.id,
        newRankId: values.newRankId,
        newBadgeNumber: values.newBadgeNumber || undefined,
        note: values.note || undefined,
      })
      const target = ranks.find((rank) => rank.id === values.newRankId)
      toast(target && target.sortOrder < a.rank.sortOrder ? 'Beförderung durchgeführt' : 'Degradierung durchgeführt')
    },
  })
  if (saved) {
    await reload()
    invalidateList()
  }
}

async function addAbsence(a: AgentDetail) {
  const inThreeDays = new Date(Date.now() + 3 * 86_400_000)
  inThreeDays.setHours(23, 59, 0, 0)
  const saved = await openForm({
    title: 'Abmeldung eintragen',
    fields: [
      { name: 'endsAt', label: 'Abgemeldet bis', type: 'datetime', required: true, value: inThreeDays, span: 2 },
      { name: 'reason', label: 'Grund', type: 'textarea', required: true },
    ],
    submitLabel: 'Eintragen',
    onSubmit: async (values) => {
      await api.post('/api/absences', { agentId: a.id, endsAt: values.endsAt, reason: String(values.reason ?? '').trim() })
      toast('Abmeldung eingetragen')
    },
  })
  if (saved) {
    await reload()
    invalidateList()
  }
}

async function licenseDialog(licenseId: string, action: 'grant' | 'revoke') {
  const row = licenses?.licenses.find((item) => item.license.id === licenseId)
  if (!agent || !licenses || !row) return
  const blocked = row.state === 'REVOKED' && !!row.regainableAt && new Date(row.regainableAt) > new Date()
  const fields: Field[] = action === 'revoke'
    ? [
        { name: 'reason', label: 'Grund', type: 'textarea', required: true },
        ...(licenses.sanctions.length
          ? [{ name: 'sanctionId', label: 'Zugehörige Sanktion (optional)', type: 'select' as const, span: 2 as const, options: [{ value: '', label: 'Keine Sanktion' }, ...licenses.sanctions.map((s) => ({ value: s.id, label: s.label }))], value: '' }]
          : []),
      ]
    : [
        ...(blocked ? [{ name: 'overrideCooldown', label: 'Sperrfrist bewusst übersteuern', type: 'checkbox' as const }] : []),
        { name: 'reason', label: blocked ? 'Begründung' : 'Notiz (optional)', type: 'textarea', required: blocked, placeholder: 'z. B. Fahrt mit der Academy bestanden' },
      ]
  const description = action === 'revoke'
    ? row.license.cooldownDays > 0
      ? `Die Lizenz kann frühestens in ${row.license.cooldownDays} Tagen wieder erteilt werden.`
      : 'Keine Sperrfrist – nach erneuter Ausbildung/Prüfung jederzeit wieder erteilbar.'
    : blocked
      ? `Die Sperrfrist läuft noch bis ${dateOnly(row.regainableAt)}. Erteilen nur übersteuert und mit Begründung.`
      : undefined
  const id = agent.id
  const saved = await openForm({
    title: `${row.license.label} ${action === 'grant' ? 'erteilen' : 'entziehen'}`,
    description,
    danger: action === 'revoke',
    submitLabel: action === 'grant' ? 'Erteilen' : 'Entziehen',
    fields,
    onSubmit: async (values) => {
      licenses = await api.post<Licenses>(`/api/agents/${id}/licenses`, {
        licenseId,
        action,
        reason: values.reason ?? '',
        sanctionId: values.sanctionId || null,
        overrideCooldown: values.overrideCooldown === true,
      })
      toast(action === 'grant' ? 'Lizenz erteilt' : 'Lizenz entzogen')
    },
  })
  if (saved) {
    timeline = null
    renderTab()
  }
}

async function addRecord(a: AgentDetail) {
  const saved = await openForm({
    title: 'Akteneintrag hinzufügen',
    fields: [
      { name: 'kind', label: 'Art', type: 'select', options: [{ value: 'POSITIVE', label: 'Positiv' }, { value: 'NEGATIVE', label: 'Negativ' }], value: 'POSITIVE', span: 2 },
      { name: 'title', label: 'Titel', type: 'text', required: true, span: 2, maxLength: 200 },
      { name: 'content', label: 'Beschreibung', type: 'textarea' },
    ],
    submitLabel: 'Speichern',
    onSubmit: async (values) => {
      records = await api.post<Records>(`/api/agents/${a.id}/records`, values)
      toast('Eintrag gespeichert')
    },
  })
  if (saved) renderTab()
}

async function addNote(a: AgentDetail) {
  const saved = await openForm({
    title: 'Notiz hinzufügen',
    fields: [
      { name: 'title', label: 'Titel (optional)', type: 'text', span: 2, maxLength: 200 },
      { name: 'content', label: 'Notiz', type: 'textarea', required: true },
    ],
    submitLabel: 'Speichern',
    onSubmit: async (values) => {
      await api.post('/api/notes', { title: values.title || '', content: values.content, agentId: a.id })
      toast('Notiz hinzugefügt')
    },
  })
  if (saved) await reload()
}

async function startLeave(a: AgentDetail) {
  const saved = await openForm({
    title: 'Beurlauben',
    description: 'Gilt wie eine Abmeldung, bleibt aber bis zur Aufhebung bestehen.',
    fields: [{ name: 'reason', label: 'Grund', type: 'textarea', required: true }],
    submitLabel: 'Beurlauben',
    onSubmit: async (values) => {
      await api.post(`/api/agents/${a.id}/leave`, { reason: values.reason })
      toast('Agent beurlaubt')
    },
  })
  if (saved) {
    await reload()
    invalidateList()
  }
}

/** Vorschlag für eine offene Up-/D-Rank-Liste (wird dort abgestimmt und gesammelt vollzogen). */
async function addToRankList(a: AgentDetail, type: 'PROMOTION' | 'DEMOTION') {
  const [{ ranks }, lists] = await Promise.all([
    ranksAndUnits(),
    api.get<{ id: string; name: string; status: string; submissionsClosed: boolean }[]>('/api/rank-change-lists'),
  ])
  const open = lists.filter((list) => list.status === 'DRAFT' && !list.submissionsClosed)
  const label = type === 'PROMOTION' ? 'Up-Rank-Liste' : 'D-Rank-Liste'
  if (!open.length) return toast(`Keine offene Liste – erst im Dashboard eine ${label} anlegen.`, 'warning')
  // Kleinere sortOrder = höherer Rang.
  const candidates = ranks.filter((rank) => (type === 'PROMOTION' ? rank.sortOrder < a.rank.sortOrder : rank.sortOrder > a.rank.sortOrder))
  const saved = await openForm({
    title: `Zur ${label} hinzufügen`,
    fields: [
      { name: 'listId', label: 'Liste', type: 'select', required: true, span: 2, options: open.map((list) => ({ value: list.id, label: list.name })), value: open[0].id },
      {
        name: 'proposedRankId',
        label: type === 'PROMOTION' ? 'Neuer Rang (höher)' : 'Neuer Rang (niedriger)',
        type: 'select',
        required: true,
        options: candidates.map((rank) => ({ value: rank.id, label: rank.name })),
        value: type === 'PROMOTION' ? candidates.at(-1)?.id : candidates[0]?.id,
      },
      { name: 'newBadgeNumber', label: 'Neue Dienstnummer', type: 'text', placeholder: 'automatisch' },
      { name: 'note', label: 'Begründung', type: 'textarea' },
    ],
    submitLabel: 'Hinzufügen',
    onSubmit: async (values) => {
      await api.post(`/api/rank-change-lists/${values.listId}/entries`, {
        agentId: a.id,
        proposedRankId: values.proposedRankId,
        newBadgeNumber: values.newBadgeNumber || undefined,
        note: values.note || undefined,
      })
      toast(`Zur ${label} hinzugefügt`)
    },
  })
  if (saved) timeline = null
}

async function terminate(a: AgentDetail) {
  const saved = await openForm({
    title: 'Agent kündigen',
    description: `${agentName(a)} wird gekündigt. Die Discord-Rollen werden entfernt, die Akte bleibt erhalten.`,
    danger: true,
    submitLabel: 'Kündigung bestätigen',
    fields: [{ name: 'reason', label: 'Kündigungsgrund', type: 'textarea', required: true }],
    onSubmit: async (values) => {
      await api.post('/api/terminations', { agentId: a.id, reason: values.reason })
      toast(`${agentName(a)} gekündigt`)
    },
  })
  if (saved) {
    await reload()
    invalidateList()
  }
}

// ── Aktionen ─────────────────────────────────────────────────────────

async function handleAction(action: string, id: string) {
  const a = agent
  if (!a) return
  switch (action) {
    case 'back':
      return onBack()
    case 'open-dashboard':
      return backend.openDashboard(`/agents/${a.id}`)
    case 'edit':
      return editAgent(a)
    case 'flag':
      return changeFlag(a)
    case 'rank-change':
      return changeRank(a)
    case 'absence':
      return addAbsence(a)
    case 'reset-inactivity':
      return mutate(() => api.post(`${base()}/inactivity-reset`), 'Fehlzeit zurückgesetzt')
    case 'license-grant':
    case 'license-revoke':
      return licenseDialog(id, action === 'license-grant' ? 'grant' : 'revoke')
    case 'add-record':
      return addRecord(a)
    case 'delete-record':
      if (!(await confirmAction('Eintrag löschen?', 'Der Akteneintrag wird endgültig entfernt.'))) return
      try {
        records = await api.del<Records>(`${base()}/records/${id}`)
        toast('Eintrag gelöscht')
        renderTab()
      } catch (error) {
        toast(errorText(error), 'error')
      }
      return
    case 'add-note':
      return addNote(a)
    case 'delete-note':
      if (!(await confirmAction('Notiz löschen?', 'Die Notiz wird endgültig entfernt.'))) return
      return mutate(() => api.del(`/api/notes/${id}`), 'Notiz gelöscht')
    case 'start-leave':
      return startLeave(a)
    case 'end-leave':
      if (!(await confirmAction('Beurlaubung aufheben?', `Die Beurlaubung von ${agentName(a)} endet sofort.`, 'Aufheben'))) return
      return mutate(() => api.del(`${base()}/leave`), 'Beurlaubung aufgehoben')
    case 'promotion-block':
      if (a.promotionBlocked && !(await confirmAction('Uprank-Sperre aufheben?', `${agentName(a)} kann danach wieder befördert werden.`, 'Aufheben'))) return
      return mutate(
        () => (a.promotionBlocked ? api.del(`${base()}/promotion-block`) : api.post(`${base()}/promotion-block`)),
        a.promotionBlocked ? 'Uprank-Sperre aufgehoben' : 'Uprank-Sperre gesetzt',
      )
    case 'reactivate':
      if (!(await confirmAction('Agent reaktivieren?', 'Der Status wird wieder auf „Aktiv“ gesetzt.', 'Reaktivieren'))) return
      return mutate(() => api.patch(base(), { status: 'ACTIVE' }), 'Agent reaktiviert')
    case 'sanction-execute':
      return mutate(() => api.patch(`/api/sanctions/${id}`, { action: 'EXECUTE' }), 'Maßnahme als vollzogen vermerkt')
    case 'sanction-confirm':
      return mutate(() => api.patch(`/api/sanctions/${id}`, { action: 'CONFIRM' }), 'Sanktion bestätigt')
    case 'sanction-revoke':
      if (!(await confirmAction('Sanktion aufheben?', 'Die Sanktion wird als aufgehoben vermerkt und gilt nicht mehr als laufend.', 'Aufheben'))) return
      return mutate(() => api.patch(`/api/sanctions/${id}`, { action: 'REVOKE' }), 'Sanktion aufgehoben')
    case 'issue-sanction':
    case 'sanction-edit': {
      const sanction = action === 'sanction-edit' ? a.sanctions.find((s) => s.id === id) ?? null : null
      if (await openSanctionDialog(a.id, agentName(a), sanction).catch((error) => (toast(errorText(error), 'error'), false))) {
        toast(sanction ? 'Sanktion aktualisiert' : 'Sanktion ausgestellt')
        await reload()
        invalidateList()
      }
      return
    }
    case 'terminate':
      return terminate(a)
    case 'create-contract':
      if (!(await confirmAction('Vertrag erstellen?', `Ein Arbeitsvertrag aus der Standardvorlage wird erstellt und ${agentName(a)} per Discord geschickt.`, 'Erstellen und senden'))) return
      return mutate(() => api.post('/api/contracts', { agentId: a.id, applicationId: a.jobApplication?.id ?? null }), 'Vertrag erstellt und versendet')
    case 'send-contract':
      return mutate(() => api.post(`/api/contracts/${id}/send`), 'Vertragsnachricht gesendet')
    case 'list-promotion':
    case 'list-demotion':
      return addToRankList(a, action === 'list-promotion' ? 'PROMOTION' : 'DEMOTION')
    case 'delete-agent':
      if (!(await confirmAction('Agent löschen?', `${agentName(a)} wird mit der ganzen Akte endgültig gelöscht.`))) return
      try {
        await api.del(base())
        toast('Agent gelöscht')
        onBack()
      } catch (error) {
        toast(errorText(error), 'error')
      }
      return
  }
}

async function toggleTraining(trainingId: string, completed: boolean, box: HTMLElement & { checked: boolean }) {
  const a = agent
  const row = a?.trainings.find((t) => t.trainingId === trainingId)
  if (!a || !row) return
  // Unter dem Mindestrang nur nach Rückfrage – wie im Dashboard.
  const belowMinimum = completed && row.training.minRank && a.rank.sortOrder > row.training.minRank.sortOrder
  if (belowMinimum && !(await confirmAction(
    'Ausbildung außerhalb des Mindestrangs',
    `${row.training.label} ist erst ab ${row.training.minRank!.name} vorgesehen. Trotzdem als abgeschlossen eintragen?`,
    'Eintragen',
  ))) {
    box.checked = false
    return
  }
  await mutate(
    () => api.put(`${base()}/trainings`, {
      trainings: a.trainings.map((t) => ({ trainingId: t.trainingId, completed: t.trainingId === trainingId ? completed : t.completed })),
      overrideTrainingIds: belowMinimum ? [trainingId] : [],
    }),
    completed ? `${row.training.label} abgeschlossen` : `${row.training.label} wieder offen`,
  )
}

export function initDetail(back: () => void) {
  onBack = () => {
    $('ag-detail-view').hidden = true
    $('ag-list-view').hidden = false
    agent = null
    back()
  }
  const view = $('ag-detail-view')
  view.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const goto = target.closest<HTMLElement>('[data-goto]')
    if (goto) {
      tab = goto.dataset.goto as Tab
      return render()
    }
    const tabEl = target.closest<HTMLElement>('fluent-tab[data-tab]')
    if (tabEl) {
      tab = tabEl.dataset.tab as Tab
      return renderTab()
    }
    const button = target.closest<HTMLElement>('[data-action]')
    if (button) void handleAction(button.dataset.action!, button.dataset.id ?? '')
  })
  view.addEventListener('change', (event) => {
    const box = (event.target as HTMLElement).closest<HTMLElement & { checked: boolean }>('fluent-checkbox[data-training]')
    if (box) void toggleTraining(box.dataset.training!, box.checked, box)
  })
}


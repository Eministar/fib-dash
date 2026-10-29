import { api } from '../api'
import { backend } from '../backend'
import { $, errorText, escapeHtml, initials } from '../dom'
import { formatBytes, formatClock, formatDateTime } from '../format'
import { icon, type IconName } from '../icons'
import { can, navigation, state } from '../store'
import { confirmAction, openForm, type Field } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import { playClip } from '../ui/clip-player'
import { createCityMap } from '../ui/city-map'
import { pickMapSpots, spotPin } from '../ui/map-picker'
import { badgeHtml, loadList } from './list'
import { mapCategory } from '../../../src/lib/investigations/map-spots'
import { agentOptions, invalidate, lookups, personOptions, vehicleOptions } from './lookups'
import {
  agentAvatar,
  agentName,
  badge,
  checklistOf,
  CUSTODY_ACTION,
  ENTRY_KIND,
  EVIDENCE_KIND,
  EVIDENCE_STATUS,
  openRolesOf,
  options,
  PERSON_ROLE,
  personName,
  PRIORITY,
  PRIORITY_TONE,
  STATUS,
  STATUS_TONE,
  type Clip,
  type CorruptionCheckRef,
  type Custody,
  type Detail,
  type Entry,
  type Evidence,
  type HistoryItem,
} from './model'

type Tab = 'overview' | 'timeline' | 'people' | 'evidence' | 'media' | 'team' | 'links' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'timeline', label: 'Chronologie' },
  { id: 'people', label: 'Beteiligte' },
  { id: 'evidence', label: 'Asservate' },
  { id: 'media', label: 'Medien' },
  { id: 'team', label: 'Team' },
  { id: 'links', label: 'Verknüpfungen' },
  { id: 'history', label: 'Verlauf' },
]

let detail: Detail | null = null
let tab: Tab = 'overview'
let onBack: () => void = () => {}
const base = () => `/api/investigations/${detail!.id}`
const canManage = () => can('investigations:manage')

// ── Bausteine ────────────────────────────────────────────────────────

function actionButton(action: string, iconName: IconName, label: string, id = '') {
  return `<fluent-button appearance="subtle" size="small" icon-only title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" data-action="${action}" data-id="${escapeHtml(id)}">${icon(iconName)}</fluent-button>`
}

function sectionHeader(title: string, buttons = '') {
  return `<div class="section-header"><h2 class="type-body-strong">${escapeHtml(title)}</h2><span class="spacer"></span>${buttons}</div>`
}

function commandButton(action: string, iconName: IconName, label: string, primary = false) {
  return `<fluent-button ${primary ? 'appearance="primary"' : 'appearance="subtle"'} data-action="${action}">${icon(iconName).replace('<i ', '<i slot="start" ')}${escapeHtml(label)}</fluent-button>`
}

function empty(text: string) {
  return `<div class="empty small">${escapeHtml(text)}</div>`
}

/** Eigenschaft wie in den Windows-Dateieigenschaften: Beschriftung über dem Wert. */
function prop(label: string, value: string) {
  return `<div class="prop"><span class="type-caption muted">${escapeHtml(label)}</span><span class="prop-value">${value}</span></div>`
}


function date(value: string | null | undefined) {
  return value ? escapeHtml(formatDateTime(new Date(value))) : '–'
}

function text(value: string | null | undefined) {
  return value ? escapeHtml(value) : '<span class="muted">–</span>'
}

/** Speichern mit Rückmeldung und frischen Daten. */
async function mutate(work: () => Promise<unknown>, success: string) {
  try {
    await work()
    toast(success)
    await reload()
  } catch (error) {
    toast(errorText(error), 'error')
  }
}

// ── Kopf ─────────────────────────────────────────────────────────────

function renderHeader(d: Detail) {
  const commands = [
    canManage() ? commandButton('edit-case', 'edit', 'Bearbeiten') : '',
    canManage() ? commandButton('handover', 'personSwap', 'Fallführung übergeben') : '',
    commandButton('open-dashboard', 'open', 'Im Dashboard öffnen'),
    can('investigations:delete') ? commandButton('delete-case', 'delete', 'Löschen') : '',
  ].join('')
  $('inv-detail-header').innerHTML = `
    <nav class="breadcrumb" aria-label="Pfad">
      <button class="crumb" data-action="back">Ermittlungsakten</button>
      <span class="crumb-sep">${icon('chevronRight')}</span>
      <span class="crumb current">${escapeHtml(d.caseNumber)}</span>
    </nav>
    <div class="detail-title">
      <h1 class="type-title">${escapeHtml(d.title)}</h1>
      <div class="case-badges">${badgeHtml(STATUS[d.status], STATUS_TONE[d.status])}${badgeHtml(`Priorität ${PRIORITY[d.priority]}`, PRIORITY_TONE[d.priority])}</div>
    </div>
    <div class="command-bar">${commands}</div>
    <fluent-tablist id="inv-tabs" activeid="tab-${tab}">
      ${TABS.map((t) => `<fluent-tab id="tab-${t.id}" data-tab="${t.id}"><span class="tab-label">${t.label}${tabCount(d, t.id)}</span></fluent-tab>`).join('')}
    </fluent-tablist>`
}

function tabCount(d: Detail, id: Tab) {
  const count = {
    timeline: d.entries.length,
    people: d.persons.length + d.vehicles.length,
    evidence: d.evidence.length,
    media: d.clips.length + d.photos.length,
    team: d.assignees.length + (d.leadAgent ? 1 : 0),
    links: d.linksFrom.length + d.linksTo.length + d.mapSpots.length + d.corruptionChecks.length,
  }[id as string]
  return count ? `<span class="tab-count">${count}</span>` : ''
}

// ── Übersicht ────────────────────────────────────────────────────────

function renderOverview(d: Detail) {
  const checklist = checklistOf(d.checklist)
  const done = checklist.filter((i) => i.done).length
  const roles = openRolesOf(d.openRoles)
  const manage = canManage()
  const stats: [IconName, number, string, Tab][] = [
    ['history', d.entries.length, 'Einträge', 'timeline'],
    ['person', d.persons.length, 'Personen', 'people'],
    ['vehicle', d.vehicles.length, 'Fahrzeuge', 'people'],
    ['box', d.evidence.length, 'Asservate', 'evidence'],
    ['videoClip', d.clips.length, 'Clips', 'media'],
    ['image', d.photos.length, 'Fotos', 'media'],
  ]
  return `
    <div class="stat-strip">
      ${stats.map(([iconName, value, label, target]) => `
        <button class="card stat-tile${value ? '' : ' zero'}" data-goto="${target}">
          <span class="stat-icon">${icon(iconName)}</span>
          <span class="stat-text"><span class="type-subtitle">${value}</span><span class="type-caption muted">${label}</span></span>
        </button>`).join('')}
    </div>
    <div class="two-col">
      <div class="col">
        <div class="card pad">
          ${sectionHeader('Zusammenfassung', manage ? actionButton('edit-case', 'edit', 'Bearbeiten') : '')}
          <p class="prose">${d.summary ? escapeHtml(d.summary) : '<span class="muted">Noch keine Zusammenfassung.</span>'}</p>
        </div>
        <div class="card pad">
          ${sectionHeader(`Arbeitsplan${checklist.length ? ` · ${done}/${checklist.length}` : ''}`)}
          ${checklist.length ? `<div class="progress-line"><span style="width:${(done / checklist.length) * 100}%"></span></div>` : ''}
          <div class="checklist">
            ${checklist.length ? checklist.map((item) => `
              <div class="check-row">
                <fluent-checkbox data-check="${item.id}" ${item.done ? 'checked' : ''} ${manage ? '' : 'disabled'}></fluent-checkbox>
                <span class="${item.done ? 'done' : ''}">${escapeHtml(item.label)}</span>
                ${item.done && item.doneAt ? `<span class="type-caption muted">${date(item.doneAt)}</span>` : ''}
                ${manage ? actionButton('remove-check', 'delete', 'Entfernen', item.id) : ''}
              </div>`).join('') : empty('Kein Arbeitsplan hinterlegt.')}
          </div>
          ${manage ? `<form class="inline-add" data-form="add-check"><span class="inline-add-icon">${icon('add')}</span><input name="label" class="inline-input" placeholder="Punkt zum Arbeitsplan hinzufügen" autocomplete="off" maxlength="200"><fluent-button type="submit" size="small" appearance="primary">Hinzufügen</fluent-button></form>` : ''}
        </div>
        ${roles.length ? `
        <div class="card pad">
          ${sectionHeader('Offene Rollen')}
          ${roles.map((r) => `
            <div class="check-row">
              <span>${icon('person')}</span>
              <span>${escapeHtml(r.label)} <span class="muted type-caption">· ${PERSON_ROLE[r.role] ?? r.role}</span></span>
              <span class="spacer"></span>
              ${manage ? `<fluent-button size="small" data-action="fill-role" data-id="${r.id}">Person zuordnen</fluent-button>${actionButton('drop-role', 'dismiss', 'Verwerfen', r.id)}` : ''}
            </div>`).join('')}
        </div>` : ''}
      </div>
      <div class="col narrow">
        <div class="card pad props">
          ${sectionHeader('Details')}
          ${prop('Fallführung', d.leadAgent ? `
            <span class="lead">
              ${agentAvatar(d.leadAgent, 'small')}
              <span class="agent-name"><span class="truncate">${escapeHtml(agentName(d.leadAgent))}</span><span class="type-caption muted truncate">${escapeHtml(d.leadAgent.rank?.name ?? '')}</span></span>
            </span>` : '<span class="muted">Keine Fallführung</span>')}
          ${prop('Aktenzeichen', escapeHtml(d.caseNumber))}
          ${d.template ? prop('Vorlage', escapeHtml(d.template.name)) : ''}
          ${prop('Angelegt', `${date(d.createdAt)}${d.createdBy ? `<span class="type-caption muted">von ${escapeHtml(d.createdBy.displayName)}</span>` : ''}`)}
          ${prop('Zuletzt geändert', date(d.updatedAt))}
          ${d.closedAt ? prop('Abgeschlossen', date(d.closedAt)) : ''}
        </div>
      </div>
    </div>`
}

// ── Chronologie ──────────────────────────────────────────────────────

function renderTimeline(d: Detail) {
  const entries = [...d.entries].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt))
  const manage = canManage()
  return `
    ${sectionHeader('Chronologie', manage ? commandButton('add-entry', 'add', 'Eintrag hinzufügen', true) : '')}
    <div class="timeline">
      ${entries.length ? entries.map((e) => `
        <article class="card pad timeline-item">
          <div class="timeline-head">
            ${badgeHtml(ENTRY_KIND[e.kind] ?? e.kind, 'brand')}
            <h3 class="type-body-strong">${escapeHtml(e.title)}</h3>
            <span class="spacer"></span>
            ${manage ? actionButton('edit-entry', 'edit', 'Bearbeiten', e.id) + actionButton('delete-entry', 'delete', 'Löschen', e.id) : ''}
          </div>
          <div class="type-caption muted">${date(e.occurredAt)}${e.location ? ` · ${escapeHtml(e.location)}` : ''}${e.createdBy ? ` · erfasst von ${escapeHtml(e.createdBy.displayName)}` : ''}</div>
          ${e.participants.length ? `<div class="chips">${e.participants.map((p) => `<span class="chip">${p.agentId ? agentAvatar({ id: p.agentId, name: p.name }, 'xs') : icon('person')}${escapeHtml(p.name)}${p.badgeNumber ? ` (${escapeHtml(badge(p.badgeNumber))})` : ''}</span>`).join('')}</div>` : ''}
          ${e.content ? `<p class="prose">${escapeHtml(e.content)}</p>` : ''}
          ${e.clips.length ? `<div class="chips">${e.clips.map((c) => `<button class="chip link" data-action="play-clip" data-id="${c.id}">${icon('videoClip')}${escapeHtml(c.title)}</button>`).join('')}</div>` : ''}
        </article>`).join('') : `<div class="card">${empty('Noch keine Einträge in der Chronologie.')}</div>`}
    </div>`
}

async function entryForm(entry?: Entry) {
  const agents = await lookups.agents()
  const current = entry?.participants.filter((p) => p.agentId).map((p) => p.agentId!) ?? []
  await openForm({
    title: entry ? 'Eintrag bearbeiten' : 'Eintrag hinzufügen',
    fields: [
      { name: 'title', label: 'Titel', type: 'text', required: true, span: 2, value: entry?.title, maxLength: 200 },
      { name: 'kind', label: 'Art', type: 'select', options: options(ENTRY_KIND), value: entry?.kind ?? 'OPERATION' },
      { name: 'occurredAt', label: 'Zeitpunkt', type: 'datetime', value: entry?.occurredAt ?? new Date() },
      { name: 'location', label: 'Ort', type: 'text', span: 2, value: entry?.location, maxLength: 200 },
      { name: 'content', label: 'Bericht', type: 'textarea', value: entry?.content },
    ],
    html: `<fluent-field class="participants-field"><label slot="label">Beteiligte Agents</label>
      <fluent-dropdown slot="input" id="entry-participants" multiple placeholder="Agents auswählen">
        <fluent-listbox>${agents.map((a) => `<fluent-option value="${a.id}" ${current.includes(a.id) ? 'selected' : ''}>${escapeHtml(agentName(a))}</fluent-option>`).join('')}</fluent-listbox>
      </fluent-dropdown></fluent-field>`,
    onSubmit: async (values) => {
      const picked = [...document.querySelectorAll<HTMLElement & { selected: boolean; value: string }>('#entry-participants fluent-option')]
        .filter((o) => o.selected)
        .map((o) => agents.find((a) => a.id === o.value)!)
        .filter(Boolean)
      const participants = picked.map((a) => ({ agentId: a.id, name: `${a.firstName} ${a.lastName}`, badgeNumber: a.badgeNumber, rank: a.rank?.name ?? null }))
      // Freie Namen (ohne Agent) bleiben beim Bearbeiten erhalten.
      const external = entry?.participants.filter((p) => !p.agentId) ?? []
      const body = { ...values, participants: [...participants, ...external] }
      if (entry) await api.patch(`/api/investigations/entries/${entry.id}`, body)
      else await api.post(`${base()}/entries`, body)
      toast(entry ? 'Eintrag gespeichert' : 'Eintrag hinzugefügt')
    },
  }) && reload()
}

// ── Beteiligte ───────────────────────────────────────────────────────

function crossHitChips(ids: Record<string, { id: string; caseNumber: string }[]> | undefined, key: string) {
  const hits = ids?.[key] ?? []
  return hits.length ? `<div class="chips">${hits.map((c) => `<button class="chip link" data-action="open-case" data-id="${c.id}">${icon('documentSearch')}Auch in ${escapeHtml(c.caseNumber)}</button>`).join('')}</div>` : ''
}

function renderPeople(d: Detail) {
  const manage = canManage()
  const hits = d.crossHits as { persons?: Record<string, { id: string; caseNumber: string }[]>; vehicles?: Record<string, { id: string; caseNumber: string }[]> } | undefined
  return `
    ${sectionHeader(`Personen · ${d.persons.length}`, manage ? commandButton('new-person', 'personAdd', 'Neue Person') + commandButton('link-person', 'link', 'Person verknüpfen', true) : '')}
    <div class="card list">
      ${d.persons.length ? d.persons.map((link) => {
        const p = link.person
        return `<div class="list-row person-row">
          <span class="avatar large" style="overflow:hidden;position:relative" data-crop="${escapeHtml(JSON.stringify(p.photoCrop ?? { x: 50, y: 50, zoom: 1 }))}" data-photo="${p.photoId ? `/api/investigations/photos/${p.photoId}/image` : p.photoUrl ? escapeHtml(p.photoUrl) : ''}">${escapeHtml(initials(`${p.firstName} ${p.lastName}`))}</span>
          <span class="agent-name">
            <span class="type-body-strong truncate">${escapeHtml(personName(p))}</span>
            <span class="type-caption muted truncate">${escapeHtml(p.personNumber)}${p.identifier ? ` · ${escapeHtml(p.identifier)}` : ''}${p.phone ? ` · ${escapeHtml(p.phone)}` : ''}</span>
            <span class="type-caption">Beruf: ${escapeHtml(p.occupation || 'Nicht erfasst')} · Rang: ${escapeHtml(p.rank || 'Nicht erfasst')}</span>
            ${link.note ? `<span class="type-caption truncate">${escapeHtml(link.note)}</span>` : ''}
            ${crossHitChips(hits?.persons, p.id)}
          </span>
          <span class="case-badges">${badgeHtml(PERSON_ROLE[link.role] ?? link.role, link.role === 'SUSPECT' ? 'danger' : 'subtle')}${p.wanted ? badgeHtml('Gesucht', 'warning') : ''}${p.dangerous ? badgeHtml('Gefährlich', 'danger') : ''}</span>
          <span class="row-actions">${manage ? actionButton('unlink-person', 'dismiss', 'Verknüpfung lösen', link.id) : ''}</span>
        </div>`
      }).join('') : empty('Noch keine Personen verknüpft.')}
    </div>
    ${sectionHeader(`Fahrzeuge · ${d.vehicles.length}`, manage ? commandButton('new-vehicle', 'add', 'Neues Fahrzeug') + commandButton('link-vehicle', 'link', 'Fahrzeug verknüpfen', true) : '')}
    <div class="card list">
      ${d.vehicles.length ? d.vehicles.map((link) => {
        const v = link.vehicle
        return `<div class="list-row person-row">
          <span class="avatar large square">${icon('vehicle')}</span>
          <span class="agent-name">
            <span class="type-body-strong truncate">${escapeHtml(v.plate ?? 'Ohne Kennzeichen')} <span class="muted">· ${escapeHtml([v.model, v.color].filter(Boolean).join(', ') || 'unbekannt')}</span></span>
            <span class="type-caption muted truncate">${escapeHtml(v.vehicleNumber)}${v.ownerPerson ? ` · Halter: ${escapeHtml(personName(v.ownerPerson))}` : ''}</span>
            ${link.note ? `<span class="type-caption truncate">${escapeHtml(link.note)}</span>` : ''}
            ${crossHitChips(hits?.vehicles, v.id)}
          </span>
          <span class="case-badges">${v.stolen ? badgeHtml('Gestohlen', 'warning') : ''}${v.wanted ? badgeHtml('Gesucht', 'danger') : ''}</span>
          <span class="row-actions">${manage ? actionButton('unlink-vehicle', 'dismiss', 'Verknüpfung lösen', link.id) : ''}</span>
        </div>`
      }).join('') : empty('Noch keine Fahrzeuge verknüpft.')}
    </div>`
}

const personFields = (): Field[] => [
  { name: 'firstName', label: 'Vorname', type: 'text', required: true },
  { name: 'lastName', label: 'Nachname', type: 'text', required: true },
  { name: 'alias', label: 'Alias', type: 'text' },
  { name: 'occupation', label: 'Beruf / Tätigkeit', type: 'text', maxLength: 120 },
  { name: 'organization', label: 'Organisation / Arbeitgeber', type: 'text', maxLength: 120 },
  { name: 'rank', label: 'Rang / Position', type: 'text', maxLength: 120 },
  { name: 'identifier', label: 'Ausweis / Kennung', type: 'text' },
  { name: 'phone', label: 'Telefon', type: 'text' },
  { name: 'dateOfBirth', label: 'Geburtsdatum', type: 'datetime' },
  { name: 'wanted', label: 'Zur Fahndung ausgeschrieben', type: 'checkbox' },
  { name: 'dangerous', label: 'Gefährlich', type: 'checkbox' },
  { name: 'notes', label: 'Notizen', type: 'textarea' },
]

const roleFields = (): Field[] => [
  { name: 'role', label: 'Rolle in der Akte', type: 'select', options: options(PERSON_ROLE), value: 'SUSPECT' },
  { name: 'note', label: 'Notiz zur Rolle', type: 'text' },
]

async function linkPerson(roleId?: string) {
  const persons = await personOptions()
  await openForm({
    title: roleId ? 'Person der Rolle zuordnen' : 'Person verknüpfen',
    description: 'Person aus dem Personenregister wählen. Neue Personen legst du über „Neue Person“ an.',
    fields: [
      { name: 'personId', label: 'Person', type: 'combobox', options: persons, required: true, span: 2, placeholder: 'Name oder Nummer suchen …' },
      ...(roleId ? [{ name: 'note', label: 'Notiz', type: 'text' as const }] : roleFields()),
    ],
    onSubmit: async (values) => {
      if (roleId) await api.post(`${base()}/open-roles`, { roleId, ...values })
      else await api.post(`${base()}/persons`, values)
      toast('Person verknüpft')
    },
  }) && reload()
}

async function newPerson() {
  await openForm({
    title: 'Neue Person anlegen',
    description: 'Die Person wird im Register angelegt und direkt mit dieser Akte verknüpft.',
    fields: [...personFields(), ...roleFields()],
    onSubmit: async ({ role, note, ...person }) => {
      const created = await api.post<{ id: string }>('/api/persons', person)
      await api.post(`${base()}/persons`, { personId: created.id, role, note })
      invalidate('persons')
      toast('Person angelegt und verknüpft')
    },
  }) && reload()
}

async function linkVehicle() {
  const vehicles = await vehicleOptions()
  await openForm({
    title: 'Fahrzeug verknüpfen',
    fields: [
      { name: 'vehicleId', label: 'Fahrzeug', type: 'combobox', options: vehicles, required: true, span: 2, placeholder: 'Kennzeichen oder Modell suchen …' },
      { name: 'note', label: 'Notiz', type: 'text', span: 2 },
    ],
    onSubmit: async (values) => {
      await api.post(`${base()}/vehicles`, values)
      toast('Fahrzeug verknüpft')
    },
  }) && reload()
}

async function newVehicle() {
  const persons = await personOptions()
  await openForm({
    title: 'Neues Fahrzeug anlegen',
    description: 'Das Fahrzeug wird im Register angelegt und direkt mit dieser Akte verknüpft.',
    fields: [
      { name: 'plate', label: 'Kennzeichen', type: 'text' },
      { name: 'model', label: 'Modell', type: 'text' },
      { name: 'color', label: 'Farbe', type: 'text' },
      { name: 'ownerPersonId', label: 'Halter', type: 'combobox', options: persons },
      { name: 'stolen', label: 'Als gestohlen gemeldet', type: 'checkbox' },
      { name: 'wanted', label: 'Zur Fahndung ausgeschrieben', type: 'checkbox' },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
      { name: 'linkNote', label: 'Notiz zur Verknüpfung', type: 'text', span: 2 },
    ],
    onSubmit: async ({ linkNote, ...vehicle }) => {
      const created = await api.post<{ id: string }>('/api/vehicles', vehicle)
      await api.post(`${base()}/vehicles`, { vehicleId: created.id, note: linkNote })
      invalidate('vehicles')
      toast('Fahrzeug angelegt und verknüpft')
    },
  }) && reload()
}

// ── Asservate ────────────────────────────────────────────────────────

function renderEvidence(d: Detail) {
  const manage = canManage()
  return `
    ${sectionHeader(`Asservate · ${d.evidence.length}`, manage ? commandButton('add-evidence', 'add', 'Asservat erfassen', true) : '')}
    <div class="card list">
      ${d.evidence.length ? d.evidence.map((e) => `
        <div class="list-row evidence-row">
          <span class="avatar large square">${icon('box')}</span>
          <span class="agent-name">
            <span class="type-body-strong truncate">${escapeHtml(e.title)}${e.quantity ? ` <span class="muted">× ${e.quantity}</span>` : ''}</span>
            <span class="type-caption muted truncate">${escapeHtml(e.itemNumber)} · ${escapeHtml(EVIDENCE_KIND[e.kind] ?? e.kind)}${e.storageLocation ? ` · Lagerort ${escapeHtml(e.storageLocation)}` : ''}</span>
            <span class="type-caption muted truncate">Sichergestellt ${date(e.seizedAt)}${e.seizedLocation ? ` · ${escapeHtml(e.seizedLocation)}` : ''}${e.seizedByAgent ? ` · ${escapeHtml(agentName(e.seizedByAgent))}` : ''}</span>
          </span>
          <span class="case-badges">${badgeHtml(EVIDENCE_STATUS[e.status] ?? e.status, e.status === 'SECURED' ? 'success' : e.status === 'IN_ANALYSIS' ? 'brand' : 'subtle')}</span>
          <span class="row-actions">
            ${actionButton('custody', 'history', 'Übergabekette', e.id)}
            ${manage ? actionButton('transfer-evidence', 'personSwap', 'Übergeben', e.id) + actionButton('edit-evidence', 'edit', 'Bearbeiten', e.id) + actionButton('delete-evidence', 'delete', 'Löschen', e.id) : ''}
          </span>
        </div>`).join('') : empty('Noch keine Asservate erfasst.')}
    </div>`
}

async function evidenceForm(evidence?: Evidence) {
  const agents = await agentOptions()
  const d = detail!
  await openForm({
    title: evidence ? `${evidence.itemNumber} bearbeiten` : 'Asservat erfassen',
    fields: [
      { name: 'title', label: 'Bezeichnung', type: 'text', required: true, span: 2, value: evidence?.title },
      { name: 'kind', label: 'Art', type: 'select', options: options(EVIDENCE_KIND), value: evidence?.kind ?? 'OTHER' },
      { name: 'status', label: 'Status', type: 'select', options: options(EVIDENCE_STATUS), value: evidence?.status ?? 'SECURED' },
      { name: 'quantity', label: 'Menge', type: 'number', value: evidence?.quantity },
      { name: 'seizedAt', label: 'Sichergestellt am', type: 'datetime', value: evidence?.seizedAt ?? new Date() },
      { name: 'seizedLocation', label: 'Fundort', type: 'text', value: evidence?.seizedLocation },
      { name: 'storageLocation', label: 'Lagerort', type: 'text', value: evidence?.storageLocation },
      { name: 'seizedByAgentId', label: 'Sichergestellt von', type: 'combobox', options: agents, value: evidence?.seizedByAgent?.id ?? state.context?.ownAgent?.id },
      { name: 'entryId', label: 'Zu Eintrag', type: 'select', options: [{ value: '', label: 'Keinem Eintrag zugeordnet' }, ...d.entries.map((e) => ({ value: e.id, label: e.title }))], value: evidence?.entry?.id ?? '' },
      { name: 'description', label: 'Beschreibung', type: 'textarea', value: evidence?.description },
    ],
    onSubmit: async (values) => {
      const body = { ...values, quantity: values.quantity ? Number(values.quantity) : null }
      if (evidence) await api.patch(`/api/investigations/evidence/${evidence.id}`, body)
      else await api.post(`${base()}/evidence`, body)
      toast(evidence ? 'Asservat gespeichert' : 'Asservat erfasst')
    },
  }) && reload()
}

async function transferEvidence(evidence: Evidence) {
  const agents = await agentOptions()
  await openForm({
    title: `${evidence.itemNumber} übergeben`,
    description: 'Jede Übergabe wird fälschungssicher in der Übergabekette festgehalten.',
    fields: [
      { name: 'toAgentId', label: 'An Agent', type: 'combobox', options: agents, span: 2 },
      { name: 'toHolder', label: 'Oder an (frei)', type: 'text', span: 2, hint: 'z. B. Labor, Staatsanwaltschaft – nur ohne Agent ausfüllen' },
      { name: 'location', label: 'Ort', type: 'text', span: 2 },
      { name: 'note', label: 'Notiz', type: 'textarea' },
    ],
    submitLabel: 'Übergeben',
    onSubmit: async (values) => {
      if (!values.toAgentId && !values.toHolder) throw new Error('Bitte einen Agent oder Empfänger angeben.')
      await api.post(`/api/investigations/evidence/${evidence.id}/custody`, values)
      toast('Übergabe festgehalten')
    },
  }) && reload()
}

async function showCustody(evidence: Evidence) {
  const custody = await api.get<Custody>(`/api/investigations/evidence/${evidence.id}/custody?log=1`)
  const rows = custody.events
    .map((e) => `
      <div class="custody-row">
        <span class="type-body-strong">${escapeHtml(CUSTODY_ACTION[e.action] ?? e.action)}</span>
        <span class="type-caption muted">${date(e.createdAt)}${e.actorName ? ` · ${escapeHtml(e.actorName)}` : ''}</span>
        ${e.toHolder ? `<span class="type-caption">${e.fromHolder ? `${escapeHtml(e.fromHolder)} → ` : ''}${escapeHtml(e.toHolder)}</span>` : ''}
        ${e.location ? `<span class="type-caption muted">Ort: ${escapeHtml(e.location)}</span>` : ''}
        ${e.note ? `<span class="type-caption">${escapeHtml(e.note)}</span>` : ''}
      </div>`)
    .join('')
  await openForm({
    title: `Übergabekette ${evidence.itemNumber}`,
    description: custody.currentHolder ? `Aktuell bei: ${custody.currentHolder}` : undefined,
    html: `<div class="custody-list">${rows || empty('Noch keine Einträge.')}</div>`,
    fields: [],
    readOnly: true,
    onSubmit: async () => {},
  })
}

// ── Medien ───────────────────────────────────────────────────────────

function renderMedia(d: Detail) {
  const manage = canManage()
  return `
    ${sectionHeader(`Bodycam-Clips · ${d.clips.length}`, manage ? commandButton('upload-clip', 'arrowUpload', 'Clip hochladen', true) : '')}
    <div class="card list">
      ${d.clips.length ? d.clips.map((c) => `
        <div class="list-row clip-row">
          <button class="clip-thumb" data-action="play-clip" data-id="${c.id}" aria-label="Abspielen">${icon('play')}</button>
          <span class="agent-name">
            <span class="type-body-strong truncate">${escapeHtml(c.title)}</span>
            <span class="type-caption muted truncate">${date(c.recordedAt ?? c.createdAt)}${c.durationSeconds ? ` · ${formatClock(c.durationSeconds)}` : ''} · ${formatBytes(c.sizeBytes)}${c.location ? ` · ${escapeHtml(c.location)}` : ''}</span>
            <span class="type-caption muted truncate">${c.recordedByAgent ? `Bodycam von ${escapeHtml(agentName(c.recordedByAgent))}` : ''}${c.entry ? ` · Eintrag „${escapeHtml(c.entry.title)}“` : ''}</span>
            ${c.tags.length ? `<div class="chips">${c.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          </span>
          <span class="case-badges">${c.compressionStatus === 'PENDING' || c.compressionStatus === 'PROCESSING' ? badgeHtml('Wird komprimiert', 'brand') : ''}</span>
          <span class="row-actions">${manage ? actionButton('edit-clip', 'edit', 'Bearbeiten', c.id) + actionButton('delete-clip', 'delete', 'Löschen', c.id) : ''}</span>
        </div>`).join('') : empty('Noch keine Clips. Über die Bodycam lassen sich Clips direkt in diese Akte hochladen.')}
    </div>
    ${sectionHeader(`Fotos · ${d.photos.length}`)}
    ${d.photos.length ? `<div class="photo-grid">${d.photos.map((p) => `
      <button class="photo-tile" data-action="view-photo" data-id="${p.id}" title="${escapeHtml(p.title)}">
        <span class="photo-frame"><img data-src="/api/investigations/photos/${p.id}/image" alt=""></span>
        <span class="type-caption truncate">${escapeHtml(p.title)}</span>
      </button>`).join('')}</div>` : `<div class="card">${empty('Keine Fotos verknüpft.')}</div>`}`
}

async function clipForm(clip: Clip) {
  const [agents, d] = [await agentOptions(), detail!]
  await openForm({
    title: 'Clip bearbeiten',
    fields: [
      { name: 'title', label: 'Titel', type: 'text', required: true, span: 2, value: clip.title },
      { name: 'recordedAt', label: 'Aufgenommen', type: 'datetime', value: clip.recordedAt },
      { name: 'location', label: 'Ort', type: 'text', value: clip.location },
      { name: 'recordedByAgentId', label: 'Bodycam von', type: 'combobox', options: agents, value: clip.recordedByAgent?.id },
      { name: 'entryId', label: 'Zu Eintrag', type: 'select', options: [{ value: '', label: 'Keinem Eintrag zugeordnet' }, ...d.entries.map((e) => ({ value: e.id, label: e.title }))], value: clip.entry?.id ?? '' },
      { name: 'tags', label: 'Stichworte', type: 'text', span: 2, value: clip.tags.join(', '), hint: 'Mit Komma trennen' },
      { name: 'description', label: 'Beschreibung', type: 'textarea', value: clip.description },
    ],
    onSubmit: async (values) => {
      const tags = String(values.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
      await api.patch(`/api/investigations/clips/${clip.id}`, { ...values, tags })
      toast('Clip gespeichert')
    },
  }) && reload()
}

async function loadPhotos(root: HTMLElement) {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-src]')) {
    const path = img.dataset.src!
    img.removeAttribute('data-src')
    api.image(path).then((url) => (img.src = url)).catch(() => {
      img.closest('.photo-tile')?.classList.add('missing')
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'photo-missing', innerHTML: `${icon('imageOff')}<span>Bild nicht verfügbar</span>` }))
    })
  }
  // Personenfotos: Dashboard-Pfade über die App laden, externe Links direkt.
  for (const avatar of root.querySelectorAll<HTMLElement>('.avatar[data-photo]')) {
    const url = avatar.dataset.photo
    avatar.removeAttribute('data-photo')
    if (!url) continue
    const apply = (src: string) => {
      const crop = JSON.parse(avatar.dataset.crop || '{"x":50,"y":50,"zoom":1}')
      const img = document.createElement('img')
      img.className = 'avatar-img'
      img.alt = ''
      Object.assign(img.style, { objectPosition: `${crop.x}% ${crop.y}%`, transform: `scale(${crop.zoom})`, transformOrigin: `${crop.x}% ${crop.y}%` })
      img.src = src
      avatar.append(img)
    }
    if (url.startsWith('/api/')) api.image(url).then(apply).catch(() => {})
    else if (url.startsWith('https://')) apply(url)
  }
}

async function viewPhoto(id: string) {
  const photo = detail!.photos.find((p) => p.id === id)
  let url: string
  try {
    url = await api.image(`/api/investigations/photos/${id}/image`)
  } catch (error) {
    return toast(`Bild nicht verfügbar: ${errorText(error)}`, 'error')
  }
  await openForm({ title: photo?.title ?? 'Foto', html: `<img class="photo-large" src="${url}" alt="">`, fields: [], readOnly: true, onSubmit: async () => {} })
}

// ── Team ─────────────────────────────────────────────────────────────

function renderTeam(d: Detail) {
  const manage = canManage()
  return `
    ${sectionHeader('Fallführung', manage ? commandButton('handover', 'personSwap', 'Übergeben') : '')}
    <div class="card list">
      ${d.leadAgent ? `<div class="list-row person-row">
        ${agentAvatar(d.leadAgent)}
        <span class="agent-name"><span class="type-body-strong">${escapeHtml(agentName(d.leadAgent))}</span><span class="type-caption muted">${escapeHtml(d.leadAgent.rank?.name ?? '')}</span></span>
        <span></span><span></span>
      </div>` : empty('Keine Fallführung festgelegt.')}
    </div>
    ${sectionHeader(`Mitarbeitende · ${d.assignees.length}`, manage ? commandButton('add-assignee', 'personAdd', 'Hinzufügen', true) : '')}
    <div class="card list">
      ${d.assignees.length ? d.assignees.map((a) => `
        <div class="list-row person-row">
          ${agentAvatar(a.agent)}
          <span class="agent-name">
            <span class="type-body-strong truncate">${escapeHtml(agentName(a.agent))}</span>
            <span class="type-caption muted truncate">${escapeHtml(a.agent.rank?.name ?? '')}${a.addedBy ? ` · hinzugefügt von ${escapeHtml(a.addedBy.displayName)}` : ''}</span>
          </span>
          <span class="type-caption muted">${date(a.createdAt)}</span>
          <span class="row-actions">${manage ? actionButton('remove-assignee', 'dismiss', 'Entfernen', a.id) : ''}</span>
        </div>`).join('') : empty('Noch niemand zugewiesen.')}
    </div>`
}

async function handover() {
  const agents = await agentOptions()
  await openForm({
    title: 'Fallführung übergeben',
    fields: [
      { name: 'leadAgentId', label: 'Neue Fallführung', type: 'combobox', options: agents, required: true, span: 2 },
      { name: 'keepPreviousAsAssignee', label: 'Bisherige Fallführung bleibt im Team', type: 'checkbox', value: true, span: 2 },
      { name: 'note', label: 'Übergabevermerk', type: 'textarea' },
    ],
    submitLabel: 'Übergeben',
    onSubmit: async (values) => {
      await api.post(`${base()}/handover`, values)
      toast('Fallführung übergeben')
    },
  }) && reload()
}

// ── Verknüpfungen ────────────────────────────────────────────────────

function corruptionRow(check: CorruptionCheckRef, manage: boolean) {
  const findings = check.result === 'FINDINGS'
  return `
    <div class="list-row person-row">
      <span class="avatar large square">${icon('shieldTask')}</span>
      <button class="agent-name link-button" data-action="open-corruption" data-id="${check.official.id}">
        <span class="type-body-strong truncate">${escapeHtml(`${check.official.firstName} ${check.official.lastName}`)} · ${escapeHtml(check.official.agency)}</span>
        <span class="type-caption muted truncate">${date(check.conductedAt)}${check.location ? ` · ${escapeHtml(check.location)}` : ''}</span>
      </button>
      <span class="case-badges">${badgeHtml(findings ? 'Befund' : 'Ohne Befund', findings ? 'danger' : 'success')}</span>
      <span class="row-actions">${manage ? actionButton('unlink-corruption', 'dismiss', 'Verknüpfung lösen', check.id) : ''}</span>
    </div>`
}

function renderLinks(d: Detail) {
  const manage = canManage()
  const pickSpots = manage && can('map:view')
  const checks = d.corruptionChecks.map((link) => link.check)
  const places = `
    ${sectionHeader(`Einsatzorte · ${d.mapSpots.length}`, pickSpots ? commandButton('pick-spots', 'location', 'Ort auf Karte wählen', !d.mapSpots.length) : '')}
    <div class="card pad case-places">
      ${d.mapSpots.length ? `
        <div class="case-map" data-case-map></div>
        <div class="chips">${d.mapSpots.map((spot) => `<button class="chip" data-action="focus-spot" data-id="${spot.id}"><span class="map-dot" style="background:${mapCategory(spot.category).hex}"></span>${escapeHtml(spot.title)}</button>`).join('')}</div>`
        : empty(pickSpots ? 'Noch kein Einsatzort. Wähle den Ort direkt auf der Karte.' : 'Noch kein Einsatzort hinterlegt.')}
    </div>
    ${sectionHeader(`Korruptionskontrollen · ${checks.length}`, manage ? commandButton('link-corruption', 'shieldTask', 'Kontrolle anknüpfen') : '')}
    <div class="card list">${checks.length ? checks.map((check) => corruptionRow(check, manage)).join('') : empty('Keine Korruptionskontrolle verknüpft.')}</div>`
  const linked = [
    ...d.linksFrom.filter((l) => l.to).map((l) => ({ id: l.id, note: l.note, other: l.to! })),
    ...d.linksTo.filter((l) => l.from).map((l) => ({ id: l.id, note: l.note, other: l.from! })),
  ]
  return `
    ${sectionHeader(`Verknüpfte Akten · ${linked.length}`, manage ? commandButton('add-link', 'link', 'Akte verknüpfen', true) : '')}
    <div class="card list">
      ${linked.length ? linked.map((l) => `
        <div class="list-row person-row">
          <span class="avatar large square">${icon('documentSearch')}</span>
          <button class="agent-name link-button" data-action="open-case" data-id="${l.other.id}">
            <span class="type-body-strong truncate">${escapeHtml(l.other.caseNumber)} · ${escapeHtml(l.other.title)}</span>
            ${l.note ? `<span class="type-caption muted truncate">${escapeHtml(l.note)}</span>` : ''}
          </button>
          <span class="case-badges">${badgeHtml(STATUS[l.other.status], STATUS_TONE[l.other.status])}</span>
          <span class="row-actions">${manage ? actionButton('remove-link', 'dismiss', 'Verknüpfung lösen', l.id) : ''}</span>
        </div>`).join('') : empty('Keine verknüpften Akten.')}
    </div>
    ${places}`
}

let caseMap: ReturnType<typeof createCityMap> | null = null

function mountCaseMap(container: HTMLElement) {
  const host = container.querySelector<HTMLElement>('[data-case-map]')
  caseMap = host && detail ? createCityMap(host) : null
  caseMap?.setPins(detail!.mapSpots.map((spot) => spotPin(spot)))
}

async function pickSpots() {
  const d = detail!
  const ids = await pickMapSpots({
    title: `Einsatzort für ${d.caseNumber}`,
    description: 'Wähle einen oder mehrere Orte. Neue Orte erscheinen auch auf der Stadtkarte im Dashboard.',
    selected: d.mapSpots.map((spot) => spot.id),
  })
  if (ids) await mutate(() => api.patch(base(), { mapSpotIds: ids }), 'Einsatzorte gespeichert')
}

/** Neueste Kontrollen; die Auswahl filtert lokal weiter. */
async function linkCorruption() {
  const taken = new Set(detail!.corruptionChecks.map((link) => link.check.id))
  const pages = await Promise.all([1, 2, 3, 4].map((page) => api.get<{ items: CorruptionCheckRef[] }>(`/api/corruption-checks?page=${page}`).catch(() => ({ items: [] }))))
  const checks = pages.flatMap((page) => page.items).filter((check) => !taken.has(check.id))
  if (!checks.length) return toast('Keine weitere Korruptionskontrolle gefunden.', 'info')
  await openForm({
    title: 'Korruptionskontrolle anknüpfen',
    description: 'Die Kontrolle wird Teil dieser Einsatzakte. Zur Auswahl stehen die letzten 100 Kontrollen.',
    fields: [{
      name: 'checkId', label: 'Kontrolle', type: 'combobox', required: true, span: 2,
      options: checks.map((check) => ({
        value: check.id,
        label: `${check.official.firstName} ${check.official.lastName} (${check.official.agency}) · ${formatDateTime(new Date(check.conductedAt))} · ${check.result === 'FINDINGS' ? 'Befund' : 'ohne Befund'}`,
      })),
    }],
    submitLabel: 'Anknüpfen',
    onSubmit: async (values) => {
      await api.post(`${base()}/corruption-checks`, { checkId: values.checkId })
      toast('Korruptionskontrolle verknüpft')
    },
  }) && reload()
}

async function addLink() {
  const cases = (await lookups.cases()).filter((c) => c.id !== detail!.id)
  await openForm({
    title: 'Akte verknüpfen',
    fields: [
      { name: 'toId', label: 'Akte', type: 'combobox', options: cases.map((c) => ({ value: c.id, label: `${c.caseNumber} · ${c.title}` })), required: true, span: 2 },
      { name: 'note', label: 'Zusammenhang', type: 'text', span: 2 },
    ],
    onSubmit: async (values) => {
      await api.post(`${base()}/links`, values)
      toast('Akten verknüpft')
    },
  }) && reload()
}

// ── Verlauf ──────────────────────────────────────────────────────────

async function renderHistory(container: HTMLElement) {
  container.innerHTML = `${sectionHeader('Verlauf')}<div class="card">${empty('Wird geladen …')}</div>`
  try {
    const items = await api.get<HistoryItem[]>(`${base()}/history`)
    container.innerHTML = `${sectionHeader('Verlauf')}<div class="card list">${items.length ? items.map((h) => `
      <div class="history-row">
        <span class="history-dot"></span>
        <span class="agent-name">
          <span class="type-body truncate">${text(h.details)}</span>
          <span class="type-caption muted">${date(h.createdAt)} · ${escapeHtml(h.userName)}</span>
        </span>
      </div>`).join('') : empty('Noch kein Verlauf.')}</div>`
  } catch (error) {
    container.innerHTML = `${sectionHeader('Verlauf')}<div class="card">${empty(errorText(error))}</div>`
  }
}

// ── Steuerung ────────────────────────────────────────────────────────

function renderTab() {
  const d = detail
  const container = $('inv-detail-body')
  if (!d) return
  if (tab === 'history') return void renderHistory(container)
  container.innerHTML = {
    overview: renderOverview,
    timeline: renderTimeline,
    people: renderPeople,
    evidence: renderEvidence,
    media: renderMedia,
    team: renderTeam,
    links: renderLinks,
  }[tab](d)
  if (tab === 'links') mountCaseMap(container)
  void loadPhotos(container)
}

function render() {
  if (!detail) return
  renderHeader(detail)
  renderTab()
}

async function reload() {
  if (!detail) return
  await load(detail.id, false)
}

async function load(id: string, resetTab = true) {
  try {
    detail = await api.get<Detail>(`/api/investigations/${id}`)
    if (resetTab) tab = 'overview'
    render()
  } catch (error) {
    toast(`Akte konnte nicht geladen werden: ${errorText(error)}`, 'error')
  }
}

/** Hintergrund-Aktualisierung der offenen Akte (ohne Meldung, Reiter bleibt). */
export async function refreshOpenCase() {
  if (!detail) return
  const id = detail.id
  const next = await api.get<Detail>(`/api/investigations/${id}`)
  if (detail?.id !== id) return
  detail = next
  render()
}

export async function openCase(id: string) {
  $('inv-list-view').hidden = true
  $('inv-detail-view').hidden = false
  $('inv-detail-header').innerHTML = ''
  $('inv-detail-body').innerHTML = `<div class="empty">Akte wird geladen …</div>`
  $('content').scrollTop = 0
  await load(id)
}

async function handleAction(action: string, id: string) {
  const d = detail
  if (!d) return
  const find = <T extends { id: string }>(list: T[]) => list.find((x) => x.id === id)
  switch (action) {
    case 'back':
      return onBack()
    case 'open-case':
      return openCase(id)
    case 'open-dashboard':
      return backend.openDashboard(`/investigations/${d.id}`)
    case 'edit-case': {
      const agents = await agentOptions()
      return (await openForm({
        title: 'Akte bearbeiten',
        fields: [
          { name: 'title', label: 'Titel', type: 'text', required: true, span: 2, value: d.title, maxLength: 200 },
          { name: 'status', label: 'Status', type: 'select', options: options(STATUS), value: d.status },
          { name: 'priority', label: 'Priorität', type: 'select', options: options(PRIORITY), value: d.priority },
          { name: 'leadAgentId', label: 'Fallführung', type: 'combobox', options: agents, value: d.leadAgent?.id, span: 2 },
          { name: 'summary', label: 'Zusammenfassung', type: 'textarea', value: d.summary },
        ],
        onSubmit: async (values) => {
          await api.patch(base(), values)
          toast('Akte gespeichert')
        },
      })) && (invalidate('cases'), reload())
    }
    case 'delete-case':
      if (!(await confirmAction('Akte löschen?', `${d.caseNumber} „${d.title}“ wird mit allen Einträgen, Clips und Asservaten endgültig gelöscht.`))) return
      try {
        await api.del(base())
        toast(`${d.caseNumber} gelöscht`)
        invalidate('cases')
        detail = null
        return onBack()
      } catch (error) {
        return toast(errorText(error), 'error')
      }
    case 'handover':
      return handover()
    case 'remove-check':
      return mutate(() => api.patch(`${base()}/checklist`, { action: 'remove', itemId: id }), 'Punkt entfernt')
    case 'fill-role':
      return linkPerson(id)
    case 'drop-role':
      if (!(await confirmAction('Rolle verwerfen?', 'Die offene Rolle wird entfernt.', 'Verwerfen'))) return
      return mutate(() => api.del(`${base()}/open-roles`, { roleId: id }), 'Rolle verworfen')
    case 'add-entry':
      return entryForm()
    case 'edit-entry':
      return entryForm(find(d.entries))
    case 'delete-entry':
      if (!(await confirmAction('Eintrag löschen?', `„${find(d.entries)?.title ?? ''}“ wird aus der Chronologie entfernt.`))) return
      return mutate(() => api.del(`/api/investigations/entries/${id}`), 'Eintrag gelöscht')
    case 'link-person':
      return linkPerson()
    case 'new-person':
      return newPerson()
    case 'unlink-person':
      if (!(await confirmAction('Verknüpfung lösen?', 'Die Person bleibt im Register, wird aber von dieser Akte gelöst.', 'Lösen'))) return
      return mutate(() => api.del(`/api/investigations/persons/${id}`), 'Verknüpfung gelöst')
    case 'link-vehicle':
      return linkVehicle()
    case 'new-vehicle':
      return newVehicle()
    case 'unlink-vehicle':
      if (!(await confirmAction('Verknüpfung lösen?', 'Das Fahrzeug bleibt im Register, wird aber von dieser Akte gelöst.', 'Lösen'))) return
      return mutate(() => api.del(`/api/investigations/vehicles/${id}`), 'Verknüpfung gelöst')
    case 'add-evidence':
      return evidenceForm()
    case 'edit-evidence':
      return evidenceForm(find(d.evidence))
    case 'transfer-evidence':
      return transferEvidence(find(d.evidence)!)
    case 'custody':
      return showCustody(find(d.evidence)!)
    case 'delete-evidence':
      if (!(await confirmAction('Asservat löschen?', `${find(d.evidence)?.itemNumber ?? ''} wird gelöscht. Die Übergabekette bleibt protokolliert.`))) return
      return mutate(() => api.del(`/api/investigations/evidence/${id}`), 'Asservat gelöscht')
    case 'play-clip':
      return playClip(find(d.clips) ?? d.entries.flatMap((e) => e.clips).find((c) => c.id === id)!)
    case 'edit-clip':
      return clipForm(find(d.clips)!)
    case 'delete-clip':
      if (!(await confirmAction('Clip löschen?', `„${find(d.clips)?.title ?? ''}“ wird endgültig gelöscht.`))) return
      return mutate(() => api.del(`/api/investigations/clips/${id}`), 'Clip gelöscht')
    case 'upload-clip':
      await backend.rememberInvestigation(d.id)
      if (state.settings) state.settings.settings.lastInvestigationId = d.id
      return navigation.go('bodycam')
    case 'view-photo':
      return viewPhoto(id)
    case 'add-assignee': {
      const taken = new Set([d.leadAgent?.id, ...d.assignees.map((a) => a.agentId)])
      const agents = (await agentOptions()).filter((a) => !taken.has(a.value))
      return (await openForm({
        title: 'Zum Team hinzufügen',
        fields: [{ name: 'agentId', label: 'Agent', type: 'combobox', options: agents, required: true, span: 2 }],
        submitLabel: 'Hinzufügen',
        onSubmit: async (values) => {
          await api.post(`${base()}/assignees`, values)
          toast('Zum Team hinzugefügt')
        },
      })) && reload()
    }
    case 'remove-assignee':
      return mutate(() => api.del(`/api/investigations/assignees/${id}`), 'Aus dem Team entfernt')
    case 'add-link':
      return addLink()
    case 'pick-spots':
      return pickSpots()
    case 'focus-spot':
      return caseMap?.focus(id)
    case 'link-corruption':
      return linkCorruption()
    case 'unlink-corruption':
      if (!(await confirmAction('Kontrolle lösen?', 'Die Korruptionskontrolle bleibt erhalten, gehört aber nicht mehr zu dieser Akte.', 'Lösen'))) return
      return mutate(() => api.del(`${base()}/corruption-checks`, { checkId: id }), 'Verknüpfung gelöst')
    case 'open-corruption':
      return backend.openDashboard(`/corruption-checks?official=${encodeURIComponent(id)}`)
    case 'remove-link':
      if (!(await confirmAction('Verknüpfung lösen?', 'Die beiden Akten sind danach nicht mehr verknüpft.', 'Lösen'))) return
      return mutate(() => api.del(`/api/investigations/links/${id}`), 'Verknüpfung gelöst')
  }
}

export function initDetail(back: () => void) {
  onBack = () => {
    $('inv-detail-view').hidden = true
    $('inv-list-view').hidden = false
    back()
    void loadList()
  }
  const view = $('inv-detail-view')
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
    const box = (event.target as HTMLElement).closest<HTMLElement & { checked: boolean }>('fluent-checkbox[data-check]')
    if (box) void mutate(() => api.patch(`${base()}/checklist`, { action: 'toggle', itemId: box.dataset.check, done: box.checked }), box.checked ? 'Erledigt' : 'Wieder offen')
  })
  view.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form[data-form="add-check"]')
    if (!form) return
    event.preventDefault()
    const label = (form.querySelector<HTMLInputElement>('.inline-input')?.value ?? '').trim()
    if (label) void mutate(() => api.patch(`${base()}/checklist`, { action: 'add', label }), 'Punkt hinzugefügt')
  })
  $('player-dialog').addEventListener('toggle', (event) => {
    if ((event as unknown as CustomEvent<{ newState: string }>).detail?.newState === 'closed') ($('player-dialog-video') as HTMLVideoElement).pause()
  })
}

export function currentCaseId() {
  return detail?.id ?? null
}


import { api, query } from '../api'
import { backend, UNAUTHORIZED } from '../backend'
import { $, errorText, escapeHtml as esc, initials } from '../dom'
import { formatAgo, formatDateTime } from '../format'
import { icon, type IconName } from '../icons'
import { can, navigation, onStateChange, state } from '../store'
import { openForm, confirmAction } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import { createCityMap, type CityMap, type MapPin } from '../ui/city-map'
import { pickMapSpots, spotPin } from '../ui/map-picker'
import { personOptions, vehicleOptions, lookups } from '../investigations/lookups'
import { openCase } from '../investigations/detail'
import { badgeHtml } from '../investigations/list'
import { PRIORITY, PRIORITY_TONE, STATUS, STATUS_TONE, type MapSpotRef } from '../investigations/model'
import { mapCategory } from '../../../src/lib/investigations/map-spots'
import { DOSSIER_SORTS, OPEN_INVESTIGATION_STATUSES } from '../../../src/lib/investigations/dossiers'

type StatusKey = keyof typeof STATUS
type PriorityKey = keyof typeof PRIORITY
interface Person { id: string; firstName: string; lastName: string; personNumber?: string }
interface Case {
  id: string; caseNumber: string; title: string; status: StatusKey; priority: PriorityKey; updatedAt: string
  mapSpots?: MapSpotRef[]
}
interface Family {
  id: string; title: string; description: string | null; address: string | null; leaderId: string | null
  leader: Person | null; photo?: { id: string } | null; createdAt: string; updatedAt: string
  openInvestigations?: number; lastActivityAt?: string
  persons?: Person[]; mapSpots?: MapSpotRef[]; investigations?: Case[]
  vehicles?: { id: string; vehicleNumber: string; plate: string | null; model: string | null }[]
  _count?: { persons: number; investigations: number; mapSpots: number; vehicles: number }
}
type Tab = 'overview' | 'map' | 'cases' | 'members'

const PAGE_SIZE = 30
const base = '/api/investigations/dossiers'
const OPEN = new Set<string>(OPEN_INVESTIGATION_STATUSES)

let current: Family | null = null
let tab: Tab = 'overview'
let page = 1
let revision = 0
let timer: number | undefined
let busy = false
let account: string | undefined
let familyMap: CityMap | null = null
/** Auf der Einsatzkarte gewählter Ort; hebt die Akten an diesem Ort hervor. */
let focusedSpot: string | null = null

const name = (person: Person) => `${person.firstName} ${person.lastName}`
const manage = () => can('investigations:manage')
const canPick = () => manage() && can('map:view')
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function command(action: string, iconName: IconName, label: string, primary = false, id = '') {
  return `<fluent-button ${primary ? 'appearance="primary"' : 'appearance="subtle"'} data-action="${action}" data-id="${esc(id)}">${icon(iconName).replace('<i ', '<i slot="start" ')}${esc(label)}</fluent-button>`
}
function iconButton(action: string, iconName: IconName, label: string, id = '') {
  return `<fluent-button appearance="subtle" size="small" icon-only title="${esc(label)}" aria-label="${esc(label)}" data-action="${action}" data-id="${esc(id)}">${icon(iconName)}</fluent-button>`
}
function sectionHeader(title: string, buttons = '') {
  return `<div class="section-header"><h2 class="type-body-strong">${esc(title)}</h2><span class="spacer"></span>${buttons}</div>`
}
function empty(text: string, iconName?: IconName) {
  return `<div class="empty small">${iconName ? icon(iconName) : ''}<span>${esc(text)}</span></div>`
}
function prop(label: string, value: string) {
  return `<div class="prop"><span class="type-caption muted">${esc(label)}</span><span class="prop-value">${value}</span></div>`
}
function monogram(family: Family, size: 'large' | 'xl') {
  return `<span class="family-mark ${size}"${family.photo ? ` data-family-photo="${esc(family.photo.id)}"` : ''}><span>${esc(initials(family.title))}</span></span>`
}
const statusPill = (status: StatusKey) => badgeHtml(STATUS[status] ?? status, STATUS_TONE[status] ?? 'subtle')

function failure(error: unknown) {
  if (errorText(error) === UNAUTHORIZED) return navigation.signOut()
  $('families-error').textContent = errorText(error)
  $('families-error').hidden = false
}

async function loadPhotos(root: HTMLElement) {
  await Promise.all([...root.querySelectorAll<HTMLElement>('[data-family-photo]')].map(async (mark) => {
    try {
      const src = await api.image(`/api/investigations/photos/${encodeURIComponent(mark.dataset.familyPhoto!)}/image`)
      mark.style.backgroundImage = `url("${src}")`
      mark.classList.add('has-photo')
    } catch { /* Monogramm bleibt stehen. */ }
  }))
}

// ── Aufbau ───────────────────────────────────────────────────────────

export function initFamilies() {
  $('families-root').innerHTML = `
    <div id="families-list-view">
      <header class="page-header row">
        <div><h1 class="type-title">Familienregister</h1><p class="type-body muted" id="families-count">Familien, Fraktionen, Anwesen und ihre Einsatzakten.</p></div>
      </header>
      <div class="toolbar">
        <fluent-text-input id="families-search" placeholder="Familie, Leiter, Mitglied oder Anwesen"><i data-icon="search" slot="start">${icon('search')}</i></fluent-text-input>
        <select id="families-sort" class="native-input family-sort" aria-label="Sortierung">${Object.entries(DOSSIER_SORTS).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select>
        <span class="spacer"></span>
        ${iconButton('refresh', 'arrowSync', 'Aktualisieren')}
        <span data-manage>${command('new', 'add', 'Neue Familienakte', true)}</span>
      </div>
    </div>
    <div id="families-detail-view" hidden><div id="families-detail-header" class="detail-header"></div></div>
    <fluent-message-bar id="families-error" intent="error" hidden></fluent-message-bar>
    <div id="families-content" aria-live="polite"></div>
    <div id="families-pagination" class="family-pagination" hidden>
      ${iconButton('prev', 'chevronRight', 'Vorherige Seite')}<span id="families-page" class="type-caption muted"></span>${iconButton('next', 'chevronRight', 'Nächste Seite')}
    </div>`
  $('families-search').addEventListener('input', () => {
    window.clearTimeout(timer)
    ++revision
    timer = window.setTimeout(() => { page = 1; void loadList() }, 250)
  })
  $('families-sort').addEventListener('change', () => { page = 1; void loadList() })
  $('families-root').addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const tabEl = target.closest<HTMLElement>('fluent-tab[data-tab]')
    if (tabEl) { tab = tabEl.dataset.tab as Tab; return renderBody() }
    const goto = target.closest<HTMLElement>('[data-goto]')
    if (goto) { tab = goto.dataset.goto as Tab; return renderDetail() }
    const button = target.closest<HTMLElement>('[data-action]')
    if (!button || busy) return
    busy = true
    void action(button.dataset.action!, button.dataset.id ?? '').catch(failure).finally(() => { busy = false })
  })
  onStateChange(() => {
    const nextAccount = state.context?.user.id ?? state.context?.user.displayName
    if (account === nextAccount) return
    account = nextAccount
    window.clearTimeout(timer)
    ++revision
    current = null
    page = 1
    $('families-content').replaceChildren()
    ;($('families-search') as HTMLElement & { value: string }).value = ''
  })
}

function showView(detail: boolean) {
  $('families-error').hidden = true
  $('families-list-view').hidden = detail
  $('families-detail-view').hidden = !detail
  $('families-pagination').hidden = true
  for (const el of $('families-root').querySelectorAll<HTMLElement>('[data-manage]')) el.hidden = !manage()
}

// ── Liste ────────────────────────────────────────────────────────────

function tile(item: Family) {
  const open = item.openInvestigations ?? 0
  return `
    <button class="card family-tile" data-action="open" data-id="${esc(item.id)}">
      <span class="family-tile-head">
        ${monogram(item, 'large')}
        <span class="family-tile-title">
          <span class="type-subtitle truncate">${esc(item.title)}</span>
          <span class="type-caption muted truncate">${item.leader ? `Leitung: ${esc(name(item.leader))}` : 'Keine Leitung erfasst'}</span>
        </span>
        ${open ? badgeHtml(plural(open, 'offene Akte', 'offene Akten'), 'warning') : ''}
      </span>
      <span class="family-tile-address type-caption ${item.address ? '' : 'muted'}">${icon('homePerson')}<span class="truncate">${esc(item.address || 'Kein Anwesen erfasst')}</span></span>
      <span class="family-tile-stats type-caption muted">
        <span>${icon('peopleTeam')}${item._count?.persons ?? 0}</span>
        <span>${icon('documentSearch')}${item._count?.investigations ?? 0}</span>
        <span>${icon('location')}${item._count?.mapSpots ?? 0}</span>
        <span class="spacer"></span>
        ${item.lastActivityAt ? `<span>${esc(formatAgo(new Date(item.lastActivityAt)))}</span>` : ''}
      </span>
    </button>`
}

async function loadList() {
  current = null
  familyMap = null
  showView(false)
  $('families-content').className = ''
  const request = ++revision
  if (!$('families-content').querySelector('.family-grid')) $('families-content').innerHTML = `<div class="family-grid">${'<div class="card family-tile skeleton"></div>'.repeat(6)}</div>`
  try {
    const search = ($('families-search') as HTMLElement & { value: string }).value.trim()
    const sort = ($('families-sort') as HTMLSelectElement).value
    const result = await api.get<{ items: Family[]; total: number }>(base + query({ search, sort, page: String(page) }))
    if (request !== revision) return
    $('families-count').textContent = `${plural(result.total, 'Familie', 'Familien')} im Register`
    $('families-content').innerHTML = result.items.length
      ? `<div class="family-grid">${result.items.map(tile).join('')}</div>`
      : `<div class="card">${empty(search ? 'Keine Familienakte passt zur Suche.' : 'Noch keine Familienakte angelegt.', 'peopleTeam')}</div>`
    void loadPhotos($('families-content'))
    const pages = Math.ceil(result.total / PAGE_SIZE)
    $('families-pagination').hidden = pages <= 1
    $('families-page').textContent = `Seite ${page} von ${pages}`
    for (const [key, disabled] of [['prev', page === 1], ['next', page >= pages]] as const) {
      ($('families-pagination').querySelector(`[data-action="${key}"]`) as HTMLElement & { disabled: boolean }).disabled = disabled
    }
  } catch (error) {
    if (request === revision) { $('families-content').replaceChildren(); failure(error) }
  }
}

// ── Familienakte ─────────────────────────────────────────────────────

export async function openFamily(id: string, resetTab = true) {
  window.clearTimeout(timer)
  const request = ++revision
  if (resetTab || current?.id !== id) { tab = 'overview'; focusedSpot = null }
  showView(true)
  if (current?.id !== id) {
    $('families-detail-header').innerHTML = ''
    $('families-content').innerHTML = `<div class="card">${empty('Familienakte wird geladen …')}</div>`
  }
  try {
    const item = await api.get<Family>(`${base}/${encodeURIComponent(id)}`)
    if (request !== revision) return
    current = item
    renderDetail()
  } catch (error) {
    if (request === revision) { $('families-content').replaceChildren(); failure(error) }
  }
}

function renderDetail() {
  const item = current
  if (!item) return
  const cases = item.investigations ?? []
  const open = cases.filter((entry) => OPEN.has(entry.status)).length
  const tabs: [Tab, string, number][] = [
    ['overview', 'Übersicht', 0],
    ['map', 'Einsatzkarte', placesOf(item).length],
    ['cases', 'Einsatzakten', cases.length],
    ['members', 'Mitglieder & Fahrzeuge', (item.persons?.length ?? 0) + (item.vehicles?.length ?? 0)],
  ]
  $('families-detail-header').innerHTML = `
    <nav class="breadcrumb" aria-label="Pfad">
      <button class="crumb" data-action="back">Familienregister</button>
      <span class="crumb-sep">${icon('chevronRight')}</span>
      <span class="crumb current">${esc(item.title)}</span>
    </nav>
    <div class="family-title">
      ${monogram(item, 'xl')}
      <div class="family-title-text">
        <h1 class="type-title">${esc(item.title)}</h1>
        <div class="case-badges">
          ${open ? badgeHtml(plural(open, 'offene Akte', 'offene Akten'), 'warning') : badgeHtml('Keine offenen Akten', 'subtle')}
          ${item.leader ? badgeHtml(`Leitung: ${name(item.leader)}`, 'brand') : ''}
        </div>
      </div>
    </div>
    <div class="command-bar">
      ${manage() ? command('edit', 'edit', 'Bearbeiten') : ''}
      ${command('dashboard', 'open', 'Im Dashboard öffnen')}
      ${can('investigations:delete') ? command('delete', 'delete', 'Löschen') : ''}
    </div>
    <fluent-tablist id="families-tabs" activeid="family-tab-${tab}">
      ${tabs.map(([id, label, count]) => `<fluent-tab id="family-tab-${id}" data-tab="${id}"><span class="tab-label">${label}${count ? `<span class="tab-count">${count}</span>` : ''}</span></fluent-tab>`).join('')}
    </fluent-tablist>`
  void loadPhotos($('families-detail-header'))
  renderBody()
}

function renderBody() {
  const item = current
  if (!item) return
  familyMap = null
  const body = $('families-content')
  body.className = 'detail-body'
  body.innerHTML = { overview: overviewHtml, map: mapHtml, cases: casesHtml, members: membersHtml }[tab](item)
  if (tab === 'map') mountFamilyMap(body, item)
}

function caseRow(entry: Case, actions = '') {
  const places = entry.mapSpots ?? []
  return `
    <div class="list-row family-case-row${focusedSpot && places.some((spot) => spot.id === focusedSpot) ? ' highlighted' : ''}" data-case="${esc(entry.id)}">
      <button class="agent-name link-button" data-action="case" data-id="${esc(entry.id)}">
        <span class="type-caption muted">${esc(entry.caseNumber)} · ${esc(formatAgo(new Date(entry.updatedAt)))}</span>
        <span class="type-body-strong truncate">${esc(entry.title)}</span>
      </button>
      <span class="case-badges">${statusPill(entry.status)}${entry.priority !== 'NORMAL' ? badgeHtml(PRIORITY[entry.priority], PRIORITY_TONE[entry.priority]) : ''}</span>
      <span class="chips family-case-places">${places.length
        ? places.map((spot) => `<button class="chip" data-action="focus-spot" data-id="${esc(spot.id)}"><span class="map-dot" style="background:${mapCategory(spot.category).hex}"></span>${esc(spot.title)}</button>`).join('')
        : '<span class="type-caption muted">Kein Einsatzort</span>'}</span>
      <span class="row-actions">${actions}</span>
    </div>`
}

function overviewHtml(item: Family) {
  const cases = item.investigations ?? []
  const open = cases.filter((entry) => OPEN.has(entry.status)).length
  const stats: [IconName, number, string, Tab][] = [
    ['peopleTeam', item.persons?.length ?? 0, 'Mitglieder', 'members'],
    ['vehicle', item.vehicles?.length ?? 0, 'Fahrzeuge', 'members'],
    ['documentSearch', cases.length, 'Einsatzakten', 'cases'],
    ['warning', open, 'Offen', 'cases'],
    ['location', placesOf(item).length, 'Orte auf der Karte', 'map'],
  ]
  return `
    <div class="stat-strip family-stats">
      ${stats.map(([iconName, value, label, target]) => `
        <button class="card stat-tile${value ? '' : ' zero'}" data-goto="${target}">
          <span class="stat-icon">${icon(iconName)}</span>
          <span class="stat-text"><span class="type-subtitle">${value}</span><span class="type-caption muted">${label}</span></span>
        </button>`).join('')}
    </div>
    <div class="two-col">
      <div class="col">
        <div class="card pad">
          ${sectionHeader('Lagebild', manage() ? iconButton('edit', 'edit', 'Bearbeiten') : '')}
          <p class="prose">${item.description ? esc(item.description) : '<span class="muted">Noch keine Beschreibung hinterlegt.</span>'}</p>
        </div>
        <div>
          ${sectionHeader('Letzte Einsatzakten', cases.length > 5 ? `<fluent-button appearance="subtle" size="small" data-goto="cases">Alle ${cases.length} anzeigen</fluent-button>` : '')}
          <div class="card list">${cases.length ? cases.slice(0, 5).map((entry) => caseRow(entry)).join('') : empty('Dieser Familie ist noch keine Einsatzakte zugeordnet.', 'documentSearch')}</div>
        </div>
      </div>
      <div class="col narrow">
        <div class="card pad props">
          ${sectionHeader('Details')}
          ${prop('Fraktionsleitung', item.leader ? `<button class="link-button" data-action="goto-members">${esc(name(item.leader))}</button>` : '<span class="muted">Nicht erfasst</span>')}
          ${prop('Anwesen', item.address ? esc(item.address) : '<span class="muted">Nicht erfasst</span>')}
          ${prop('Angelegt', esc(formatDateTime(new Date(item.createdAt))))}
          ${prop('Zuletzt geändert', esc(formatDateTime(new Date(item.updatedAt))))}
        </div>
      </div>
    </div>`
}

/** Alle Punkte der Familie: eigene Orte (Anwesen …) und Einsatzorte ihrer Akten. */
function placesOf(item: Family) {
  const places = new Map<string, { spot: MapSpotRef; own: boolean; cases: Case[] }>()
  for (const spot of item.mapSpots ?? []) places.set(spot.id, { spot, own: true, cases: [] })
  for (const entry of item.investigations ?? []) {
    for (const spot of entry.mapSpots ?? []) {
      const place = places.get(spot.id) ?? { spot, own: false, cases: [] }
      place.cases.push(entry)
      places.set(spot.id, place)
    }
  }
  return [...places.values()]
}

function mapHtml(item: Family) {
  const cases = item.investigations ?? []
  const places = placesOf(item)
  const focused = places.find((place) => place.spot.id === focusedSpot)
  const located = cases.filter((entry) => entry.mapSpots?.length).length
  return `
    <div class="family-map-layout">
      <div class="card family-map-card">
        <div class="family-map" data-family-map></div>
        <div class="family-map-legend type-caption muted">
          <span><span class="legend-ring own"></span>Familienorte (Anwesen, Routen …)</span>
          <span><span class="legend-ring case"></span>Einsatzorte aus Akten</span>
          <span class="spacer"></span>
          ${canPick() ? `<fluent-button appearance="subtle" size="small" data-action="family-spots">${icon('homePerson').replace('<i ', '<i slot="start" ')}Familienorte bearbeiten</fluent-button>` : ''}
        </div>
      </div>
      <div class="col family-map-side">
        ${focused ? `
          <div class="card pad family-focus">
            <div class="section-header"><span class="map-dot" style="background:${mapCategory(focused.spot.category).hex}"></span><h2 class="type-body-strong truncate">${esc(focused.spot.title)}</h2><span class="spacer"></span>${iconButton('clear-focus', 'dismiss', 'Auswahl aufheben')}</div>
            <span class="type-caption muted">${esc(mapCategory(focused.spot.category).label)}${focused.own ? ' · Familienort' : ''} · ${plural(focused.cases.length, 'Einsatzakte', 'Einsatzakten')}</span>
          </div>` : ''}
        ${sectionHeader(`Einsätze · ${located} von ${cases.length} verortet`)}
        <div class="card list family-map-cases">
          ${cases.length ? cases.map((entry) => caseRow(entry, canPick() ? iconButton('case-spots', 'location', 'Einsatzort auf Karte wählen', entry.id) : '')).join('') : empty('Noch keine Einsatzakte zugeordnet.', 'documentSearch')}
        </div>
      </div>
    </div>`
}

function mountFamilyMap(root: HTMLElement, item: Family) {
  const host = root.querySelector<HTMLElement>('[data-family-map]')
  if (!host) return
  familyMap = createCityMap(host, {
    onPin: (id) => {
      focusedSpot = focusedSpot === id ? null : id
      renderBody()
      root.querySelector('.family-case-row.highlighted')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
  })
  const pins: MapPin[] = placesOf(item).map(({ spot, own, cases }) => {
    const pin = spotPin(spot, spot.id === focusedSpot)
    return { ...pin, glyph: own ? pin.glyph : String(cases.length), label: `${spot.title}${cases.length ? ` · ${plural(cases.length, 'Akte', 'Akten')}` : ''}`, color: own ? pin.color : caseColor(cases) }
  })
  familyMap.setPins(pins)
  if (focusedSpot) requestAnimationFrame(() => familyMap?.focus(focusedSpot!))
}

/** Einsatzorte färben nach der dringlichsten Akte am Ort. */
function caseColor(cases: Case[]) {
  if (cases.some((entry) => entry.status === 'ACTIVE')) return '#e5484d'
  if (cases.some((entry) => OPEN.has(entry.status))) return '#f5a524'
  return '#8b8d98'
}

function casesHtml(item: Family) {
  const cases = item.investigations ?? []
  return `
    ${sectionHeader(`Einsatzakten · ${cases.length}`, manage() ? command('add-case', 'link', 'Akte zuordnen', true) : '')}
    <div class="card list">
      ${cases.length ? cases.map((entry) => caseRow(entry, [
        canPick() ? iconButton('case-spots', 'location', 'Einsatzort auf Karte wählen', entry.id) : '',
        manage() ? iconButton('remove-case', 'dismiss', 'Zuordnung lösen', entry.id) : '',
      ].join(''))).join('') : empty('Dieser Familie ist noch keine Einsatzakte zugeordnet.', 'documentSearch')}
    </div>`
}

function membersHtml(item: Family) {
  const persons = item.persons ?? []
  const vehicles = item.vehicles ?? []
  return `
    <div class="two-col even">
      <div>
        ${sectionHeader(`Mitglieder · ${persons.length}`, manage() ? command('add-person', 'personAdd', 'Mitglied hinzufügen') : '')}
        <div class="card list">${persons.length ? persons.map((person) => `
          <div class="list-row family-member-row">
            <span class="avatar large">${esc(initials(name(person)))}</span>
            <span class="agent-name"><span class="type-body-strong truncate">${esc(name(person))}</span><span class="type-caption muted truncate">${esc(person.personNumber ?? '')}</span></span>
            <span class="case-badges">${person.id === item.leaderId ? badgeHtml('Leitung', 'brand') : ''}</span>
            <span class="row-actions">${manage() ? iconButton('remove-person', 'dismiss', 'Entfernen', person.id) : ''}</span>
          </div>`).join('') : empty('Noch keine Mitglieder erfasst.', 'peopleTeam')}</div>
      </div>
      <div>
        ${sectionHeader(`Fahrzeuge · ${vehicles.length}`, manage() ? command('add-vehicle', 'vehicle', 'Fahrzeug hinzufügen') : '')}
        <div class="card list">${vehicles.length ? vehicles.map((vehicle) => `
          <div class="list-row family-member-row">
            <span class="avatar large square">${icon('vehicle')}</span>
            <span class="agent-name"><span class="type-body-strong truncate">${esc(vehicle.plate || 'Ohne Kennzeichen')}</span><span class="type-caption muted truncate">${esc([vehicle.model, vehicle.vehicleNumber].filter(Boolean).join(' · '))}</span></span>
            <span></span>
            <span class="row-actions">${manage() ? iconButton('remove-vehicle', 'dismiss', 'Entfernen', vehicle.id) : ''}</span>
          </div>`).join('') : empty('Noch keine Fahrzeuge erfasst.', 'vehicle')}</div>
      </div>
    </div>`
}

// ── Bearbeiten ───────────────────────────────────────────────────────

async function save(body: Record<string, unknown>, message: string) {
  const item = current!
  await api.patch(`${base}/${encodeURIComponent(item.id)}`, body)
  toast(message)
  await openFamily(item.id, false)
}

async function edit(item: Family | null) {
  if (!manage()) return
  const people = await personOptions()
  let savedId = item?.id
  const saved = await openForm({
    title: item ? 'Familienakte bearbeiten' : 'Neue Familienakte',
    fields: [
      { name: 'title', label: 'Familie / Fraktion', type: 'text', required: true, maxLength: 200, value: item?.title, span: 2 },
      { name: 'leaderId', label: 'Fraktionsleitung', type: 'combobox', options: [{ value: '', label: 'Keine Leitung' }, ...people], value: item?.leaderId ?? '' },
      { name: 'address', label: 'Anwesen / Adresse', type: 'text', maxLength: 300, value: item?.address },
      { name: 'description', label: 'Lagebild', type: 'textarea', value: item?.description },
    ],
    submitLabel: item ? 'Speichern' : 'Anlegen',
    onSubmit: async (values) => {
      const body = { title: values.title, description: values.description || null, address: values.address || null, leaderId: values.leaderId || null }
      const result = item ? await api.patch<Family>(`${base}/${encodeURIComponent(item.id)}`, body) : await api.post<Family>(base, body)
      savedId = result.id
    },
  })
  if (saved && savedId) {
    toast(item ? 'Familienakte gespeichert' : 'Familienakte angelegt')
    await openFamily(savedId, !item)
  }
}

/** Ein Eintrag zu einer Liste hinzufügen (Combobox statt endloser Checkbox-Liste). */
async function addTo(field: 'personIds' | 'vehicleIds' | 'investigationIds', title: string, label: string, options: { value: string; label: string }[], ids: string[]) {
  const taken = new Set(ids)
  const free = options.filter((option) => !taken.has(option.value))
  if (!free.length) return toast('Es gibt keinen weiteren Eintrag zum Zuordnen.', 'info')
  let chosen = ''
  const saved = await openForm({
    title,
    fields: [{ name: 'id', label, type: 'combobox', options: free, required: true, span: 2 }],
    submitLabel: 'Hinzufügen',
    onSubmit: async (values) => { chosen = String(values.id ?? '') },
  })
  if (saved && chosen) await save({ [field]: [...ids, chosen] }, 'Zugeordnet')
}

async function caseSpots(caseId: string) {
  const entry = current?.investigations?.find((c) => c.id === caseId)
  if (!entry) return
  const ids = await pickMapSpots({
    title: `Einsatzort für ${entry.caseNumber}`,
    description: `${entry.title} – Ort auf der Karte wählen oder per Klick neu anlegen.`,
    selected: (entry.mapSpots ?? []).map((spot) => spot.id),
  })
  if (!ids) return
  await api.patch(`/api/investigations/${encodeURIComponent(entry.id)}`, { mapSpotIds: ids })
  toast('Einsatzort gespeichert')
  focusedSpot = ids[0] ?? null
  await openFamily(current!.id, false)
}

async function familySpots() {
  const item = current!
  const ids = await pickMapSpots({
    title: `Orte der Familie ${item.title}`,
    description: 'Anwesen, Routen, Verarbeiter oder Treffpunkte der Familie. Abgewählte Punkte bleiben auf der Stadtkarte erhalten.',
    selected: (item.mapSpots ?? []).map((spot) => spot.id),
    defaultCategory: 'estate',
  })
  if (ids) await save({ mapSpotIds: ids }, 'Familienorte gespeichert')
}

async function action(key: string, id: string) {
  const item = current
  switch (key) {
    case 'open': return openFamily(id)
    case 'new': return edit(null)
    case 'back': window.clearTimeout(timer); return loadList()
    case 'refresh': return loadList()
    case 'prev':
    case 'next':
      page = Math.max(1, page + (key === 'next' ? 1 : -1))
      return loadList()
    case 'case':
      navigation.go('investigations')
      return openCase(id)
  }
  if (!item) return
  switch (key) {
    case 'edit': return edit(item)
    case 'dashboard': return backend.openDashboard(`/investigations/dossiers?id=${encodeURIComponent(item.id)}`)
    case 'goto-members': tab = 'members'; return renderDetail()
    case 'focus-spot':
      focusedSpot = id
      if (tab !== 'map') { tab = 'map'; return renderDetail() }
      return renderBody()
    case 'clear-focus': focusedSpot = null; return renderBody()
    case 'case-spots': return caseSpots(id)
    case 'family-spots': return familySpots()
    case 'add-case': {
      const cases = await lookups.cases()
      return addTo('investigationIds', 'Einsatzakte zuordnen', 'Einsatzakte', cases.map((c) => ({ value: c.id, label: `${c.caseNumber} · ${c.title}` })), (item.investigations ?? []).map((c) => c.id))
    }
    case 'add-person':
      return addTo('personIds', 'Mitglied hinzufügen', 'Person', await personOptions(), (item.persons ?? []).map((p) => p.id))
    case 'add-vehicle':
      return addTo('vehicleIds', 'Fahrzeug hinzufügen', 'Fahrzeug', await vehicleOptions(), (item.vehicles ?? []).map((v) => v.id))
    case 'remove-case':
      if (!(await confirmAction('Zuordnung lösen?', 'Die Einsatzakte bleibt erhalten, gehört aber nicht mehr zu dieser Familie.', 'Lösen'))) return
      return save({ investigationIds: (item.investigations ?? []).filter((c) => c.id !== id).map((c) => c.id) }, 'Zuordnung gelöst')
    case 'remove-person':
      return save({ personIds: (item.persons ?? []).filter((p) => p.id !== id).map((p) => p.id) }, 'Mitglied entfernt')
    case 'remove-vehicle':
      return save({ vehicleIds: (item.vehicles ?? []).filter((v) => v.id !== id).map((v) => v.id) }, 'Fahrzeug entfernt')
    case 'delete':
      if (!can('investigations:delete')) return
      if (await confirmAction('Familienakte löschen?', `„${item.title}“ wird gelöscht. Verknüpfte Kartenpunkte und Einsatzakten bleiben erhalten.`)) {
        await api.del(`${base}/${encodeURIComponent(item.id)}`)
        toast('Familienakte gelöscht')
        return loadList()
      }
  }
}

export function showFamilies() {
  void (current ? openFamily(current.id, false) : loadList())
}

import { api, query } from '../api'
import { backend, UNAUTHORIZED } from '../backend'
import { $, errorText, escapeHtml as esc, textOf } from '../dom'
import { can, navigation, onStateChange, state } from '../store'
import { openForm, confirmAction } from '../ui/form-dialog'
import { personOptions, vehicleOptions, lookups } from '../investigations/lookups'
import { openCase } from '../investigations/detail'
import { mapCategory } from '../../../src/lib/investigations/map-spots'

interface Person { id: string; firstName: string; lastName: string }
interface Spot { id: string; title: string; category: string }
interface Family {
  id: string; title: string; description: string | null; address: string | null; leaderId: string | null
  leader: Person | null; openInvestigations?: number; lastActivityAt?: string
  persons?: Person[]; mapSpots?: Spot[]
  vehicles?: { id: string; plate: string | null; model: string | null }[]
  investigations?: { id: string; caseNumber: string; title: string; status: string }[]
  _count?: { persons: number; investigations: number; mapSpots: number }
}
let current: Family | null = null
let page = 1
let revision = 0
let timer: number | undefined
let busy = false
let account: string | undefined
const base = '/api/investigations/dossiers'
const name = (person: Person) => `${person.firstName} ${person.lastName}`
const button = (action: string, label: string, id = '') => `<fluent-button data-action="${action}" data-id="${esc(id)}">${esc(label)}</fluent-button>`
const empty = '<p class="type-body muted">Noch keine Einträge.</p>'

function failure(error: unknown) {
  if (errorText(error) === UNAUTHORIZED) { navigation.signOut(); return }
  $('families-error').textContent = errorText(error)
  $('families-error').hidden = false
}

export function initFamilies() {
  $('families-root').innerHTML = `
    <header class="page-header"><h1>Familienregister</h1><p class="muted">Familien, Anwesen und verknüpfte Einsatzakten.</p></header>
    <div class="family-toolbar">${button('back', 'Zum Register')}${button('refresh', 'Aktualisieren')}${button('new', 'Familienakte anlegen')}</div>
    <fluent-message-bar id="families-error" intent="error" hidden></fluent-message-bar>
    <div id="families-filters" class="family-toolbar"><label>Suche <input id="families-search" class="native-input" type="search" placeholder="Familie, Leiter, Mitglied oder Anwesen"></label>
    <label>Sortierung <select id="families-sort" class="native-input"><option value="activity">Letzte Aktivität</option><option value="name">Name</option><option value="open">Offene Akten</option></select></label></div>
    <div id="families-content" aria-live="polite"></div>
    <div id="families-pagination" class="family-toolbar">${button('prev', 'Zurück')}<span id="families-count"></span>${button('next', 'Weiter')}</div>`
  $('families-search').addEventListener('input', () => {
    window.clearTimeout(timer)
    ++revision
    timer = window.setTimeout(() => { page = 1; void loadList() }, 250)
  })
  $('families-sort').addEventListener('change', () => { page = 1; void loadList() })
  $('families-root').addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]')
    if (!target || busy) return
    busy = true
    void action(target.dataset.action!, target.dataset.id ?? '').catch(failure).finally(() => { busy = false })
  })
  onStateChange(() => {
    const nextAccount = state.context?.user.id ?? state.context?.user.displayName
    if (account === nextAccount) return
    account = nextAccount
    window.clearTimeout(timer)
    ++revision; current = null; page = 1
    $('families-content').replaceChildren()
    ;($('families-search') as HTMLInputElement).value = ''
  })
}

function controls(detail: boolean) {
  $('families-error').hidden = true
  $('families-filters').hidden = detail
  $('families-pagination').hidden = detail
  $('families-root').querySelector<HTMLElement>('[data-action="back"]')!.hidden = !detail
  $('families-root').querySelector<HTMLElement>('[data-action="new"]')!.hidden = !can('investigations:manage')
}

async function loadList() {
  current = null
  controls(false)
  const request = ++revision
  $('families-content').textContent = 'Familienregister wird geladen …'
  try {
    const result = await api.get<{ items: Family[]; total: number }>(base + query({ search: textOf('families-search'), sort: textOf('families-sort'), page: String(page) }))
    if (request !== revision) return
    $('families-content').innerHTML = result.items.length ? `<div class="family-grid">${result.items.map(item => `
      <article class="card family-card"><h2 class="type-subtitle">${esc(item.title)}</h2>
      <dl><dt>Fraktionsleiter</dt><dd>${esc(item.leader ? name(item.leader) : 'Nicht erfasst')}</dd><dt>Anwesen</dt><dd>${esc(item.address || 'Nicht erfasst')}</dd></dl>
      <p class="muted">${item._count?.persons ?? 0} Mitglieder · ${item.openInvestigations ?? 0} offene Akten · ${item._count?.mapSpots ?? 0} Kartenpunkte</p>
      ${button('open', 'Familienakte öffnen', item.id)}</article>`).join('')}</div>` : '<p class="card empty">Keine Familienakte gefunden. Ändere die Suche oder lege eine Familie an.</p>'
    $('families-count').textContent = `Seite ${page} · ${result.total} Familien`
    for (const [key, disabled] of [['prev', page === 1], ['next', page * 30 >= result.total]] as const) {
      ($('families-root').querySelector(`[data-action="${key}"]`) as HTMLElement & { disabled: boolean }).disabled = disabled
    }
  } catch (error) { if (request === revision) { $('families-content').replaceChildren(); failure(error) } }
}

export async function openFamily(id: string) {
  window.clearTimeout(timer)
  const request = ++revision
  current = null
  controls(true)
  $('families-content').textContent = 'Familienakte wird geladen …'
  try {
    const item = await api.get<Family>(`${base}/${encodeURIComponent(id)}`)
    if (request !== revision) return
    current = item
    renderDetail(item)
  } catch (error) { if (request === revision) { $('families-content').replaceChildren(); failure(error) } }
}

function renderDetail(item: Family) {
  const manage = can('investigations:manage')
  const section = (title: string, body: string, kind?: string) => `<section class="card family-card"><h3>${title}</h3>${body || empty}${manage && kind ? button(`link-${kind}`, 'Verknüpfungen bearbeiten') : ''}</section>`
  $('families-content').innerHTML = `<article class="card family-card"><h2>${esc(item.title)}</h2>
    <dl><dt>Fraktionsleiter</dt><dd>${esc(item.leader ? name(item.leader) : 'Nicht erfasst')}</dd><dt>Anwesen</dt><dd>${esc(item.address || 'Nicht erfasst')}</dd></dl>
    <p class="family-notes">${esc(item.description || 'Keine Beschreibung hinterlegt.')}</p><div class="family-toolbar">${manage ? button('edit', 'Bearbeiten') : ''}${can('investigations:delete') ? button('delete', 'Familienakte löschen') : ''}</div></article>
    <div class="family-grid">
    ${section('Anwesen & Kartenpunkte', (item.mapSpots ?? []).map(spot => `<p>${esc(mapCategory(spot.category).label)} · ${can('map:view') ? button('map', spot.title, spot.id) : esc(spot.title)}</p>`).join(''), can('map:view') ? 'map' : undefined)}
    ${section('Mitglieder', (item.persons ?? []).map(person => `<p>${esc(name(person))}</p>`).join(''), 'persons')}
    ${section('Fahrzeuge', (item.vehicles ?? []).map(vehicle => `<p>${esc([vehicle.plate, vehicle.model].filter(Boolean).join(' · ') || 'Ohne Kennzeichen')}</p>`).join(''), 'vehicles')}
    ${section('Einsatzakten', (item.investigations ?? []).map(entry => `<p>${button('case', `${entry.caseNumber} · ${entry.title}`, entry.id)} <span class="muted">${esc(entry.status)}</span></p>`).join(''), 'cases')}
    </div>`
}

async function edit(item: Family | null) {
  if (!can('investigations:manage')) return
  const people = await personOptions()
  let savedId = item?.id
  const saved = await openForm({ title: item ? 'Familienakte bearbeiten' : 'Familienakte anlegen', fields: [
    { name: 'title', label: 'Familie / Fraktion', type: 'text', required: true, maxLength: 200, value: item?.title },
    { name: 'address', label: 'Anwesen / Adresse', type: 'text', maxLength: 300, value: item?.address },
    { name: 'leaderId', label: 'Fraktionsleiter', type: 'select', options: [{ value: '', label: 'Kein Leiter' }, ...people], value: item?.leaderId },
    { name: 'description', label: 'Beschreibung', type: 'textarea', value: item?.description },
  ], onSubmit: async values => {
    const body = { ...values, description: values.description || null, address: values.address || null, leaderId: values.leaderId || null }
    const result = item ? await api.patch<Family>(`${base}/${encodeURIComponent(item.id)}`, body) : await api.post<Family>(base, body)
    savedId = result.id
  } })
  if (saved && savedId) await openFamily(savedId)
}

async function links(kind: string) {
  if (!current || !can('investigations:manage')) return
  const item = current
  const options = kind === 'map' ? (await api.get<Spot[]>('/api/map/spots')).map(spot => ({ value: spot.id, label: `${mapCategory(spot.category).label} · ${spot.title}` }))
    : kind === 'persons' ? await personOptions() : kind === 'vehicles' ? await vehicleOptions()
    : (await lookups.cases()).map(entry => ({ value: entry.id, label: `${entry.caseNumber} · ${entry.title}` }))
  const selected = new Set((kind === 'map' ? item.mapSpots : kind === 'persons' ? item.persons : kind === 'vehicles' ? item.vehicles : item.investigations)?.map(entry => entry.id))
  // Preserve selected records even if a lookup is capped or cached.
  const existing = kind === 'map' ? item.mapSpots : kind === 'persons' ? item.persons : kind === 'vehicles' ? item.vehicles : item.investigations
  for (const entry of existing ?? []) if (!options.some(option => option.value === entry.id)) options.push({ value: entry.id, label: 'title' in entry ? entry.title : 'firstName' in entry ? name(entry) : entry.plate || entry.model || entry.id })
  const field = kind === 'map' ? 'mapSpotIds' : kind === 'persons' ? 'personIds' : kind === 'vehicles' ? 'vehicleIds' : 'investigationIds'
  const saved = await openForm({ title: 'Verknüpfungen bearbeiten', description: kind === 'map' ? 'Anwesen, Fraktionen und Routen auswählen. Abgewählte Punkte bleiben auf der Karte erhalten.' : 'Wähle die Einträge für diese Familienakte.',
    fields: options.map((option, index) => ({ name: `link${index}`, label: option.label, type: 'checkbox', value: selected.has(option.value), span: 2 })),
    onSubmit: async values => { await api.patch(`${base}/${encodeURIComponent(item.id)}`, { [field]: options.filter((_, index) => values[`link${index}`]).map(option => option.value) }) },
  })
  if (saved) await openFamily(item.id)
}

async function action(key: string, id: string) {
  if (key === 'open') return openFamily(id)
  if (key === 'new') return edit(null)
  if (key === 'edit') return edit(current)
  if (key === 'back') { window.clearTimeout(timer); return loadList() }
  if (key === 'refresh') return current ? openFamily(current.id) : loadList()
  if (key === 'prev' || key === 'next') { page = Math.max(1, page + (key === 'next' ? 1 : -1)); return loadList() }
  if (key.startsWith('link-')) return links(key.slice(5))
  if (key === 'map') return backend.openDashboard(`/map?spot=${encodeURIComponent(id)}`)
  if (key === 'case') { navigation.go('investigations'); return openCase(id) }
  if (key === 'delete' && current && can('investigations:delete')) {
    const item = current
    if (await confirmAction('Familienakte löschen?', `„${item.title}“ wird gelöscht. Verknüpfte Kartenpunkte und Einsatzakten bleiben erhalten.`)) {
      await api.del(`${base}/${encodeURIComponent(item.id)}`)
      await loadList()
    }
  }
}

export function showFamilies() { void (current ? openFamily(current.id) : loadList()) }

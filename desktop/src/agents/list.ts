import { api } from '../api'
import { $, errorText, escapeHtml, selectValue, showMessage, textOf, type DropdownElement } from '../dom'
import { formatAgo } from '../format'
import { icon } from '../icons'
import { can } from '../store'
import { openForm } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import {
  agentName,
  avatar,
  badgeNumber,
  compareBadgeNumbers,
  FLAG,
  FLAG_COLOR,
  STATUS,
  STATUS_TONE,
  unitKeys,
  type ListAgent,
  type Rank,
  type Unit,
} from './model'

// Agents-Liste wie im Dashboard: nach Rang gruppiert, mit Suche und Filtern.

let agents: ListAgent[] = []
let ranks: Rank[] = []
let units: Unit[] = []
const filters = { search: '', status: '', rank: '', unit: '', flag: '' }
const COLLAPSED_KEY = 'fib-desktop.agents-collapsed-ranks'
const collapsed = new Set<string>(readCollapsed())
let searchTimer: number | undefined
let onOpen: (id: string) => void = () => {}

function readCollapsed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
  } catch {
    // Ohne Speicher gilt das Einklappen nur bis zum Neustart.
  }
}

export function pill(text: string, tone: string) {
  return `<span class="pill tone-${tone}">${escapeHtml(text)}</span>`
}

export function unitChips(agent: { units?: string[] | null; unit?: string | null }) {
  const byKey = new Map(units.map((unit) => [unit.key, unit]))
  return unitKeys(agent)
    .map((key) => {
      const unit = byKey.get(key)
      return `<span class="unit-chip" style="--unit:${escapeHtml(unit?.color ?? '#8e8e93')}">${escapeHtml(unit?.name ?? key)}</span>`
    })
    .join('')
}

/** Gemerkte Auswahllisten für die Akte (Ränge, Units). */
export const listLookups = { ranks: () => ranks, units: () => units }

function matches(agent: ListAgent) {
  const query = filters.search.trim().toLocaleLowerCase('de-DE')
  if (query) {
    const haystack = [agentName(agent), agent.badgeNumber, badgeNumber(agent.badgeNumber), agent.discordId ?? '', agent.rank.name]
      .join(' ')
      .toLocaleLowerCase('de-DE')
    if (!query.split(/\s+/).every((part) => haystack.includes(part))) return false
  }
  if (filters.status && agent.status !== filters.status) return false
  if (filters.rank && agent.rankId !== filters.rank) return false
  if (filters.unit) {
    const keys = unitKeys(agent)
    if (filters.unit === '__none__' ? keys.length > 0 : !keys.includes(filters.unit)) return false
  }
  if (filters.flag && (filters.flag === '__any__' ? !agent.flag : agent.flag !== filters.flag)) return false
  return true
}

function rowHtml(agent: ListAgent) {
  const trainings = agent.trainings.length
    ? `${agent.trainings.filter((t) => t.completed).length}/${agent.trainings.length}`
    : '–'
  const flag = agent.flag
    ? `<span class="flag-dot" style="background:${FLAG_COLOR[agent.flag] ?? 'transparent'}" title="Markierung: ${escapeHtml(FLAG[agent.flag as keyof typeof FLAG] ?? agent.flag)}"></span>`
    : ''
  return `
    <button class="list-row agent-row" data-id="${escapeHtml(agent.id)}" role="listitem"${can('rank-changes:manage') ? ' draggable="true" title="Zum Rangwechsel auf einen anderen Rang ziehen"' : ''}>
      <span class="agent-main">
        ${avatar(agent, 'small')}
        <span class="agent-text">
          <span class="type-body-strong truncate">${escapeHtml(agentName(agent))}${flag}</span>
          <span class="type-caption muted">#${escapeHtml(badgeNumber(agent.badgeNumber))}</span>
        </span>
      </span>
      <span class="agent-status">${pill(STATUS[agent.status as keyof typeof STATUS] ?? agent.status, STATUS_TONE[agent.status] ?? 'subtle')}</span>
      <span class="agent-units">${unitChips(agent)}</span>
      <span class="type-caption muted agent-trainings" title="Abgeschlossene Ausbildungen">${icon('history')} ${trainings}</span>
      <span class="type-caption muted agent-online">${agent.lastOnline ? escapeHtml(formatAgo(new Date(agent.lastOnline))) : 'nie online'}</span>
    </button>`
}

function render() {
  const visible = agents.filter(matches)
  const anyFilter = Object.values(filters).some(Boolean)
  $('ag-count').textContent = anyFilter
    ? `${visible.length} von ${agents.length} Agents`
    : `${agents.length} Agents im Dienst`

  const groups = new Map<string, { rank: Rank; agents: ListAgent[] }>()
  // Ohne Filter auch leere Ränge zeigen – wie der Dienstplan im Dashboard.
  if (!anyFilter || (filters.rank && !filters.search && !filters.status && !filters.unit && !filters.flag)) {
    for (const rank of ranks) if (!filters.rank || rank.id === filters.rank) groups.set(rank.id, { rank, agents: [] })
  }
  for (const agent of visible) {
    if (!groups.has(agent.rankId)) groups.set(agent.rankId, { rank: agent.rank, agents: [] })
    groups.get(agent.rankId)!.agents.push(agent)
  }
  const sorted = [...groups.values()].sort((a, b) => a.rank.sortOrder - b.rank.sortOrder)

  if (!sorted.length) {
    $('ag-list').innerHTML = `<div class="card empty">${icon('peopleTeam')}<span>Keine Agents gefunden.</span></div>`
    return
  }
  $('ag-list').innerHTML = sorted
    .map(({ rank, agents: members }) => {
      members.sort((a, b) => compareBadgeNumbers(a.badgeNumber, b.badgeNumber))
      const closed = collapsed.has(rank.id) && !filters.search
      return `
        <section class="card rank-group${closed ? ' closed' : ''}" data-rank="${escapeHtml(rank.id)}">
          <button class="rank-head" aria-expanded="${!closed}">
            <span class="rank-dot" style="background:${escapeHtml(rank.color)}"></span>
            <span class="type-body-strong">${escapeHtml(rank.name)}</span>
            <span class="tab-count">${members.length}</span>
            <span class="spacer"></span>
            <span class="rank-chevron">${icon('chevronDown')}</span>
          </button>
          ${closed ? '' : members.length ? `<div class="list" role="list">${members.map(rowHtml).join('')}</div>` : '<div class="empty small">Niemand in diesem Rang.</div>'}
        </section>`
    })
    .join('')
}

function fillDropdown(id: string, choices: { value: string; label: string }[], value: string) {
  const dropdown = $<DropdownElement>(id)
  dropdown.querySelector('fluent-listbox')!.innerHTML = choices
    .map((choice) => `<fluent-option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</fluent-option>`)
    .join('')
  selectValue(dropdown, value || '__all__')
}

function renderFilters() {
  const all = { value: '__all__', label: 'Alle' }
  fillDropdown('ag-status', [{ ...all, label: 'Alle Status' }, ...Object.entries(STATUS).filter(([key]) => key !== 'TERMINATED').map(([value, label]) => ({ value, label }))], filters.status)
  fillDropdown('ag-rank', [{ ...all, label: 'Alle Ränge' }, ...ranks.map((rank) => ({ value: rank.id, label: rank.name }))], filters.rank)
  fillDropdown('ag-unit', [{ ...all, label: 'Alle Units' }, { value: '__none__', label: 'Ohne Unit' }, ...units.map((unit) => ({ value: unit.key, label: unit.name }))], filters.unit)
  fillDropdown('ag-flag', [{ ...all, label: 'Alle Markierungen' }, { value: '__any__', label: 'Mit Markierung' }, ...Object.entries(FLAG).map(([value, label]) => ({ value, label }))], filters.flag)
}

export async function loadList() {
  try {
    const [nextAgents, nextRanks, nextUnits] = await Promise.all([
      api.get<ListAgent[]>('/api/agents'),
      api.get<Rank[]>('/api/ranks'),
      api.get<Unit[]>('/api/units?active=true').catch(() => units),
    ])
    agents = nextAgents
    ranks = [...nextRanks].sort((a, b) => a.sortOrder - b.sortOrder)
    units = nextUnits
    showMessage('ag-error', null)
    renderFilters()
    render()
  } catch (error) {
    showMessage('ag-error', `Agents konnten nicht geladen werden: ${errorText(error)}`)
  }
}

async function createAgent() {
  if (!ranks.length) await loadList()
  let createdId = ''
  const today = new Date().toISOString().slice(0, 10)
  const saved = await openForm({
    title: 'Neuer Agent',
    description: 'Wie im Dashboard: Dienstnummer leer lassen, um die nächste freie des Rangs zu vergeben.',
    submitLabel: 'Einstellen',
    fields: [
      { name: 'firstName', label: 'Vorname', type: 'text', required: true, maxLength: 60 },
      { name: 'lastName', label: 'Nachname', type: 'text', required: true, maxLength: 60 },
      { name: 'rankId', label: 'Rang', type: 'select', required: true, options: ranks.map((rank) => ({ value: rank.id, label: rank.name })), value: ranks.at(-1)?.id },
      { name: 'badgeNumber', label: 'Dienstnummer', type: 'text', placeholder: 'automatisch' },
      { name: 'discordId', label: 'Discord-ID', type: 'text', placeholder: '17–22 Ziffern' },
      { name: 'phoneNumber', label: 'Telefonnummer', type: 'text' },
      { name: 'hireDate', label: 'Eintrittsdatum', type: 'text', value: today, placeholder: 'JJJJ-MM-TT' },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
    ],
    onSubmit: async (values) => {
      const created = await api.post<{ id: string }>('/api/agents', {
        ...values,
        badgeNumber: values.badgeNumber || null,
        discordId: values.discordId || null,
        phoneNumber: values.phoneNumber || null,
        notes: values.notes || null,
        hireDate: values.hireDate || undefined,
      })
      createdId = created.id
      toast(`${values.firstName} ${values.lastName} eingestellt`)
    },
  })
  if (saved) {
    await loadList()
    if (createdId) onOpen(createdId)
  }
}

/** Wie im Dashboard: Agent auf einen anderen Rang ziehen – Rang und Dienstnummer wechseln. */
function bindDragAndDrop() {
  const list = $('ag-list')
  let dragged: ListAgent | null = null
  const groupOf = (event: DragEvent) => (event.target as HTMLElement).closest<HTMLElement>('.rank-group')
  const clearHover = () => list.querySelectorAll('.rank-group.drop-target').forEach((el) => el.classList.remove('drop-target'))
  list.addEventListener('dragstart', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.agent-row')
    dragged = agents.find((agent) => agent.id === row?.dataset.id) ?? null
    if (!dragged || !can('rank-changes:manage')) return event.preventDefault()
    event.dataTransfer?.setData('text/plain', dragged.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    row!.classList.add('dragging')
  })
  list.addEventListener('dragend', () => {
    dragged = null
    clearHover()
    list.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'))
  })
  list.addEventListener('dragover', (event) => {
    const group = groupOf(event)
    if (!dragged || !group || group.dataset.rank === dragged.rankId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (!group.classList.contains('drop-target')) {
      clearHover()
      group.classList.add('drop-target')
    }
  })
  list.addEventListener('drop', (event) => {
    const group = groupOf(event)
    const agent = dragged
    clearHover()
    if (!agent || !group?.dataset.rank || group.dataset.rank === agent.rankId) return
    event.preventDefault()
    const rank = ranks.find((r) => r.id === group.dataset.rank)
    void api
      .post(`/api/agents/${agent.id}/move`, { targetRankId: group.dataset.rank })
      .then(() => toast(`${agentName(agent)} → ${rank?.name ?? 'neuer Rang'} (Rang & Dienstnummer aktualisiert)`))
      .catch((error) => toast(`Verschieben fehlgeschlagen: ${errorText(error)}`, 'error'))
      .finally(() => void loadList())
  })
}

export function initList(open: (id: string) => void) {
  onOpen = open
  $('ag-new').addEventListener('click', () => void createAgent())
  $('ag-refresh').addEventListener('click', () => void loadList())
  $('ag-search').addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      filters.search = textOf('ag-search')
      render()
    }, 150)
  })
  for (const [id, key] of [['ag-status', 'status'], ['ag-rank', 'rank'], ['ag-unit', 'unit'], ['ag-flag', 'flag']] as const) {
    $(id).addEventListener('change', () => {
      const value = $<DropdownElement>(id).value
      filters[key] = !value || value === '__all__' ? '' : value
      render()
    })
  }
  $('ag-list').addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('.agent-row')
    if (row?.dataset.id) return onOpen(row.dataset.id)
    const head = target.closest<HTMLElement>('.rank-head')
    const group = head?.closest<HTMLElement>('.rank-group')
    if (group?.dataset.rank) {
      const rank = group.dataset.rank
      if (collapsed.has(rank)) collapsed.delete(rank)
      else collapsed.add(rank)
      saveCollapsed()
      render()
    }
  })
  bindDragAndDrop()
  refreshPermissions()
}

export function refreshPermissions() {
  $('ag-new').hidden = !can('agents:write')
}

/** Hintergrund-Aktualisierung: nur die Agents neu laden, Filter bleiben offen und unverändert. */
export async function refreshList() {
  try {
    agents = await api.get<ListAgent[]>('/api/agents')
    showMessage('ag-error', null)
    render()
  } catch {
    // Beim nächsten Durchlauf erneut versuchen – keine Meldung für Hintergrundfehler.
  }
}

/** Nach Änderungen in der Akte die Liste im Hintergrund auffrischen. */
export function invalidateList() {
  void loadList()
}


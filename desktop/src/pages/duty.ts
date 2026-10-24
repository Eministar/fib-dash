import { backend, UNAUTHORIZED, type DutyAgent, type DutyTimes } from '../backend'
import { $, errorText, escapeHtml, initials, showMessage, textOf } from '../dom'
import { formatAgo, formatHours } from '../format'
import { navigation } from '../store'

// Solange die Seite offen ist, regelmäßig nachladen.
const REFRESH_MS = 30_000

type Filter = 'all' | 'active' | 'off'
type Sort = 'rank' | 'week' | 'name' | 'badge'

let data: DutyTimes | null = null
let filter: Filter = 'all'
let sort: Sort = 'rank'
let rankFilter = ''
let rankKeys = ''
let timer: number | undefined
let loading = false

const dayFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' })
const collator = new Intl.Collator('de-DE', { numeric: true, sensitivity: 'base' })

function statusText(agent: DutyAgent) {
  if (agent.onDuty && agent.dutySince) return `<span class="on-duty">Im Dienst seit ${formatHours(Date.now() - new Date(agent.dutySince).getTime())}</span>`
  if (agent.lastSeenAt) return `Zuletzt im Dienst ${formatAgo(new Date(agent.lastSeenAt))}`
  return 'Diese Woche noch nicht im Dienst'
}

// Rang wie im Dashboard (sortOrder aufsteigend = höchster Rang zuerst), danach Dienstnummer.
const byRank = (a: DutyAgent, b: DutyAgent) =>
  (a.rank?.order ?? Number.MAX_SAFE_INTEGER) - (b.rank?.order ?? Number.MAX_SAFE_INTEGER) || collator.compare(a.badge, b.badge)

const comparators: Record<Sort, (a: DutyAgent, b: DutyAgent) => number> = {
  rank: byRank,
  week: (a, b) => b.weekMs - a.weekMs || byRank(a, b),
  name: (a, b) => collator.compare(a.name, b.name),
  badge: (a, b) => collator.compare(a.badge, b.badge),
}

/** Rang-Auswahl nur neu aufbauen, wenn sich die Ränge geändert haben. */
function syncRankOptions(agents: DutyAgent[]) {
  const ranks = new Map<string, { name: string; order: number }>()
  for (const agent of agents) if (agent.rank) ranks.set(agent.rank.name, agent.rank)
  const sorted = [...ranks.values()].sort((a, b) => a.order - b.order)
  const keys = sorted.map((r) => r.name).join('|')
  if (keys === rankKeys) return
  rankKeys = keys
  if (rankFilter && !ranks.has(rankFilter)) rankFilter = ''
  $('duty-rank-options').innerHTML = [
    `<fluent-option value=""${rankFilter ? '' : ' selected'}>Alle Ränge</fluent-option>`,
    ...sorted.map((r) => `<fluent-option value="${escapeHtml(r.name)}"${r.name === rankFilter ? ' selected' : ''}>${escapeHtml(r.name)}</fluent-option>`),
  ].join('')
}

function row(agent: DutyAgent, max: number) {
  const avatar = agent.avatarUrl ? `<img class="avatar-img" src="${escapeHtml(agent.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''
  return `
    <div class="list-row" role="listitem">
      <span class="avatar">${escapeHtml(initials(agent.name))}${avatar}<span class="status-dot${agent.onDuty ? ' on' : ''}"></span></span>
      <span class="agent-name">
        <span class="type-body-strong truncate">${escapeHtml(agent.name)} <span class="muted">· ${escapeHtml(agent.badge)}</span></span>
        <span class="type-caption muted rank truncate">${agent.rank ? `<span class="rank-dot" style="background:${escapeHtml(agent.rank.color)}"></span>${escapeHtml(agent.rank.name)}` : ''}</span>
      </span>
      <span class="type-caption muted status-text truncate">${statusText(agent)}</span>
      <span class="week">
        <span class="week-head"><span class="type-body-strong">${formatHours(agent.weekMs)}</span><span class="type-caption muted">${agent.sessionCount} ${agent.sessionCount === 1 ? 'Dienst' : 'Dienste'}</span></span>
        <span class="week-bar"><span style="width:${(agent.weekMs / max) * 100}%"></span></span>
      </span>
    </div>`
}

function group(title: string, agents: DutyAgent[], max: number) {
  if (!agents.length) return ''
  return `
    <section class="duty-group">
      <h2 class="group-title type-body-strong">${escapeHtml(title)}<span class="tab-count">${agents.length}</span></h2>
      <div class="card list" role="list">${agents.map((a) => row(a, max)).join('')}</div>
    </section>`
}

function render() {
  if (!data) return
  syncRankOptions(data.agents)
  const query = textOf('duty-search').toLowerCase()
  const active = data.agents.filter((a) => a.onDuty)
  const total = data.agents.reduce((sum, a) => sum + a.weekMs, 0)
  const max = Math.max(1, ...data.agents.map((a) => a.weekMs))

  $('duty-week').textContent =
    `Woche vom ${dayFormat.format(new Date(data.weekStart))} bis ${dayFormat.format(new Date(new Date(data.weekEnd).getTime() - 1))}`
  $('duty-active').textContent = String(active.length)
  $('duty-total').textContent = formatHours(total)
  $('duty-count').textContent = String(data.agents.length)

  const rows = data.agents
    .filter((a) => filter === 'all' || (filter === 'active') === a.onDuty)
    .filter((a) => !rankFilter || a.rank?.name === rankFilter)
    .filter((a) => !query || `${a.name} ${a.badge} ${a.rank?.name ?? ''}`.toLowerCase().includes(query))
    .sort(comparators[sort])

  const list = $('duty-list')
  if (!rows.length) {
    list.innerHTML = `<div class="card empty">${filter === 'active' && !query && !rankFilter ? 'Gerade ist niemand im Dienst.' : 'Kein Agent gefunden.'}</div>`
    return
  }
  // Wer im Dienst ist, steht immer oben – jeweils in der gewählten Sortierung.
  list.innerHTML =
    group('Im Dienst', rows.filter((a) => a.onDuty), max) +
    group('Nicht im Dienst', rows.filter((a) => !a.onDuty), max)
}

async function load() {
  if (loading) return
  loading = true
  try {
    data = await backend.dutyTimes()
    showMessage('duty-error', null)
    render()
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) return navigation.signOut()
    showMessage('duty-error', `Dienstzeiten konnten nicht geladen werden: ${errorText(error)}`)
  } finally {
    loading = false
  }
}

export function initDuty() {
  $('duty-refresh').addEventListener('click', () => void load())
  $('duty-search').addEventListener('input', render)
  $('duty-sort').addEventListener('change', () => {
    sort = (($('duty-sort') as HTMLElement & { value: string | null }).value || 'rank') as Sort
    render()
  })
  $('duty-rank').addEventListener('change', () => {
    rankFilter = ($('duty-rank') as HTMLElement & { value: string | null }).value ?? ''
    render()
  })
  for (const [id, value] of [['duty-filter-all', 'all'], ['duty-filter-active', 'active'], ['duty-filter-off', 'off']] as const) {
    $(id).addEventListener('click', () => {
      filter = value
      render()
    })
  }
}

export function showDuty() {
  void load()
  window.clearInterval(timer)
  timer = window.setInterval(() => void load(), REFRESH_MS)
}

export function hideDuty() {
  window.clearInterval(timer)
}

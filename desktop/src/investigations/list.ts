import { api, query } from '../api'
import { $, errorText, escapeHtml, showMessage, textOf } from '../dom'
import { formatAgo } from '../format'
import { icon } from '../icons'
import { can } from '../store'
import { createCase } from './create-case'
import {
  agentAvatar,
  agentName,
  checklistOf,
  PRIORITY,
  PRIORITY_TONE,
  STATUS,
  STATUS_TONE,
  type ListItem,
} from './model'

let items: ListItem[] = []
let statusFilter = 'OPEN_ONLY'
let mineOnly = false
let searchTimer: number | undefined
let onOpen: (id: string) => void = () => {}

export function badgeHtml(text: string, tone: string) {
  return `<span class="pill tone-${tone}">${escapeHtml(text)}</span>`
}

function progressHtml(item: ListItem) {
  const list = checklistOf(item.checklist)
  if (!list.length) return ''
  const done = list.filter((i) => i.done).length
  return `<span class="mini-progress" title="Arbeitsplan: ${done} von ${list.length} erledigt"><span style="width:${(done / list.length) * 100}%"></span></span>`
}

function render() {
  const list = $('inv-list')
  $('inv-count').textContent = `${items.length} ${items.length === 1 ? 'Akte' : 'Akten'}`
  if (!items.length) {
    list.innerHTML = `<div class="empty">${icon('documentSearch')}<span>Keine Akten gefunden.</span></div>`
    return
  }
  list.innerHTML = items
    .map(
      (item) => `
      <button class="list-row case-row" data-id="${item.id}" role="listitem">
        <span class="case-main">
          <span class="type-caption muted">${escapeHtml(item.caseNumber)}</span>
          <span class="type-body-strong truncate">${escapeHtml(item.title)}</span>
          ${item.summary ? `<span class="type-caption muted truncate">${escapeHtml(item.summary)}</span>` : ''}
        </span>
        <span class="case-badges">${badgeHtml(STATUS[item.status], STATUS_TONE[item.status])}${item.priority !== 'NORMAL' ? badgeHtml(PRIORITY[item.priority], PRIORITY_TONE[item.priority]) : ''}</span>
        <span class="case-lead type-caption">
          <span class="muted">Fallführung</span>
          <span class="agent-inline">${agentAvatar(item.leadAgent, 'xs')}<span class="truncate">${escapeHtml(agentName(item.leadAgent))}</span></span>
        </span>
        <span class="case-meta type-caption muted">
          <span>${icon('timer')} ${escapeHtml(formatAgo(new Date(item.updatedAt)))}</span>
          <span>${item._count.entries} Einträge · ${item._count.persons} Personen · ${item._count.clips} Clips</span>
          ${progressHtml(item)}
        </span>
      </button>`,
    )
    .join('')
}

export async function loadList() {
  try {
    items = await api.get<ListItem[]>(
      `/api/investigations${query({ status: statusFilter, search: textOf('inv-search') || null, mine: mineOnly && '1' })}`,
    )
    showMessage('inv-error', null)
    render()
  } catch (error) {
    showMessage('inv-error', `Akten konnten nicht geladen werden: ${errorText(error)}`)
  }
}

export function initList(open: (id: string) => void) {
  onOpen = open
  $('inv-new').hidden = !can('investigations:manage')
  $('inv-new').addEventListener('click', async () => {
    try {
      const created = await createCase()
      if (!created) return
      await loadList()
      onOpen(created.id)
    } catch (error) {
      showMessage('inv-error', errorText(error))
    }
  })
  $('inv-refresh').addEventListener('click', () => void loadList())
  $('inv-search').addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => void loadList(), 250)
  })
  $('inv-status').addEventListener('change', () => {
    statusFilter = ($('inv-status') as HTMLElement & { value: string | null }).value || 'OPEN_ONLY'
    void loadList()
  })
  $('inv-mine').addEventListener('change', () => {
    mineOnly = !!($('inv-mine') as HTMLElement & { checked: boolean }).checked
    void loadList()
  })
  $('inv-list').addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.case-row')
    if (row?.dataset.id) onOpen(row.dataset.id)
  })
}

export function refreshPermissions() {
  $('inv-new').hidden = !can('investigations:manage')
}

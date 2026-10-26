import { api, query } from '../api'
import { backend } from '../backend'
import { escapeHtml } from '../dom'
import { icon } from '../icons'
import { openAgent } from '../agents/detail'
import { openCase } from '../investigations/detail'
import { navigation, state } from '../store'

// Globale Suche (Strg+K): dieselbe Suche wie im Dashboard (`/api/search`) über Agents,
// Akten, Personen, Fahrzeuge, Chronologie, Sanktionskatalog und Ordnungen. Agents und
// Akten öffnen sich in der App, alles andere im Dashboard.

type Group = 'agents' | 'investigations' | 'dossiers' | 'persons' | 'vehicles' | 'mapSpots' | 'entries' | 'sanctions' | 'ordnungen'

interface Hit {
  id: string
  group: Group
  code?: string
  title: string
  hint?: string
  href: string
}

// Spiegel von SEARCH_GROUPS im Dashboard (src/lib/core/global-search.ts), in derselben Reihenfolge.
const GROUPS: Record<Group, string> = {
  agents: 'Agents',
  investigations: 'Einsatzakten',
  dossiers: 'Familienakten',
  persons: 'Personen',
  vehicles: 'Fahrzeuge',
  mapSpots: 'Kartenpunkte',
  entries: 'Chronologie-Einträge',
  sanctions: 'Sanktionskatalog',
  ordnungen: 'Ordnungen',
}

const DEBOUNCE_MS = 200

let root: HTMLElement | null = null
let input: HTMLInputElement
let list: HTMLElement
let hits: Hit[] = []
let active = 0
let timer: number | undefined
/** Nur die Antwort auf die letzte Eingabe zählt – ältere, langsamere verwerfen. */
let generation = 0

function build() {
  root = document.createElement('div')
  root.className = 'search-palette'
  root.hidden = true
  root.innerHTML = `
    <div class="search-card" role="dialog" aria-modal="true" aria-label="Suchen">
      <label class="search-field">
        ${icon('search')}
        <input type="search" placeholder="Agents, Akten, Personen, Sanktionen, Ordnungen …" autocomplete="off" spellcheck="false" aria-label="Suchbegriff">
        <kbd class="type-caption">Esc</kbd>
      </label>
      <div class="search-results" role="listbox"></div>
    </div>`
  document.body.append(root)
  input = root.querySelector('input')!
  list = root.querySelector('.search-results')!

  root.addEventListener('mousedown', (event) => {
    // Klick auf den abgedunkelten Hintergrund schließt.
    if (event.target === root) closeSearch()
  })
  input.addEventListener('input', () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void search(input.value), DEBOUNCE_MS)
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSearch()
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!hits.length) return
      active = (active + (event.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length
      render()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[active]
      if (hit) activate(hit)
    }
  })
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
    const hit = row ? hits[Number(row.dataset.index)] : undefined
    if (hit) activate(hit)
  })
}

function render(message?: string) {
  if (message) {
    list.innerHTML = `<p class="search-empty type-caption muted">${escapeHtml(message)}</p>`
    return
  }
  let index = 0
  list.innerHTML = (Object.keys(GROUPS) as Group[])
    .map((group) => {
      const inGroup = hits.filter((hit) => hit.group === group)
      if (!inGroup.length) return ''
      return `<div class="search-group type-caption muted">${GROUPS[group]}</div>${inGroup
        .map((hit) => {
          const i = index++
          return `
            <button class="search-hit${i === active ? ' active' : ''}" role="option" aria-selected="${i === active}" data-index="${hits.indexOf(hit)}">
              ${hit.code ? `<span class="type-caption muted">${escapeHtml(hit.code)}</span>` : ''}
              <span class="type-body-strong">${escapeHtml(hit.title)}</span>
              ${hit.hint ? `<span class="type-caption muted truncate">${escapeHtml(hit.hint)}</span>` : ''}
            </button>`
        })
        .join('')}`
    })
    .join('')
  list.querySelector('.search-hit.active')?.scrollIntoView({ block: 'nearest' })
}

async function search(term: string) {
  const mine = ++generation
  const trimmed = term.trim()
  if (trimmed.length < 2 && !/^#?\d+$/.test(trimmed)) {
    hits = []
    return render(trimmed ? 'Mindestens zwei Zeichen eingeben.' : 'Suche über Agents, Akten, Personen, Fahrzeuge, Sanktionskatalog und Ordnungen.')
  }
  try {
    const found = await api.get<Hit[]>(`/api/search${query({ q: trimmed })}`)
    if (mine !== generation) return
    // In Anzeigereihenfolge sortieren, damit Pfeiltasten der Liste folgen.
    const order = Object.keys(GROUPS)
    hits = found.filter((hit) => hit.group in GROUPS).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
    active = 0
    render(hits.length ? undefined : 'Nichts gefunden.')
  } catch (error) {
    if (mine !== generation) return
    hits = []
    render(`Suche fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function activate(hit: Hit) {
  closeSearch()
  if (hit.group === 'agents' && state.context?.tools.agents) {
    navigation.go('agents')
    void openAgent(hit.id)
  } else if (hit.group === 'investigations' && state.context?.tools.investigations) {
    navigation.go('investigations')
    void openCase(hit.id)
  } else if (hit.group === 'entries' && state.context?.tools.investigations) {
    // Chronologie-Eintrag: die Akte öffnen (die ID steht im Link des Dashboards).
    const caseId = hit.href.match(/^\/investigations\/([^/?]+)/)?.[1]
    if (caseId) {
      navigation.go('investigations')
      void openCase(caseId)
    }
  } else {
    void backend.openDashboard(hit.href)
  }
}

export function openSearch() {
  if (!state.context) return
  if (!root) build()
  root!.hidden = false
  input.select()
  input.focus()
  if (!input.value) render('Suche über Agents, Akten, Personen, Fahrzeuge, Sanktionskatalog und Ordnungen.')
}

export function closeSearch() {
  if (root) root.hidden = true
}

export function initSearch() {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      openSearch()
    }
  })
}

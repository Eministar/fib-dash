import { backend } from '../backend'
import { $, escapeHtml } from '../dom'
import { displayHotkey } from '../format'
import { icon, type IconName } from '../icons'
import { navigation, onStateChange, state, type Route } from '../store'
import { initOverview, loadOverview } from './overview'

interface Tool {
  icon: IconName
  title: string
  description: string
  meta?: () => string
  /** Seite in der App – oder eine Aktion wie „im Browser öffnen“. */
  route?: Route
  action?: () => void
  available: () => boolean
  soon?: boolean
}

// Neue Werkzeuge kommen hier dazu (Seite in index.html + Modul in pages/).
const tools: Tool[] = [
  { icon: 'peopleTeam', title: 'Familienregister', description: 'Familienakten, Anwesen, Mitglieder und verknüpfte Einsatzakten.', route: 'families', available: () => !!state.context?.tools.investigations },
  {
    icon: 'videoClip',
    title: 'Bodycam',
    description: 'Clips aus FIB Self-Clip, NVIDIA, AMD oder Medal schneiden, komprimieren und in eine Ermittlungsakte hochladen.',
    meta: () => (state.settings ? `Taste: ${displayHotkey(state.settings.settings.bodycamHotkey)}` : ''),
    route: 'bodycam',
    available: () => !!state.context?.tools.bodycam,
  },
  {
    icon: 'target',
    title: 'Kill-Clips',
    description: 'Erkennt deine Kills automatisch, schneidet sie zusammen und postet sie in deinen Clips-Channel.',
    route: 'killclips',
    available: () => !!state.context?.tools.killClips,
  },
  {
    icon: 'timer',
    title: 'Dienstzeiten',
    description: 'Wer gerade im Dienst ist und wie viel Dienstzeit diese Woche zusammenkam.',
    route: 'duty',
    available: () => !!state.context?.tools.dutyTimes,
  },
  {
    icon: 'documentSearch',
    title: 'Ermittlungsakten',
    description: 'Akten durchsuchen und bearbeiten: Chronologie, Beteiligte, Asservate, Medien und Team.',
    route: 'investigations',
    available: () => !!state.context?.tools.investigations,
  },
  {
    icon: 'megaphone',
    title: 'Neuigkeiten',
    description: 'Ankündigungen aus dem Discord und was sich in der App geändert hat.',
    route: 'news',
    available: () => true,
  },
  {
    icon: 'open',
    title: 'Dashboard öffnen',
    description: 'Das FIB-Dashboard im Browser für alles Weitere.',
    action: () => void backend.openDashboard('/dashboard'),
    available: () => true,
  },
]

function render() {
  const name = state.context?.user.displayName.replace(/^\[[^\]]*\]\s*/, '') ?? ''
  $('home-greeting').textContent = name ? `Hallo, ${name}` : 'Willkommen'

  const grid = $('tool-grid')
  grid.replaceChildren(
    ...tools.map((tool) => {
      const enabled = tool.available()
      const tile = document.createElement('button')
      tile.className = 'card tool-tile'
      tile.disabled = !enabled
      const note = tool.soon ? 'Kommt bald' : !enabled ? 'Keine Berechtigung' : (tool.meta?.() ?? '')
      tile.innerHTML = `
        <span class="tile-icon">${icon(tool.icon)}</span>
        <span class="type-body-strong">${escapeHtml(tool.title)}${tool.soon ? '<span class="badge">Bald</span>' : ''}</span>
        <span class="type-caption muted">${escapeHtml(tool.description)}</span>
        <span class="type-caption tile-meta">${escapeHtml(note)}</span>`
      tile.addEventListener('click', () => {
        if (tool.route) navigation.go(tool.route)
        else tool.action?.()
      })
      return tile
    }),
  )
}

export function initHome() {
  initOverview()
  onStateChange(() => {
    render()
    void loadOverview()
  })
  render()
}

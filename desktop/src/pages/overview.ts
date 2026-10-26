import { api } from '../api'
import { backend } from '../backend'
import { $, escapeHtml } from '../dom'
import { formatDateTime, formatHours } from '../format'
import { icon, type IconName } from '../icons'
import { state } from '../store'
import { autoRefresh } from '../ui/auto-refresh'
import { toast } from '../ui/toast'

// Persönliche Übersicht über den Werkzeugen der Startseite: Dienstzeit, Aufgaben,
// Probezeit, Termine und eigene Schnellnotizen (`/api/desktop/overview`).

interface Overview {
  agent: { name: string; badge: string; rank: { name: string; color: string } | null } | null
  duty: { onDuty: boolean; since: string | null; weekMs: number; sessionCount: number; weekStart: string } | null
  probation: { type: string; startsAt: string; endsAt: string } | null
  tasks: { id: string; title: string; detail: string; kind: 'training' | 'contract' | 'task'; dueDate: string | null; overdue?: boolean; inProgress?: boolean }[]
  events: { id: string; title: string; type: string; startsAt: string; endsAt: string | null; location: string | null }[]
  notes: { id: string; content: string; createdAt: string }[]
}

// Wie PROBATION_TYPE_LABELS im Dashboard (src/lib/hr/probations.ts).
const PROBATION_TYPES: Record<string, string> = {
  ROOKIE: 'Probezeit (Rookie)',
  SERGEANT_SUPERVISOR: 'Probezeit (Sergeant / Supervisor)',
  LEADERSHIP: 'Probezeit (Leitungsebene)',
  CHIEF: 'Probezeit (Chief-Ebene)',
}
const TASKS_SHOWN = 4
/** Nicht bei jeder Zustandsänderung neu laden – höchstens so oft. */
const MIN_RELOAD_MS = 10_000

let overview: Overview | null = null
let loadedAt = 0

function card(iconName: IconName, title: string, body: string, action = '') {
  return `
    <article class="card overview-card">
      <header class="overview-head">${icon(iconName)}<span class="type-body-strong">${escapeHtml(title)}</span>${action}</header>
      ${body}
    </article>`
}

function emptyLine(text: string) {
  return `<p class="type-caption muted overview-empty">${escapeHtml(text)}</p>`
}

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
}

function render() {
  const root = $('home-overview')
  if (!overview || !state.context) {
    root.hidden = true
    return
  }
  const { duty, probation, tasks, events, notes } = overview

  const dutyBody = duty
    ? `<div class="overview-figure"><span class="type-subtitle">${formatHours(duty.weekMs)}</span><span class="type-caption muted">diese Woche · ${duty.sessionCount} ${duty.sessionCount === 1 ? 'Schicht' : 'Schichten'}</span></div>
       <p class="type-caption ${duty.onDuty ? 'overview-on' : 'muted'}">${duty.onDuty && duty.since ? `Im Dienst seit ${formatDateTime(new Date(duty.since))}` : 'Gerade nicht im Dienst'}</p>`
    : emptyLine('Kein Agent mit deinem Konto verknüpft.')

  const taskBody = tasks.length
    ? `<ul class="overview-list">${tasks
        .slice(0, TASKS_SHOWN)
        .map(
          (task) => `<li><span class="type-body">${escapeHtml(task.title)}</span><span class="type-caption ${task.overdue ? 'overview-overdue' : 'muted'}">${escapeHtml(task.detail)}${task.dueDate ? ` · fällig ${formatDateTime(new Date(task.dueDate))}` : ''}${task.overdue ? ' · überfällig' : ''}</span></li>`,
        )
        .join('')}</ul>${tasks.length > TASKS_SHOWN ? `<p class="type-caption muted">und ${tasks.length - TASKS_SHOWN} weitere</p>` : ''}`
    : emptyLine('Nichts offen.')

  const eventBody = events.length
    ? `<ul class="overview-list">${events
        .map((event) => `<li><span class="type-body">${escapeHtml(event.title)}</span><span class="type-caption muted">${formatDateTime(new Date(event.startsAt))}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</span></li>`)
        .join('')}</ul>`
    : emptyLine('Keine Termine in den nächsten zwei Wochen.')

  const noteBody = notes.length
    ? `<ul class="overview-list">${notes
        .map(
          (note) => `<li class="overview-note"><span class="type-body">${escapeHtml(note.content)}</span><span class="type-caption muted">${formatDateTime(new Date(note.createdAt))}</span>
            <fluent-button appearance="subtle" size="small" icon-only title="Notiz löschen" aria-label="Notiz löschen" data-overview-delete="${escapeHtml(note.id)}">${icon('delete')}</fluent-button></li>`,
        )
        .join('')}</ul>`
    : emptyLine(`Noch keine. Mit ${escapeHtml(state.settings?.settings.quickNoteHotkey ?? 'der Schnellnotiz-Taste')} geht es auch im Spiel.`)

  const probationCard = probation
    ? card(
        'clipboardTask',
        PROBATION_TYPES[probation.type] ?? 'Probezeit',
        `<div class="overview-figure"><span class="type-subtitle">${Math.max(0, daysUntil(probation.endsAt))} Tage</span><span class="type-caption muted">bis ${formatDateTime(new Date(probation.endsAt))}</span></div>`,
      )
    : ''

  root.innerHTML = [
    card('timer', 'Meine Dienstzeit', dutyBody),
    card('clipboardTask', `Offene Aufgaben${tasks.length ? ` (${tasks.length})` : ''}`, taskBody),
    probationCard,
    card('calendar', 'Nächste Termine', eventBody),
    card('note', 'Meine Notizen', noteBody, `<fluent-button appearance="subtle" size="small" data-overview-new-note>${icon('noteAdd').replace('<i ', '<i slot="start" ')}Neu</fluent-button>`),
  ].join('')
  root.hidden = false
}

/** Lädt die Übersicht neu; `force` umgeht die Mindestpause (nach eigenen Änderungen). */
export async function loadOverview(force = false) {
  if (!state.context) return
  if (!force && Date.now() - loadedAt < MIN_RELOAD_MS) return
  loadedAt = Date.now()
  try {
    overview = await api.get<Overview>('/api/desktop/overview')
  } catch {
    // Älterer Server ohne Übersicht oder offline: Startseite zeigt dann nur die Werkzeuge.
    overview = null
  }
  render()
}

export function initOverview() {
  const root = $('home-overview')
  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-overview-new-note]')) {
      void backend.quickNoteOpen()
      return
    }
    const remove = target.closest<HTMLElement>('[data-overview-delete]')
    if (remove) {
      try {
        await api.del(`/api/notes/${remove.dataset.overviewDelete}`)
        toast('Notiz gelöscht')
        await loadOverview(true)
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error')
      }
    }
  })
  // Neue Schnellnotiz gespeichert, während die Startseite offen ist: gleich zeigen.
  window.addEventListener('focus', () => void loadOverview())
  autoRefresh('home', () => loadOverview(true))
}

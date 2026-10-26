import { backend, type AppResources } from '../backend'
import { $, escapeHtml } from '../dom'
import { formatBytes } from '../format'
import { icon } from '../icons'

// Was die App selbst gerade verbraucht – damit sichtbar ist, dass sie das Spiel nicht
// ausbremst. Gemessen wird nur, solange die Tweaks-Seite offen und das Fenster sichtbar ist.

const REFRESH_MS = 2000

let timer: number | undefined

function percent(value: number) {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} %`
}

function render(usage: AppResources) {
  const rows = usage.parts
    .map(
      (part) => `
        <div class="tw-res-row">
          <span>${escapeHtml(part.name)}${part.processes > 1 ? ` <span class="muted">(${part.processes})</span>` : ''}</span>
          <span>${percent(part.cpuPercent)}</span>
          <span>${formatBytes(part.memoryBytes)}</span>
          <span>${part.threads}</span>
        </div>`,
    )
    .join('')
  $('tw-resources').innerHTML = `
    <article class="card tw-card">
      <div class="tw-card-head">
        <span class="tw-card-icon">${icon('pulse')}</span>
        <div class="tw-card-title">
          <span class="type-body-strong">Verbrauch dieser App</span>
          <span class="type-caption muted">Inklusive Fenster (WebView2) und Self-Clip – aktualisiert alle 2 Sekunden.</span>
        </div>
      </div>
      <div class="tw-res-facts">
        <div><span class="type-caption muted">CPU</span><span class="type-subtitle">${percent(usage.cpuPercent)}</span></div>
        <div><span class="type-caption muted">Arbeitsspeicher</span><span class="type-subtitle">${formatBytes(usage.memoryBytes)}</span></div>
        <div><span class="type-caption muted">Threads</span><span class="type-subtitle">${usage.threads}</span></div>
      </div>
      <div class="tw-res-table type-caption">
        <div class="tw-res-row tw-res-head muted"><span>Teil</span><span>CPU</span><span>Speicher</span><span>Threads</span></div>
        ${rows}
      </div>
    </article>`
}

function visible() {
  const page = document.querySelector<HTMLElement>('[data-page="tweaks"]')
  return !!page && !page.hidden && document.visibilityState === 'visible'
}

async function refresh() {
  if (!visible()) return stopResources()
  try {
    render(await backend.appResources())
  } catch {
    // Messung ist nur eine Anzeige – beim nächsten Durchlauf erneut versuchen.
  }
}

/** Beim Öffnen der Tweaks-Seite; endet von selbst, sobald sie nicht mehr sichtbar ist. */
export function startResources() {
  window.clearInterval(timer)
  void refresh()
  timer = window.setInterval(() => void refresh(), REFRESH_MS)
}

export function stopResources() {
  window.clearInterval(timer)
  timer = undefined
}

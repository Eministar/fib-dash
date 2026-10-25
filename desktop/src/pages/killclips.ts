import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  backend,
  type KillClipConfig,
  type KillClipEvent,
  type KillClipScreenshot,
  type KillClipStatus,
  type Region,
} from '../backend'
import { $, errorText, escapeHtml, selectValue, showMessage, textOf, type DropdownElement } from '../dom'
import { clipperName, formatBytes, formatDateTime } from '../format'
import { icon, type IconName } from '../icons'
import { onStateChange, state } from '../store'
import { toast } from '../ui/toast'

type DialogElement = HTMLElement & { show(): void; hide(): void }

const DEFAULT_CONFIG: KillClipConfig = {
  playerName: '',
  killfeed: null,
  hitmarker: null,
  hitmarkerThreshold: 0.25,
  useMarker: true,
  mergeSeconds: 60,
  preSeconds: 3,
  postSeconds: 3,
  replaySeconds: 60,
  deleteSource: true,
}

let status: KillClipStatus | null = null
const history: KillClipEvent[] = []

function config(): KillClipConfig {
  return { ...DEFAULT_CONFIG, ...state.settings?.settings.killClip }
}

async function saveConfig(patch: Partial<KillClipConfig>) {
  try {
    state.settings = await backend.killClipSaveConfig({ ...config(), ...patch })
    renderConfig()
  } catch (error) {
    toast(errorText(error), 'error')
  }
}

// ── Status ───────────────────────────────────────────────────────────

const PHASES: Record<string, { title: string; detail: string; icon: IconName; tone: string }> = {
  idle: { title: 'Aus', detail: 'Starte die Erkennung, bevor du ins Spiel gehst.', icon: 'target', tone: '' },
  watching: { title: 'Läuft – wartet auf Kills', detail: 'Die App schaut auf den Kill-Feed. Du kannst das Fenster schließen, sie läuft im Tray weiter.', icon: 'target', tone: 'live' },
  saving: { title: 'Speichert die Aufnahme …', detail: 'Das Clip-Programm legt gerade den Replay ab.', icon: 'videoClip', tone: 'busy' },
  rendering: { title: 'Schneidet und komprimiert …', detail: 'Läuft über die Grafikkarte – im Spiel kann es kurz ruckeln.', icon: 'cut', tone: 'busy' },
  uploading: { title: 'Lädt hoch …', detail: 'Der Bot postet den Clip gleich in deinen Channel.', icon: 'cloudUpload', tone: 'busy' },
}

function renderStatus() {
  const phase = PHASES[status?.running ? status.phase || 'watching' : status?.phase && status.phase !== 'watching' ? status.phase : 'idle'] ?? PHASES.idle
  const running = !!status?.running
  const pending = status?.pendingKills ?? 0
  $('kc-state-title').textContent = phase.title
  $('kc-state-detail').textContent =
    running && pending ? `${pending} ${pending === 1 ? 'Kill' : 'Kills'} in der aktuellen Serie – das Video folgt, sobald es ruhig wird.` : phase.detail
  const iconEl = $('kc-state-icon')
  iconEl.className = `kc-state-icon ${phase.tone}`
  iconEl.innerHTML = icon(phase.icon)

  const toggle = $('kc-toggle')
  toggle.innerHTML = `${icon(running ? 'stop' : 'target').replace('<i ', '<i slot="start" ')}${running ? 'Beenden' : 'Starten'}`
  toggle.setAttribute('appearance', running ? 'outline' : 'primary')

  const target = status?.target
  if (target) {
    $('kc-channel').textContent = target.channel ? `#${target.channel.name}` : 'Kein Clips-Channel'
    $('kc-limit').textContent = target.channel
      ? `Videos bis ${formatBytes(target.limitBytes)} – größere Serien werden aufgeteilt`
      : (target.reason ?? 'Videos werden nur lokal gespeichert')
  }
  showMessage('kc-error', status?.error ?? null)

  const feed = $('kc-feed')
  feed.hidden = !running || !status?.lastFeed
  feed.textContent = status?.lastFeed ? `Zuletzt im Kill-Feed gelesen: ${status.lastFeed}` : ''
}

function renderConfig() {
  const c = config()
  const parts = [
    c.killfeed ? 'Bereich festgelegt – erkennt „Du hast … getötet“' : 'Bereich fehlt',
    c.useMarker ? (c.hitmarker ? 'Kill-Marker angelernt' : 'Kill-Marker in der Bildmitte') : '',
  ].filter(Boolean)
  $('kc-setup-state').textContent = parts.join(' · ')
  ;($('kc-marker') as HTMLElement & { checked: boolean }).checked = c.useMarker
  selectValue($<DropdownElement>('kc-padding'), String(c.preSeconds))
  selectValue($<DropdownElement>('kc-merge'), String(c.mergeSeconds))
  ;($('kc-delete') as HTMLElement & { checked: boolean }).checked = c.deleteSource
  $('kc-clipper').textContent = clipperName(state.settings?.settings.clipper)

  showMessage('kc-info', c.killfeed ? null : 'Richte zuerst den Kill-Feed ein: Bereich, in dem „Du hast … getötet“ erscheint.')
}

// ── Verlauf ──────────────────────────────────────────────────────────

const EVENT_ICON: Record<KillClipEvent['kind'], IconName> = {
  kill: 'target',
  death: 'dismiss',
  warning: 'warning',
  rendered: 'filmstrip',
  uploaded: 'checkmarkCircle',
  error: 'errorCircle',
}

function renderHistory() {
  const list = $('kc-history')
  if (!history.length) {
    list.innerHTML = '<div class="empty small">Noch nichts passiert. Erkannte Kills und fertige Clips erscheinen hier.</div>'
    return
  }
  list.innerHTML = history
    .map(
      (event, index) => `
      <div class="kc-event ${event.kind}">
        <span class="kc-event-icon">${icon(EVENT_ICON[event.kind])}</span>
        <span class="kc-event-text">
          <span class="truncate">${escapeHtml(event.message)}</span>
          <span class="type-caption muted">${escapeHtml(formatDateTime(new Date(event.at)))}</span>
        </span>
        <span class="row-actions">
          ${event.link ? `<fluent-button size="small" appearance="subtle" data-link="${index}">In Discord öffnen</fluent-button>` : ''}
          ${event.path ? `<fluent-button size="small" appearance="subtle" data-reveal="${index}">Im Ordner zeigen</fluent-button>` : ''}
        </span>
      </div>`,
    )
    .join('')
}

// ── Einrichtung ──────────────────────────────────────────────────────

let shot: { width: number; height: number } | null = null
let draft: { killfeed: Region | null; hitmarker: Region | null } = { killfeed: null, hitmarker: null }
let mode: 'killfeed' | 'hitmarker' = 'killfeed'

// Rahmen in Prozent des Bildes: bleibt richtig, egal wann und wie groß das Bild gerade dargestellt wird
// (z. B. wenn der Screenshot ankommt, während das Fenster hinter dem Spiel liegt).
function placeRects() {
  for (const [key, id] of [['killfeed', 'kc-rect-feed'], ['hitmarker', 'kc-rect-hit']] as const) {
    const rect = draft[key]
    const el = $(id)
    el.hidden = !rect || !shot
    if (rect && shot) {
      const { width, height } = shot
      Object.assign(el.style, {
        left: `${(rect.x / width) * 100}%`,
        top: `${(rect.y / height) * 100}%`,
        width: `${(rect.width / width) * 100}%`,
        height: `${(rect.height / height) * 100}%`,
      })
    }
  }
}

async function runFeedTest() {
  const box = $('kc-test')
  if (!shot) {
    box.hidden = true
    return
  }
  box.hidden = false
  box.innerHTML = `<span class="muted">Lese den Screenshot …</span>`
  try {
    const parts: string[] = []
    if (draft.killfeed) {
      const result = await backend.killClipTestFeed(draft.killfeed)
      const rows = [
        ...result.kills.map((name) => `<div class="kc-test-line hit">${icon('checkmarkCircle')}<span>Kill: ${escapeHtml(name)}</span><span class="pill tone-success">Clip</span></div>`),
        ...result.deaths.map((name) => `<div class="kc-test-line death">${icon('dismiss')}<span>Getötet von ${escapeHtml(name)}</span><span class="pill tone-subtle">kein Clip</span></div>`),
      ]
      const read = result.lines.length
        ? `<span class="type-caption muted">Gelesen: ${escapeHtml(result.lines.join(' · '))}</span>`
        : '<span class="type-caption muted">Kein Text erkannt – Rahmen enger um die Meldungen ziehen.</span>'
      parts.push(
        `<span class="type-body-strong">Kill-Feed</span>${rows.join('') || '<span class="muted">Keine Meldung „Du hast … getötet“ oder „Du wurdest von … getötet“ gefunden.</span>'}${read}`,
      )
    }
    if (config().useMarker) {
      const score = await backend.killClipTestMarker(draft.hitmarker)
      const seen = score >= 0.2
      parts.push(
        `<span class="type-body-strong">Kill-Marker</span><div class="kc-test-line ${seen ? 'hit' : ''}">${icon(seen ? 'checkmarkCircle' : 'dismiss')}<span>${seen ? 'Türkiser Marker am Fadenkreuz erkannt' : 'Kein Marker auf diesem Screenshot'} (Wert ${score.toFixed(2)})</span></div>`,
      )
    }
    box.innerHTML = parts.join('<hr class="kc-test-sep">') || '<span class="muted">Zieh einen Rahmen um den Kill-Feed.</span>'
  } catch (error) {
    box.innerHTML = `<span class="muted">${escapeHtml(errorText(error))}</span>`
  }
}

function showShot(payload: KillClipScreenshot) {
  if (payload.error || !payload.path) {
    toast(payload.error ?? 'Screenshot fehlgeschlagen', 'error')
    return
  }
  shot = { width: payload.width!, height: payload.height! }
  const img = $<HTMLImageElement>('kc-shot')
  img.onload = () => {
    placeRects()
    void runFeedTest()
  }
  img.src = `${convertFileSrc(payload.path)}?t=${payload.at ?? Date.now()}`
  img.hidden = false
  $('kc-canvas-empty').hidden = true
  toast('Screenshot aufgenommen')
}

function bindCanvas() {
  const canvas = $('kc-canvas')
  let start: { x: number; y: number } | null = null
  const point = (event: PointerEvent) => {
    const box = $<HTMLImageElement>('kc-shot').getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(shot!.width, ((event.clientX - box.left) / box.width) * shot!.width)),
      y: Math.max(0, Math.min(shot!.height, ((event.clientY - box.top) / box.height) * shot!.height)),
    }
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!shot || $('kc-shot').hidden) return
    canvas.setPointerCapture(event.pointerId)
    start = point(event)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!start) return
    const p = point(event)
    draft[mode] = {
      x: Math.round(Math.min(start.x, p.x)),
      y: Math.round(Math.min(start.y, p.y)),
      width: Math.round(Math.abs(p.x - start.x)),
      height: Math.round(Math.abs(p.y - start.y)),
    }
    placeRects()
  })
  canvas.addEventListener('pointerup', () => {
    if (!start) return
    start = null
    const rect = draft[mode]
    // Versehentliche Klicks verwerfen.
    if (rect && (rect.width < 8 || rect.height < 8)) {
      draft[mode] = null
      placeRects()
      return
    }
    void runFeedTest()
  })
}

async function openSetup() {
  const c = config()
  draft = { killfeed: c.killfeed, hitmarker: c.hitmarker }
  mode = 'killfeed'
  $('kc-mode').setAttribute('activeid', 'kc-mode-feed')
  try {
    const hotkey = await backend.killClipCalibration(true)
    $('kc-hotkey').textContent = hotkey.replace('Ctrl', 'Strg')
  } catch (error) {
    toast(errorText(error), 'error')
  }
  $<DialogElement>('kc-setup-dialog').show()
  placeRects()
}

async function saveSetup() {
  if (draft.hitmarker && shot) {
    try {
      await backend.killClipSetHitmarker(draft.hitmarker)
    } catch (error) {
      return toast(errorText(error), 'error')
    }
  }
  // Ohne neuen Screenshot bleibt eine bestehende Hitmarker-Vorlage gültig.
  await saveConfig({ killfeed: draft.killfeed, hitmarker: draft.hitmarker })
  $<DialogElement>('kc-setup-dialog').hide()
  toast('Erkennung gespeichert')
}

// ── Start ────────────────────────────────────────────────────────────

async function toggle() {
  const button = $('kc-toggle') as HTMLElement & { disabled: boolean }
  button.disabled = true
  try {
    if (status?.running) {
      await backend.killClipStop()
      status = await backend.killClipStatus()
    } else {
      status = await backend.killClipStart()
    }
    renderStatus()
  } catch (error) {
    toast(errorText(error), 'error')
  } finally {
    button.disabled = false
  }
}

export function initKillClips() {
  $('kc-toggle').addEventListener('click', () => void toggle())
  $('kc-setup').addEventListener('click', () => void openSetup())
  $('kc-open-settings').addEventListener('click', () => $('nav-settings').click())
  $('kc-folder').addEventListener('click', () => void backend.killClipReveal().catch((e) => toast(errorText(e), 'error')))
  $('kc-marker').addEventListener('change', () => void saveConfig({ useMarker: ($('kc-marker') as HTMLElement & { checked: boolean }).checked }))
  $('kc-padding').addEventListener('change', () => {
    const seconds = Number(($('kc-padding') as DropdownElement).value)
    if (seconds && seconds !== config().preSeconds) void saveConfig({ preSeconds: seconds, postSeconds: seconds })
  })
  $('kc-merge').addEventListener('change', () => {
    const seconds = Number(($('kc-merge') as DropdownElement).value)
    if (seconds && seconds !== config().mergeSeconds) void saveConfig({ mergeSeconds: seconds })
  })
  $('kc-delete').addEventListener('change', () => void saveConfig({ deleteSource: ($('kc-delete') as HTMLElement & { checked: boolean }).checked }))
  $('kc-history').addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const link = target.closest<HTMLElement>('[data-link]')
    const reveal = target.closest<HTMLElement>('[data-reveal]')
    if (link) void backend.killClipOpenLink(history[Number(link.dataset.link)].link!).catch((e) => toast(errorText(e), 'error'))
    if (reveal) void backend.killClipReveal(history[Number(reveal.dataset.reveal)].path!).catch((e) => toast(errorText(e), 'error'))
  })

  // Einrichtung
  bindCanvas()
  $('kc-mode-feed').addEventListener('click', () => (mode = 'killfeed'))
  $('kc-mode-hit').addEventListener('click', () => (mode = 'hitmarker'))
  $('kc-shot-now').addEventListener('click', () => void backend.killClipScreenshot())
  $('kc-setup-save').addEventListener('click', () => void saveSetup())
  $('kc-setup-cancel').addEventListener('click', () => $<DialogElement>('kc-setup-dialog').hide())
  $('kc-setup-dialog').addEventListener('toggle', (event) => {
    if ((event as unknown as CustomEvent<{ newState: string }>).detail?.newState === 'closed') void backend.killClipCalibration(false)
  })

  void listen<KillClipStatus>('killclip-status', (event) => {
    status = event.payload
    renderStatus()
  })
  void listen<KillClipEvent>('killclip-event', (event) => {
    history.unshift(event.payload)
    history.length = Math.min(history.length, 60)
    renderHistory()
    if (event.payload.kind === 'uploaded') toast(event.payload.message)
    if (event.payload.kind === 'error') toast(event.payload.message, 'error')
  })
  void listen<KillClipScreenshot>('killclip-screenshot', (event) => showShot(event.payload))

  onStateChange(renderConfig)
  renderHistory()
}

export function showKillClips() {
  renderConfig()
  void backend.killClipStatus().then((s) => {
    status = s
    renderStatus()
  })
}

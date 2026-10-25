import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import {
  backend,
  type KillClipConfig,
  type KillClipEvent,
  type KillClipReference,
  type KillClipReferenceClip,
  type KillClipStatus,
  type Region,
} from '../backend'
import { $, errorText, escapeHtml, selectValue, showMessage, textOf, type DropdownElement } from '../dom'
import { clipperName, formatBytes, formatDateTime } from '../format'
import { icon, icons, type IconName } from '../icons'
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
    c.killfeed ? 'Kill-Feed – bestätigt „Du hast … getötet“ durch zwei Lesungen' : 'Kill-Feed-Bereich fehlt',
    c.useMarker && !c.killfeed ? 'Kill-Marker am Fadenkreuz' : '',
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
//
// Ablauf: Kill im Spiel aufnehmen (Einrichtungstaste oder vorhandener Clip) → in der
// Zeitleiste den Moment des Kills markieren → die App wertet die Bilder darum aus und
// zeigt das Ergebnis als Referenz. Die Rahmen lassen sich danach noch verschieben.

type SetupView = 'empty' | 'saving' | 'clip' | 'analyzing' | 'reference'

let view: SetupView = 'empty'
let clip: { path: string; duration: number } | null = null
let reference: KillClipReference | null = null
let shot: { width: number; height: number } | null = null
// Der Marker-Bereich liegt immer auf dem Fadenkreuz – nur der Kill-Feed-Rahmen lässt sich ziehen.
let draft: { killfeed: Region | null; hitmarker: Region | null } = { killfeed: null, hitmarker: null }

const kcVideo = () => $<HTMLVideoElement>('kc-video')

const EMPTY_TEXT: Partial<Record<SetupView, string>> = {
  empty: 'Noch keine Aufnahme – mach im Spiel einen Kill und drück <kbd>Strg+Alt+K</kbd>',
  saving: 'Dein Clip-Programm speichert die Aufnahme …',
  analyzing: 'Die App sieht sich deinen Kill an …',
}

function setView(next: SetupView, hint = '') {
  view = next
  $('kc-clip').hidden = next !== 'clip'
  $('kc-canvas').hidden = next === 'clip'
  $('kc-canvas-empty').hidden = next === 'reference'
  $('kc-shot').hidden = next !== 'reference'
  if (EMPTY_TEXT[next]) $('kc-canvas-empty-text').innerHTML = EMPTY_TEXT[next]!
  $('kc-back').hidden = next !== 'reference' || !clip
  $('kc-test').hidden = next !== 'reference'
  $('kc-setup-hint').textContent = hint
  if (next !== 'clip') kcVideo().pause()
  placeRects()
}

// ── Zeitleiste ──

function clock(seconds: number) {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`
}

const clipDuration = () => clip?.duration || kcVideo().duration || 0

function renderTimeline() {
  const v = kcVideo()
  const duration = clipDuration()
  const percent = (t: number) => `${duration ? (t / duration) * 100 : 0}%`
  $('kc-playhead').style.left = percent(v.currentTime)
  $('kc-time').textContent = `${clock(v.currentTime)} / ${clock(duration)}`
  const flag = $('kc-kill-flag')
  flag.hidden = !reference
  if (reference) flag.style.left = percent(reference.at)
  $('kc-play-icon').innerHTML = (v.paused ? icons.play : icons.pause).replace('<svg ', '<svg aria-hidden="true" fill="currentColor" ')
}

function seek(seconds: number) {
  kcVideo().currentTime = Math.min(Math.max(0, seconds), Math.max(0, clipDuration() - 0.05))
  renderTimeline()
}

/** `startAt` negativ = so viele Sekunden vor dem Ende. */
function loadClip(path: string, duration: number, startAt: number) {
  clip = { path, duration }
  reference = null
  const v = kcVideo()
  v.onloadedmetadata = () => {
    if (!clip!.duration && Number.isFinite(v.duration)) clip!.duration = v.duration
    seek(startAt < 0 ? clip!.duration + startAt : startAt)
  }
  v.src = convertFileSrc(path)
  setView('clip', 'Spul zum Kill und klick „Hier ist der Kill“ – mit ← und → gehst du in kleinen Schritten.')
}

function bindTimeline() {
  const v = kcVideo()
  for (const event of ['timeupdate', 'play', 'pause', 'seeked']) v.addEventListener(event, renderTimeline)
  v.addEventListener('error', () => {
    if (view === 'clip') setView('empty', 'Der Clip lässt sich hier nicht abspielen – nimm einen anderen.')
  })
  const track = $('kc-track')
  const at = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect()
    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) * clipDuration()
  }
  track.addEventListener('pointerdown', (event) => {
    track.setPointerCapture(event.pointerId)
    v.pause()
    seek(at(event))
  })
  track.addEventListener('pointermove', (event) => {
    if (track.hasPointerCapture(event.pointerId)) seek(at(event))
  })
  const togglePlay = () => void (v.paused ? v.play() : v.pause())
  $('kc-play').addEventListener('click', togglePlay)
  $('kc-step-back').addEventListener('click', () => seek(v.currentTime - 0.1))
  $('kc-step-forward').addEventListener('click', () => seek(v.currentTime + 0.1))
  $('kc-setup-dialog').addEventListener('keydown', (event) => {
    if (view !== 'clip') return
    const step = event.shiftKey ? 1 : 0.1
    if (event.key === 'ArrowLeft') seek(v.currentTime - step)
    else if (event.key === 'ArrowRight') seek(v.currentTime + step)
    else if (event.key === ' ') togglePlay()
    else return
    event.preventDefault()
  })
  $('kc-mark').addEventListener('click', () => void analyze(v.currentTime))
}

// ── Auswertung und Referenz ──

async function analyze(at: number) {
  if (!clip) return
  setView('analyzing')
  try {
    reference = await backend.killClipAnalyze(clip.path, at)
  } catch (error) {
    toast(errorText(error), 'error')
    return setView('clip')
  }
  draft = {
    killfeed: reference.killfeed ?? draft.killfeed,
    hitmarker: reference.hitmarker ?? draft.hitmarker,
  }
  showReferenceImage()
  const found = [reference.killfeed && 'Kill-Feed', reference.hitmarker && 'Kill-Marker'].filter(Boolean)
  setView(
    'reference',
    found.length
      ? `Gefunden: ${found.join(' und ')}. Passt der Kill-Feed-Rahmen nicht, zieh ihn neu.`
      : 'Nichts gefunden – zieh selbst einen Rahmen um „Du hast … getötet“ oder wähl einen anderen Moment.',
  )
}

function showReferenceImage() {
  if (!reference) return
  shot = { width: reference.width, height: reference.height }
  const img = $<HTMLImageElement>('kc-shot')
  img.onload = () => {
    placeRects()
    void runFeedTest()
  }
  img.src = `${convertFileSrc(reference.path)}?t=${Date.now()}`
}

// Rahmen in Prozent des Bildes: bleibt richtig, egal wann und wie groß das Bild gerade dargestellt wird.
function placeRects() {
  for (const [key, id] of [['killfeed', 'kc-rect-feed'], ['hitmarker', 'kc-rect-hit']] as const) {
    const rect = draft[key]
    const el = $(id)
    el.hidden = !rect || !shot || view !== 'reference'
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

/** Ausschnitt eines Bildes als Kachel – so sieht die App den Kill. */
function cropHtml(src: string, rect: Region, size: { width: number; height: number }, label: string) {
  const x = size.width > rect.width ? (rect.x / (size.width - rect.width)) * 100 : 0
  const y = size.height > rect.height ? (rect.y / (size.height - rect.height)) * 100 : 0
  const style = [
    `aspect-ratio:${rect.width}/${rect.height}`,
    `background-image:url('${src}')`,
    `background-size:${(size.width / rect.width) * 100}% auto`,
    `background-position:${x}% ${y}%`,
  ].join(';')
  return `<figure class="kc-crop"><div class="kc-crop-img" style="${escapeHtml(style)}"></div><figcaption class="type-caption muted">${escapeHtml(label)}</figcaption></figure>`
}

function referenceHtml() {
  if (!reference || !shot) return ''
  const stamp = `?t=${reference.at}`
  const frame = convertFileSrc(reference.path) + stamp
  const markerFrame = (reference.markerPath ? convertFileSrc(reference.markerPath) : convertFileSrc(reference.path)) + stamp
  const crops = [
    draft.killfeed ? cropHtml(frame, draft.killfeed, shot, reference.victim ? `Kill-Feed: Du hast ${reference.victim} getötet` : 'Kill-Feed') : '',
    draft.hitmarker ? cropHtml(markerFrame, draft.hitmarker, shot, 'Kill-Marker am Fadenkreuz') : '',
  ].join('')
  return crops ? `<span class="type-body-strong">So sieht dein Kill aus</span><div class="kc-crops">${crops}</div>` : ''
}

async function runFeedTest() {
  const box = $('kc-test')
  if (!shot || view !== 'reference') return
  box.innerHTML = `<span class="muted">Lese das Bild …</span>`
  try {
    const parts: string[] = []
    const crops = referenceHtml()
    if (crops) parts.push(crops)
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
      const score = await backend.killClipTestMarker()
      const seen = score >= 0.25
      parts.push(
        `<span class="type-body-strong">Kill-Marker</span><div class="kc-test-line ${seen ? 'hit' : ''}">${icon(seen ? 'checkmarkCircle' : 'dismiss')}<span>${seen ? 'Türkiser Marker am Fadenkreuz erkannt' : 'Kein Marker an dieser Stelle'} (Wert ${score.toFixed(2)})</span></div>`,
      )
    }
    box.innerHTML = parts.join('<hr class="kc-test-sep">') || '<span class="muted">Zieh einen Rahmen um den Kill-Feed.</span>'
  } catch (error) {
    box.innerHTML = `<span class="muted">${escapeHtml(errorText(error))}</span>`
  }
}

function onReferenceClip(payload: KillClipReferenceClip) {
  if (payload.saving) return setView('saving')
  if (payload.error || !payload.path) {
    toast(payload.error ?? 'Aufnahme fehlgeschlagen', 'error')
    return setView(reference ? 'reference' : clip ? 'clip' : 'empty')
  }
  // Der Kill war kurz vor dem Druck auf die Taste – dort anfangen.
  loadClip(payload.path, payload.duration ?? 0, -3)
  toast('Aufnahme gespeichert – jetzt den Kill markieren')
}

async function pickClip() {
  const settings = state.settings
  const path = await open({
    multiple: false,
    directory: false,
    defaultPath: settings?.settings.clipDir || settings?.defaultClipDir,
    filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm'] }],
  })
  if (typeof path === 'string') loadClip(path, 0, 0)
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
    if (!shot || view !== 'reference') return
    canvas.setPointerCapture(event.pointerId)
    start = point(event)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!start) return
    const p = point(event)
    draft.killfeed = {
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
    const rect = draft.killfeed
    // Versehentliche Klicks verwerfen.
    if (rect && (rect.width < 8 || rect.height < 8)) {
      draft.killfeed = null
      placeRects()
      return
    }
    void runFeedTest()
  })
}

async function openSetup() {
  const c = config()
  if (!reference) {
    draft = { killfeed: c.killfeed, hitmarker: c.hitmarker }
    // Nach einem Neustart die gespeicherte Einrichtung zeigen statt eines leeren Dialogs.
    const saved = c.killfeed ? await backend.killClipSavedReference().catch(() => null) : null
    if (saved) {
      reference = { ...saved, at: 0, killfeed: c.killfeed, victim: null, line: null, markerScore: 0 }
      draft.hitmarker = saved.hitmarker
      showReferenceImage()
    }
  }
  try {
    const hotkey = await backend.killClipCalibration(true)
    $('kc-hotkey').textContent = hotkey.replace('Ctrl', 'Strg')
  } catch (error) {
    toast(errorText(error), 'error')
  }
  setView(reference ? 'reference' : clip ? 'clip' : 'empty', reference ? 'Deine gespeicherte Einrichtung – oder nimm einen neuen Kill auf.' : '')
  $<DialogElement>('kc-setup-dialog').show()
  if (reference) void runFeedTest()
}

async function saveSetup() {
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
  bindTimeline()
  $('kc-pick').addEventListener('click', () => void pickClip())
  $('kc-back').addEventListener('click', () => {
    setView('clip', 'Spul zum Kill und klick „Hier ist der Kill“.')
    if (reference) seek(reference.at)
  })
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
  void listen<KillClipReferenceClip>('killclip-reference-clip', (event) => onReferenceClip(event.payload))

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

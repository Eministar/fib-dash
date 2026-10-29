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
import { $, errorText, escapeHtml, selectValue, showMessage, type DropdownElement } from '../dom'
import { clipperName, formatBytes, formatDateTime } from '../format'
import { icon, icons, type IconName } from '../icons'
import { onStateChange, state } from '../store'
import { toast } from '../ui/toast'
import { loadVideoFrame, videoErrorText } from '../ui/video-loading'

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
    return true
  } catch (error) {
    toast(errorText(error), 'error')
    return false
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

type SetupView = 'empty' | 'saving' | 'loading' | 'clip' | 'analyzing' | 'reference'

let view: SetupView = 'empty'
let clip: { path: string; duration: number } | null = null
let clipLoad: AbortController | null = null
let clipReady = false
let reference: KillClipReference | null = null
let shot: { width: number; height: number } | null = null
let setupOpen = false
let analysisPending = false
let savingSetup = false
let testRevision = 0
let feedVerified = false
let markerVerified = false
let regionInputsValid = true
// Der Marker-Bereich liegt immer auf dem Fadenkreuz – nur der Kill-Feed-Rahmen lässt sich ziehen.
let draft: { killfeed: Region | null; hitmarker: Region | null } = { killfeed: null, hitmarker: null }

const kcVideo = () => $<HTMLVideoElement>('kc-video')

const EMPTY_TEXT: Partial<Record<SetupView, string>> = {
  empty: 'Noch keine Aufnahme – mach im Spiel einen Kill und drück <kbd>Strg+Alt+K</kbd>',
  saving: 'Dein Clip-Programm speichert die Aufnahme …',
  loading: 'Das Videobild wird geladen …',
  analyzing: 'Die App sieht sich deinen Kill an …',
}

function setView(next: SetupView, hint = '') {
  ++testRevision
  feedVerified = false
  markerVerified = false
  view = next
  $('kc-clip').hidden = next !== 'clip'
  $('kc-canvas').hidden = next === 'clip'
  $('kc-canvas-empty').hidden = next === 'reference'
  $('kc-shot').hidden = next !== 'reference'
  if (EMPTY_TEXT[next]) $('kc-canvas-empty-text').innerHTML = EMPTY_TEXT[next]!
  $('kc-back').hidden = next !== 'reference' || !clip
  $('kc-test').hidden = next !== 'reference'
  $('kc-region-controls').hidden = next !== 'reference'
  const step = next === 'reference' ? 3 : next === 'clip' || next === 'loading' || next === 'analyzing' ? 2 : 1
  document.querySelectorAll<HTMLElement>('.kc-steps li').forEach((item, index) => {
    if (index + 1 === step) item.setAttribute('aria-current', 'step')
    else item.removeAttribute('aria-current')
  })
  $('kc-setup-progress').textContent = `Schritt ${step} von 3 · ${['Aufnahme wählen', 'Kill markieren', 'Ergebnis prüfen'][step - 1]}`
  setDisabled('kc-mark', !clipReady || analysisPending || clipDuration() <= 0)
  $('kc-setup-hint').textContent = hint
  if (next !== 'clip') kcVideo().pause()
  placeRects()
  updateSetupSave()
}

function setDisabled(id: string, disabled: boolean) {
  ($(id) as HTMLElement & { disabled: boolean }).disabled = disabled
}

function updateSetupSave() {
  const verified = draft.killfeed ? feedVerified : config().useMarker && markerVerified
  setDisabled('kc-setup-save', view !== 'reference' || !verified || !regionInputsValid || savingSetup || analysisPending)
  setDisabled('kc-pick', savingSetup || analysisPending || view === 'saving')
  for (const id of ['kc-back', 'kc-clear-feed', 'kc-retest', 'kc-region-x', 'kc-region-y', 'kc-region-width', 'kc-region-height']) setDisabled(id, savingSetup)
}

// ── Zeitleiste ──

function clock(seconds: number) {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`
}

const clipDuration = () => {
  const duration = clip?.duration || kcVideo().duration || 0
  return Number.isFinite(duration) ? duration : 0
}

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
  $('kc-play').setAttribute('aria-label', v.paused ? 'Abspielen' : 'Pausieren')
  const track = $('kc-track')
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', String(duration))
  track.setAttribute('aria-valuenow', String(v.currentTime))
  track.setAttribute('aria-valuetext', `${clock(v.currentTime)} von ${clock(duration)}`)
}

function seek(seconds: number) {
  if (!clipReady) return
  kcVideo().currentTime = Math.min(Math.max(0, seconds), Math.max(0, clipDuration() - 0.05))
  renderTimeline()
}

/** `startAt` negativ = so viele Sekunden vor dem Ende. */
async function loadClip(path: string, duration: number, startAt: number) {
  clipLoad?.abort()
  const request = new AbortController()
  clipLoad = request
  clipReady = false
  clip = { path, duration }
  reference = null
  shot = null
  draft = { killfeed: null, hitmarker: null }
  const v = kcVideo()
  setView('loading')
  try {
    const loadedDuration = await loadVideoFrame(v, convertFileSrc(path), { duration, startAt, signal: request.signal })
    if (request.signal.aborted || !setupOpen) return
    clip = { path, duration: loadedDuration }
    clipReady = true
    setView('clip', 'Spul zum Kill und klick „Hier ist der Kill“ – mit ← und → gehst du in kleinen Schritten.')
    renderTimeline()
  } catch (error) {
    if (request.signal.aborted) return
    clip = null
    v.removeAttribute('src')
    v.load()
    setView('empty', `Clip konnte nicht geöffnet werden: ${errorText(error)}`)
  } finally {
    if (clipLoad === request) clipLoad = null
  }
}

function bindTimeline() {
  const v = kcVideo()
  for (const event of ['timeupdate', 'play', 'pause', 'seeked']) v.addEventListener(event, renderTimeline)
  v.addEventListener('error', () => {
    if (clipReady && v.error) {
      clipReady = false
      clip = null
      if (view === 'clip') setView('empty', `Wiedergabe fehlgeschlagen: ${videoErrorText(v.error)}`)
    }
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
  const togglePlay = () => {
    if (!clipReady) return
    if (v.paused) void v.play().catch((error) => toast(errorText(error), 'error'))
    else v.pause()
  }
  $('kc-play').addEventListener('click', togglePlay)
  $('kc-step-back').addEventListener('click', () => seek(v.currentTime - 0.1))
  $('kc-step-forward').addEventListener('click', () => seek(v.currentTime + 0.1))
  $('kc-setup-dialog').addEventListener('keydown', (event) => {
    if (view !== 'clip') return
    if (event.composedPath().some((target) => target instanceof HTMLElement &&
      target.matches('input, textarea, fluent-button, button, [contenteditable="true"]'))) return
    const step = event.shiftKey ? 1 : 0.1
    if (event.key === 'ArrowLeft') seek(v.currentTime - step)
    else if (event.key === 'ArrowRight') seek(v.currentTime + step)
    else if (event.key === 'Home') seek(0)
    else if (event.key === 'End') seek(clipDuration())
    else if (event.key === ' ') togglePlay()
    else return
    event.preventDefault()
  })
  $('kc-mark').addEventListener('click', () => void analyze(v.currentTime))
}

// ── Auswertung und Referenz ──

async function analyze(at: number) {
  if (!clip || !clipReady || analysisPending || !Number.isFinite(at)) return
  analysisPending = true
  setView('analyzing')
  try {
    reference = await backend.killClipAnalyze(clip.path, at)
  } catch (error) {
    analysisPending = false
    toast(errorText(error), 'error')
    return setView('clip', 'Auswertung fehlgeschlagen. Wähle einen anderen Moment oder versuche es erneut.')
  }
  analysisPending = false
  draft = {
    killfeed: reference.killfeed,
    hitmarker: reference.hitmarker,
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
  regionInputsValid = true
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const input = $<HTMLInputElement>(`kc-region-${key}`)
    if (document.activeElement !== input) input.value = draft.killfeed ? String(draft.killfeed[key]) : ''
  }
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
  if (!shot || view !== 'reference' || !regionInputsValid || savingSetup) return
  const revision = ++testRevision
  feedVerified = false
  markerVerified = false
  updateSetupSave()
  const region = draft.killfeed ? { ...draft.killfeed } : null
  const current = () => revision === testRevision && view === 'reference' && setupOpen
  box.innerHTML = `<span class="muted">Lese das Bild …</span>`
  try {
    const parts: string[] = []
    const crops = referenceHtml()
    if (crops) parts.push(crops)
    let validFeed = false
    let validMarker = false
    if (region) {
      const result = await backend.killClipTestFeed(region)
      if (!current()) return
      validFeed = result.kills.length > 0
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
      // Der optionale Marker-Test darf einen erfolgreichen Kill-Feed-Test nicht blockieren.
      const score = await backend.killClipTestMarker().catch((error) => {
        if (!region) throw error
        return null
      })
      if (!current()) return
      const seen = score !== null && score >= 0.25
      validMarker = seen
      parts.push(
        `<span class="type-body-strong">Kill-Marker · Türkis oder Rot</span><div class="kc-test-line ${seen ? 'hit' : ''}">${icon(seen ? 'checkmarkCircle' : 'dismiss')}<span>${seen ? 'Marker am Fadenkreuz erkannt' : score === null ? 'Marker-Test nicht verfügbar' : 'Kein Marker an dieser Stelle'}${score === null ? '' : ` (Wert ${score.toFixed(2)})`}</span></div><span class="type-caption muted">${region ? 'Mit Kill-Feed zählen nur bestätigte Textmeldungen. Der Marker ist dafür nicht erforderlich.' : 'Ohne Kill-Feed wird der kurze Marker-Puls verwendet; Namen werden dabei nicht gelesen.'}</span>`,
      )
    }
    if (!current()) return
    feedVerified = validFeed
    markerVerified = validMarker
    box.innerHTML = parts.join('<hr class="kc-test-sep">') || '<span class="muted">Zieh einen Rahmen um den Kill-Feed.</span>'
  } catch (error) {
    if (!current()) return
    box.innerHTML = `<span class="muted">${escapeHtml(errorText(error))}</span>`
  } finally {
    if (current()) updateSetupSave()
  }
}

function onReferenceClip(payload: KillClipReferenceClip) {
  if (!setupOpen || analysisPending || savingSetup) return
  if (payload.saving) {
    if (clipLoad) {
      clipLoad.abort()
      clipLoad = null
      clip = null
      clipReady = false
    }
    return setView('saving')
  }
  if (payload.error || !payload.path) {
    toast(payload.error ?? 'Aufnahme fehlgeschlagen', 'error')
    return setView(reference ? 'reference' : clip ? 'clip' : 'empty')
  }
  // Der Kill war kurz vor dem Druck auf die Taste – dort anfangen.
  void loadClip(payload.path, payload.duration ?? 0, -3)
  toast('Aufnahme gespeichert – Videobild wird geladen')
}

async function pickClip() {
  if (analysisPending || savingSetup || view === 'saving') return
  const settings = state.settings
  const path = await open({
    multiple: false,
    directory: false,
    defaultPath: settings?.settings.clipDir || settings?.defaultClipDir,
    filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm'] }],
  })
  if (typeof path === 'string' && setupOpen && !analysisPending && (view as SetupView) !== 'saving') await loadClip(path, 0, 0)
}

function bindCanvas() {
  const canvas = $('kc-canvas')
  let start: { x: number; y: number } | null = null
  let previous: Region | null = null
  const point = (event: PointerEvent) => {
    const box = $<HTMLImageElement>('kc-shot').getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(shot!.width, ((event.clientX - box.left) / box.width) * shot!.width)),
      y: Math.max(0, Math.min(shot!.height, ((event.clientY - box.top) / box.height) * shot!.height)),
    }
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!shot || view !== 'reference' || savingSetup || event.button !== 0) return
    canvas.setPointerCapture(event.pointerId)
    start = point(event)
    previous = draft.killfeed
    ++testRevision
    feedVerified = false
    updateSetupSave()
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
      draft.killfeed = previous
      placeRects()
    }
    void runFeedTest()
  })
  canvas.addEventListener('pointercancel', () => {
    if (!start) return
    start = null
    draft.killfeed = previous
    placeRects()
    void runFeedTest()
  })
}

async function openSetup() {
  if (setupOpen) return
  setupOpen = true
  const c = config()
  draft = { killfeed: c.killfeed, hitmarker: c.hitmarker }
  if (!reference) {
    // Nach einem Neustart die gespeicherte Einrichtung zeigen statt eines leeren Dialogs.
    const saved = c.killfeed || c.hitmarker ? await backend.killClipSavedReference().catch(() => null) : null
    if (saved) {
      reference = { ...saved, at: 0, killfeed: c.killfeed, hitmarker: c.hitmarker, victim: null, line: null, markerScore: 0 }
      showReferenceImage()
    }
  }
  try {
    const hotkey = await backend.killClipCalibration(true)
    $('kc-hotkey').textContent = hotkey.replace('Ctrl', 'Strg')
  } catch (error) {
    toast(errorText(error), 'error')
  }
  setView(analysisPending ? 'analyzing' : reference ? 'reference' : clip ? 'clip' : 'empty', reference ? 'Prüfe den Kill-Feed-Ausschnitt. Zum Korrigieren einen neuen Rahmen ziehen oder die Werte darunter ändern.' : '')
  $<DialogElement>('kc-setup-dialog').show()
  if (reference) void runFeedTest()
}

async function saveSetup() {
  if (view !== 'reference' || savingSetup || analysisPending || !regionInputsValid || !(draft.killfeed ? feedVerified : config().useMarker && markerVerified)) return
  savingSetup = true
  updateSetupSave()
  const saved = await saveConfig({ killfeed: draft.killfeed, hitmarker: draft.hitmarker })
  savingSetup = false
  updateSetupSave()
  if (!saved) return
  $<DialogElement>('kc-setup-dialog').hide()
  toast(status?.running ? 'Gespeichert – Erkennung neu starten, um die Bereiche zu übernehmen.' : 'Erkennung gespeichert')
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
    renderStatus()
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
  $('kc-pick').addEventListener('click', () => void pickClip().catch((error) => toast(errorText(error), 'error')))
  $('kc-retest').addEventListener('click', () => void runFeedTest())
  $('kc-clear-feed').addEventListener('click', () => {
    if (savingSetup) return
    draft.killfeed = null
    placeRects()
    void runFeedTest()
  })
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    $(`kc-region-${key}`).addEventListener('input', () => {
      if (!shot || savingSetup) return
      ++testRevision
      regionInputsValid = false
      feedVerified = false
      updateSetupSave()
    })
    $(`kc-region-${key}`).addEventListener('change', () => {
      if (!shot || savingSetup) return
      const fields = ['x', 'y', 'width', 'height'].map((name) => $<HTMLInputElement>(`kc-region-${name}`).valueAsNumber)
      const [x, y, width, height] = fields
      if (!fields.every(Number.isInteger) || x < 0 || y < 0 || width < 8 || height < 8 || x + width > shot.width || y + height > shot.height) {
        $('kc-test').textContent = `Gib einen Bereich innerhalb des Bildes (${shot.width} × ${shot.height}) ein, mindestens 8 × 8 Pixel.`
        return
      }
      draft.killfeed = { x, y, width, height }
      placeRects()
      void runFeedTest()
    })
  }
  $('kc-back').addEventListener('click', () => {
    setView('clip', 'Spul zum Kill und klick „Hier ist der Kill“.')
    if (reference) seek(reference.at)
  })
  $('kc-setup-save').addEventListener('click', () => void saveSetup())
  $('kc-setup-cancel').addEventListener('click', () => $<DialogElement>('kc-setup-dialog').hide())
  $('kc-setup-dialog').addEventListener('toggle', (event) => {
    if ((event as unknown as CustomEvent<{ newState: string }>).detail?.newState === 'closed') {
      setupOpen = false
      if (clipLoad) {
        clipLoad.abort()
        clipLoad = null
        clip = null
        clipReady = false
        kcVideo().removeAttribute('src')
        kcVideo().load()
      }
      ++testRevision
      kcVideo().pause()
      void backend.killClipCalibration(false).catch((error) => toast(errorText(error), 'error'))
    }
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
  }).catch((error) => {
    renderStatus()
    showMessage('kc-error', `Status konnte nicht geladen werden: ${errorText(error)}`)
  })
}

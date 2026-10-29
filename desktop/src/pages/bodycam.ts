import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { backend, UNAUTHORIZED, type ClipInfo, type UploadProgress } from '../backend'
import {
  $,
  errorText,
  fillOptions,
  selectValue,
  showMessage,
  textOf,
  type ButtonElement,
  type DropdownElement,
  type ProgressElement,
  type ValueElement,
} from '../dom'
import { clipTitle, displayHotkey, formatBytes, formatClock, formatDateTime } from '../format'
import { icons } from '../icons'
import { createCase } from '../investigations/create-case'
import { autoRefresh } from '../ui/auto-refresh'
import { can, navigation, onStateChange, state } from '../store'

// Kürzere Abweichungen vom Clip-Anfang/-Ende gelten nicht als Schnitt.
const TRIM_TOLERANCE = 0.25
const MIN_RANGE = 1

const queue: ClipInfo[] = []
let busy = false
let creatingCase = false
const trim = { duration: 0, start: 0, end: 0 }

const video = () => $('clip-video') as HTMLVideoElement

// ── Status oben ──────────────────────────────────────────────────────

function renderIdle() {
  const settings = state.settings?.settings
  if (!settings) return
  const program = { nvidia: 'NVIDIA', medal: 'Medal', amd: 'AMD Software', selfclip: 'FIB Self-Clip' }[settings.clipper] ?? 'Das Clip-Programm'
  $('capture-title').textContent = 'Bereit'
  $('capture-hint').textContent =
    `Drücke ${displayHotkey(settings.bodycamHotkey)} im Spiel – ${program} speichert den Clip, danach bearbeitest du ihn hier.`
}

// ── Ziel: Ermittlungsakte oder Agent-Akte ────────────────────────────

/** Darf Clips als Beweis an einen Eintrag der Agent-Akte hängen (wie Akteneinträge anlegen). */
const canRecord = () => can('agents:write')

/** Wohin der Clip geht. Ohne Aktenrecht bleibt nur die Agent-Akte. */
function target(): 'investigation' | 'record' {
  if (!canRecord()) return 'investigation'
  if (!state.context?.canUpload) return 'record'
  return $<DropdownElement>('f-target').value === 'record' ? 'record' : 'investigation'
}

function applyTarget() {
  const record = target() === 'record'
  $('f-investigation-field').hidden = record
  $('f-investigation-new').hidden = record || !state.context?.canUpload || !can('investigations:manage')
  $('f-investigation-empty').hidden = record || !!state.context?.investigations.length
  $('f-investigation-empty').textContent = can('investigations:manage')
    ? 'Noch keine Akte vorhanden. Lege eine neue Akte für diesen Clip an.'
    : 'Keine Akte verfügbar. Zum Anlegen einer Akte benötigst du die Berechtigung zur Aktenverwaltung.'
  for (const field of document.querySelectorAll<HTMLElement>('.record-only')) field.hidden = !record
}

function renderContext() {
  const context = state.context
  if (!context) return
  const allowed = context.canUpload || canRecord()
  $('permission-warning').hidden = allowed
  ;($('capture-button') as ButtonElement).disabled = !allowed
  ;($('pick-button') as ButtonElement).disabled = !allowed
  // Die Wahl gibt es nur, wenn beides erlaubt ist.
  $('f-target-field').hidden = !(context.canUpload && canRecord())
  fillOptions('f-record-agent-list', context.agents)
  applyTarget()
  renderInvestigations()
  fillOptions('f-agent-list', context.agents)
  renderIdle()
  updateGpuWarning()
}

function renderInvestigations(selected = $<DropdownElement>('f-investigation').value) {
  // Eigene Akten zuerst – die braucht man fast immer.
  const investigations = [...(state.context?.investigations ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine))
  fillOptions('f-investigation-list', investigations.map((i) => ({ id: i.id, label: i.mine ? `★ ${i.label}` : i.label })))
  if (investigations.some((i) => i.id === selected)) selectValue($<DropdownElement>('f-investigation'), selected)
}

async function createClipCase() {
  const context = state.context
  if (busy || creatingCase || !context?.canUpload || !can('investigations:manage')) return
  creatingCase = true
  $<ButtonElement>('f-investigation-new').disabled = true
  video().pause()
  try {
    const created = await createCase()
    if (!created || state.context !== context) return
    context.investigations.push({ id: created.id, label: `${created.caseNumber} · ${created.title}`, mine: true })
    renderInvestigations(created.id)
    applyTarget()
    showMessage('upload-error', null)
  } catch (error) {
    showMessage('upload-error', errorText(error))
  } finally {
    creatingCase = false
    $<ButtonElement>('f-investigation-new').disabled = busy
  }
}

// ── Clip laden ───────────────────────────────────────────────────────

function addClip(clip: ClipInfo) {
  if (queue.some((queued) => queued.path === clip.path)) return
  queue.push(clip)
  showMessage('upload-success', null)
  if (queue.length === 1) openClip()
  else renderQueue()
}

function renderQueue() {
  const rest = queue.length - 1
  $('queue-label').textContent = rest > 0 ? `Danach noch ${rest} ${rest === 1 ? 'Clip' : 'Clips'} in der Warteschlange` : ''
}

function openClip() {
  const clip = queue[0]
  $('clip-editor').hidden = !clip
  renderQueue()
  if (!clip) {
    video().removeAttribute('src')
    video().load()
    return
  }

  trim.duration = clip.durationSeconds ?? 0
  trim.start = 0
  trim.end = trim.duration
  video().src = convertFileSrc(clip.path)

  const recordedAt = recordingStart(clip)
  $<ValueElement>('f-title').value = clipTitle(recordedAt)
  $<ValueElement>('f-location').value = ''
  $<ValueElement>('f-tags').value = ''
  $<ValueElement>('f-description').value = ''
  selectValue($<DropdownElement>('f-agent'), state.context?.ownAgent?.id)
  selectValue($<DropdownElement>('f-target'), state.context?.canUpload ? 'investigation' : 'record')
  selectValue($<DropdownElement>('f-record-kind'), 'POSITIVE')
  applyTarget()
  const last = state.settings?.settings.lastInvestigationId
  if (state.context?.investigations.some((i) => i.id === last)) selectValue($<DropdownElement>('f-investigation'), last)
  showMessage('upload-error', null)
  renderTrim()
}

/** Beginn der Aufnahme: Die Datei wird am Ende geschrieben, also Ende minus Länge. */
function recordingStart(clip: ClipInfo) {
  return new Date(clip.savedAt - trim.duration * 1000)
}

async function pickClip() {
  const settings = state.settings
  const path = await open({
    multiple: false,
    directory: false,
    defaultPath: settings?.settings.clipDir || settings?.defaultClipDir,
    filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm'] }],
  })
  if (typeof path !== 'string') return
  try {
    addClip(await backend.inspectClip(path))
  } catch (error) {
    showMessage('capture-error', errorText(error))
  }
}

// ── Player und Schnitt ───────────────────────────────────────────────

function isTrimmed() {
  return trim.duration > 0 && (trim.start > TRIM_TOLERANCE || trim.end < trim.duration - TRIM_TOLERANCE)
}

function willConvert() {
  return isTrimmed() || (state.settings?.settings.clipQuality ?? '720p') !== 'original'
}

function updateGpuWarning() {
  $('gpu-warning').hidden = !willConvert() || busy
}

function percent(seconds: number) {
  return trim.duration ? `${(seconds / trim.duration) * 100}%` : '0%'
}

function renderTrim() {
  const { start, end, duration } = trim
  $('trim-range').style.left = percent(start)
  $('trim-range').style.width = percent(end - start)
  $('trim-shade-left').style.width = percent(start)
  $('trim-shade-right').style.width = percent(duration - end)
  $('trim-start').style.left = percent(start)
  $('trim-end').style.left = percent(end)
  for (const [id, value] of [['trim-start', start], ['trim-end', end]] as const) {
    const handle = $(id)
    handle.setAttribute('aria-valuemin', '0')
    handle.setAttribute('aria-valuemax', String(Math.round(duration)))
    handle.setAttribute('aria-valuenow', String(Math.round(value)))
    handle.setAttribute('aria-valuetext', formatClock(value))
  }

  const clip = queue[0]
  if (clip) {
    $('fact-range').textContent = duration ? `${formatClock(start)} – ${formatClock(end)}` : 'ganzer Clip'
    $('fact-length').textContent = duration ? formatClock(end - start) + (isTrimmed() ? ` von ${formatClock(duration)}` : '') : 'unbekannt'
    $('fact-recorded').textContent = formatDateTime(new Date(recordingStart(clip).getTime() + start * 1000))
    $('fact-size').textContent = formatBytes(clip.sizeBytes)
    $('fact-size').title = clip.path
  }
  renderPlayhead()
  updateGpuWarning()
}

function renderPlayhead() {
  const current = video().currentTime || 0
  $('trim-playhead').style.left = percent(current)
  $('time-label').textContent = `${formatClock(current)} / ${formatClock(trim.duration)}`
}

function setPlaying(playing: boolean) {
  $('clip-editor').querySelector('.player')!.classList.toggle('playing', playing)
  $('play-icon').innerHTML = (playing ? icons.pause : icons.play).replace('<svg ', '<svg aria-hidden="true" fill="currentColor" ')
  $('play-button').setAttribute('aria-label', playing ? 'Pause' : 'Abspielen')
}

function togglePlay() {
  const v = video()
  if (v.paused) {
    // Wiedergabe immer innerhalb des Ausschnitts.
    if (v.currentTime < trim.start || v.currentTime >= trim.end - 0.05) v.currentTime = trim.start
    void v.play()
  } else {
    v.pause()
  }
}

function secondsAt(clientX: number) {
  const rect = $('trim-track').getBoundingClientRect()
  return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * trim.duration
}

function moveHandle(which: 'start' | 'end', seconds: number) {
  if (which === 'start') trim.start = Math.min(Math.max(0, seconds), trim.end - MIN_RANGE)
  else trim.end = Math.max(Math.min(trim.duration, seconds), trim.start + MIN_RANGE)
  video().currentTime = which === 'start' ? trim.start : trim.end
  renderTrim()
}

function bindTrimControls() {
  const v = video()
  v.addEventListener('loadedmetadata', () => {
    // MKV & Co.: Länge erst hier bekannt.
    if (!trim.duration && Number.isFinite(v.duration)) {
      trim.duration = v.duration
      trim.end = v.duration
      renderTrim()
    }
  })
  v.addEventListener('timeupdate', () => {
    if (!v.paused && v.currentTime >= trim.end) {
      v.pause()
      v.currentTime = trim.end
    }
    renderPlayhead()
  })
  v.addEventListener('play', () => setPlaying(true))
  v.addEventListener('pause', () => setPlaying(false))
  $('player-overlay').addEventListener('click', togglePlay)
  $('play-button').addEventListener('click', togglePlay)

  for (const which of ['start', 'end'] as const) {
    const handle = $(`trim-${which}`)
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      handle.setPointerCapture(event.pointerId)
      video().pause()
      const onMove = (e: PointerEvent) => moveHandle(which, secondsAt(e.clientX))
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    })
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 5 : 1
      const value = which === 'start' ? trim.start : trim.end
      if (event.key === 'ArrowLeft') moveHandle(which, value - step)
      else if (event.key === 'ArrowRight') moveHandle(which, value + step)
      else return
      event.preventDefault()
    })
  }
  // Klick auf die Spur springt an die Stelle.
  $('trim-track').addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).classList.contains('trim-handle')) return
    video().currentTime = Math.min(Math.max(secondsAt(event.clientX), trim.start), trim.end)
    renderPlayhead()
  })
  $('set-start').addEventListener('click', () => moveHandle('start', video().currentTime))
  $('set-end').addEventListener('click', () => moveHandle('end', video().currentTime))
  $('reset-trim').addEventListener('click', () => {
    trim.start = 0
    trim.end = trim.duration
    renderTrim()
  })
}

// ── Speichern und Hochladen ──────────────────────────────────────────

let progressStartedAt = 0
let progressStartBytes = 0

function showProgress(title: string, detail: string, value?: number) {
  $('progress-row').hidden = false
  $('progress-title').textContent = title
  $('progress-detail').textContent = detail
  const bar = $('progress-bar') as ProgressElement
  if (value === undefined) bar.removeAttribute('value')
  else bar.value = value
}

function renderUploadProgress(progress: UploadProgress) {
  const value = progress.totalBytes ? Math.round((progress.sentBytes / progress.totalBytes) * 100) : 0
  if (progress.phase === 'finishing') return showProgress('Wird im Dashboard abgelegt …', '', 100)
  if (!progressStartedAt) {
    progressStartedAt = Date.now()
    progressStartBytes = progress.sentBytes
  }
  const seconds = (Date.now() - progressStartedAt) / 1000
  const rate = seconds > 0.5 ? (progress.sentBytes - progressStartBytes) / seconds : 0
  showProgress('Wird hochgeladen …', `${value} % von ${formatBytes(progress.totalBytes)}${rate > 0 ? ` · ${formatBytes(rate)}/s` : ''}`, value)
}

function setBusy(active: boolean) {
  busy = active
  $<ButtonElement>('f-investigation-new').disabled = active || creatingCase
  if (!active) $('progress-row').hidden = true
  $('cancel-upload-button').hidden = !active
  $('discard-button').hidden = active
  ;($('upload-button') as ButtonElement).disabled = active
  for (const id of ['set-start', 'set-end', 'reset-trim']) ($(id) as ButtonElement).disabled = active
  progressStartedAt = 0
  updateGpuWarning()
}

async function save() {
  const clip = queue[0]
  if (!clip || busy) return
  const toRecord = target() === 'record'
  const investigationId = toRecord ? null : $<DropdownElement>('f-investigation').value || null
  const recordAgentId = toRecord ? $<DropdownElement>('f-record-agent').value || null : null
  const title = textOf('f-title')
  if (!toRecord && !investigationId) return showMessage('upload-error', can('investigations:manage')
    ? 'Bitte eine Ermittlungsakte auswählen oder über „Neue Akte“ anlegen.'
    : 'Bitte eine Ermittlungsakte auswählen.')
  if (toRecord && !recordAgentId) return showMessage('upload-error', 'Bitte den Agent auswählen, in dessen Akte der Eintrag kommt.')
  if (!title) return showMessage('upload-error', 'Bitte einen Titel angeben.')
  if (toRecord && title.length < 2) return showMessage('upload-error', 'Der Titel ist zu kurz.')

  video().pause()
  const quality = state.settings?.settings.clipQuality ?? '720p'
  const trimmed = isTrimmed()
  const text = (id: string) => textOf(id) || null
  showMessage('upload-error', null)
  setBusy(true)

  let converted: ClipInfo | null = null
  try {
    let upload = clip
    if (willConvert()) {
      const verb = trimmed && quality !== 'original' ? 'zugeschnitten und komprimiert' : trimmed ? 'zugeschnitten' : 'komprimiert'
      showProgress(`Clip wird ${verb} …`, 'Über die Grafikkarte', 0)
      converted = await backend.convertClip(clip.path, {
        start: trimmed ? trim.start : null,
        end: trimmed ? trim.end : null,
        duration: trim.duration,
        quality,
      })
      upload = converted
    }

    await backend.uploadClip(upload.path, {
      investigationId,
      // Agent-Akte: neuer Eintrag mit demselben Titel, die Beschreibung wird sein Text.
      ...(recordAgentId
        ? {
            agentRecord: {
              agentId: recordAgentId,
              kind: $<DropdownElement>('f-record-kind').value === 'NEGATIVE' ? 'NEGATIVE' : 'POSITIVE',
              title,
              content: text('f-description') ?? undefined,
            },
          }
        : {}),
      title,
      description: text('f-description'),
      location: text('f-location'),
      recordedAt: new Date(recordingStart(clip).getTime() + trim.start * 1000).toISOString(),
      recordedByAgentId: $<DropdownElement>('f-agent').value || null,
      durationSeconds: trim.duration ? trim.end - trim.start : clip.durationSeconds,
      tags: textOf('f-tags').split(',').map((tag) => tag.trim()).filter(Boolean),
      clientCompressed: quality !== 'original',
    })

    let place: string
    if (investigationId) {
      void backend.rememberInvestigation(investigationId)
      if (state.settings) state.settings.settings.lastInvestigationId = investigationId
      place = state.context?.investigations.find((i) => i.id === investigationId)?.label ?? 'die Akte'
    } else {
      const agent = state.context?.agents.find((a) => a.id === recordAgentId)?.label
      place = agent ? `die Agent-Akte von ${agent}` : 'die Agent-Akte'
    }
    queue.shift()
    openClip()
    showMessage('upload-success', `„${title}“ wurde in ${place} hochgeladen.`)
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) return navigation.signOut()
    showMessage('upload-error', errorText(error))
  } finally {
    if (converted) void backend.discardTrim(converted.path)
    setBusy(false)
  }
}

// ── Start ────────────────────────────────────────────────────────────

export async function initBodycam() {
  autoRefresh('bodycam', refreshBodycamContext)
  $('capture-button').addEventListener('click', () => backend.captureClip())
  $('pick-button').addEventListener('click', pickClip)
  $('upload-button').addEventListener('click', save)
  $('f-investigation-new').addEventListener('click', () => void createClipCase())
  $('f-target').addEventListener('change', applyTarget)
  $('cancel-upload-button').addEventListener('click', () => backend.cancelUpload())
  $('discard-button').addEventListener('click', () => {
    queue.shift()
    openClip()
  })
  bindTrimControls()
  onStateChange(renderContext)

  await listen<ClipInfo>('clip-ready', (event) => {
    renderIdle()
    addClip(event.payload)
    navigation.go('bodycam')
  })
  await listen<{ state: 'saving' | 'error'; message?: string }>('capture-status', (event) => {
    if (event.payload.state === 'saving') {
      showMessage('capture-error', null)
      $('capture-title').textContent = 'Clip wird gespeichert …'
      $('capture-hint').textContent = 'Warte auf die Datei vom Clip-Programm.'
    } else {
      renderIdle()
      showMessage('capture-error', event.payload.message ?? 'Clip konnte nicht gespeichert werden.')
    }
  })
  await listen<UploadProgress>('upload-progress', (event) => renderUploadProgress(event.payload))
  await listen<number>('convert-progress', (event) => {
    const value = Math.round(event.payload)
    showProgress($('progress-title').textContent ?? '', `${value} % · Über die Grafikkarte`, value)
  })
}

export function bodycamQueueLength() {
  return queue.length
}

let refreshingContext = false
export async function refreshBodycamContext() {
  const previous = state.context
  if (!previous || refreshingContext || busy || creatingCase) return
  refreshingContext = true
  try {
    const next = await backend.sessionContext()
    if (state.context !== previous) return
    // Nur die Auswahlliste ersetzen: laufender Schnitt und Formulare bleiben erhalten.
    previous.investigations = next.investigations
    renderInvestigations()
    applyTarget()
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) navigation.signOut()
    else showMessage('capture-error', `Akten konnten nicht aktualisiert werden: ${errorText(error)}`)
  } finally {
    refreshingContext = false
  }
}

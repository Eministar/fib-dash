import { listen } from '@tauri-apps/api/event'
import { backend, type SelfClipConfig, type SelfClipStatus } from '../backend'
import { $, errorText, selectValue, type DropdownElement } from '../dom'
import { formatBytes } from '../format'
import { state } from '../store'
import { toast } from '../ui/toast'

// FIB Self-Clip im Einstellungsdialog: Einrichtung (ffmpeg laden), Status, Qualität.

const DEFAULT_CONFIG: SelfClipConfig = { bufferSeconds: 120, bitrateMbps: 15, fps: 60, audio: true }

let status: SelfClipStatus | null = null
let installing = false
let timer: number | undefined

function config(): SelfClipConfig {
  return { ...DEFAULT_CONFIG, ...state.settings?.settings.selfClip }
}

function active() {
  return state.settings?.settings.clipper === 'selfclip'
}

function minutes(seconds: number) {
  return seconds >= 60 ? `${Math.round(seconds / 60)} Min.` : `${seconds} s`
}

function renderStatus() {
  const text = $('s-selfclip-status')
  const install = $('s-selfclip-install')
  const restart = $('s-selfclip-restart')
  install.hidden = installing || !status || status.installed
  restart.hidden = installing || !status?.installed || (status.running && !status.error)
  $('s-selfclip-progress').hidden = !installing
  if (installing) return
  if (!status) {
    text.textContent = 'Wird geprüft …'
  } else if (!status.installed) {
    text.textContent = `Einmalig den Aufnahme-Baustein ffmpeg laden (${formatBytes(status.downloadBytes)}) – danach nimmt die App selbst auf.`
    install.textContent = 'Einrichten'
  } else if (status.running) {
    const c = config()
    const sound = c.audio ? ` · Ton: ${status.audioSource ?? '–'}` : ''
    text.textContent = `Nimmt im Hintergrund auf · ${status.encoder ?? 'Grafikkarte'} · ${c.fps} fps · ${minutes(status.bufferedSeconds)} von ${minutes(c.bufferSeconds)} im Puffer${sound}`
  } else {
    text.textContent = status.error ?? 'Aufnahme ist gestoppt.'
  }
}

async function refresh() {
  try {
    status = await backend.selfClipStatus()
  } catch {
    status = null
  }
  renderStatus()
}

/** Wird von renderSettings aufgerufen, sobald sich die Einstellungen ändern. */
export function renderSelfClip() {
  const show = active()
  for (const row of document.querySelectorAll<HTMLElement>('.selfclip-only')) row.hidden = !show
  // Self-Clip speichert direkt – eine Speichertaste gibt es dort nicht.
  $('s-clipper-hotkey-row').hidden = show
  const c = config()
  selectValue($<DropdownElement>('s-selfclip-buffer'), String(c.bufferSeconds))
  selectValue($<DropdownElement>('s-selfclip-quality'), `${c.bitrateMbps}:${c.fps}`)
  ;($('s-selfclip-audio') as HTMLElement & { checked: boolean }).checked = c.audio
  window.clearInterval(timer)
  if (show) {
    void refresh()
    // Füllstand des Puffers mitlaufen lassen, solange der Dialog offen ist.
    timer = window.setInterval(() => {
      if ($('settings-dialog').querySelector('.selfclip-only')?.checkVisibility()) void refresh()
    }, 2000)
  }
}

async function save(patch: Partial<SelfClipConfig>) {
  try {
    state.settings = await backend.selfClipSaveConfig({ ...config(), ...patch })
    renderSelfClip()
  } catch (error) {
    toast(errorText(error), 'error')
  }
}

async function install() {
  installing = true
  renderStatus()
  $('s-selfclip-status').textContent = 'Lade ffmpeg herunter …'
  try {
    status = await backend.selfClipInstall()
    toast('FIB Self-Clip ist eingerichtet und nimmt jetzt im Hintergrund auf.')
  } catch (error) {
    toast(errorText(error), 'error')
  } finally {
    installing = false
    // Der Start der Aufnahme läuft im Hintergrund weiter – kurz danach erneut fragen.
    window.setTimeout(() => void refresh(), 1500)
    renderStatus()
  }
}

export function initSelfClip() {
  $('s-selfclip-install').addEventListener('click', () => void install())
  $('s-selfclip-restart').addEventListener('click', () => {
    void backend.selfClipRestart().then(() => window.setTimeout(() => void refresh(), 1500))
  })
  $('s-selfclip-buffer').addEventListener('change', () => {
    const seconds = Number(($('s-selfclip-buffer') as DropdownElement).value)
    if (seconds && seconds !== config().bufferSeconds) void save({ bufferSeconds: seconds })
  })
  $('s-selfclip-quality').addEventListener('change', () => {
    const [bitrate, fps] = String(($('s-selfclip-quality') as DropdownElement).value ?? '').split(':').map(Number)
    const c = config()
    if (bitrate && fps && (bitrate !== c.bitrateMbps || fps !== c.fps)) void save({ bitrateMbps: bitrate, fps })
  })
  $('s-selfclip-audio').addEventListener('change', () =>
    void save({ audio: ($('s-selfclip-audio') as HTMLElement & { checked: boolean }).checked }),
  )

  void listen<{ received: number; total: number }>('selfclip-install', (event) => {
    const { received, total } = event.payload
    const bar = $('s-selfclip-progress') as HTMLElement & { value?: number; max?: number }
    bar.max = 100
    bar.value = Math.round((received / total) * 100)
    $('s-selfclip-status').textContent = `Lade ffmpeg herunter … ${formatBytes(received)} von ${formatBytes(total)}`
  })
  void listen<SelfClipStatus>('selfclip-status', (event) => {
    status = event.payload
    renderStatus()
  })
}

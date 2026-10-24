import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import {
  backend,
  errorText,
  UNAUTHORIZED,
  type ClipInfo,
  type Clipper,
  type SessionContext,
  type Settings,
  type SettingsView,
  type UploadProgress,
} from './backend'
import { clipTitle, displayHotkey, formatBytes, formatDateTime, formatDuration } from './format'
import { hotkeyInput } from './hotkey-input'

type ValueElement = HTMLElement & { value: string }
type DropdownElement = HTMLElement & { value: string | null }
type ButtonElement = HTMLElement & { disabled: boolean }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

let context: SessionContext | null = null
let settingsView: SettingsView | null = null
const queue: ClipInfo[] = []
let uploading = false

// ── Hilfen ───────────────────────────────────────────────────────────

function showMessage(id: string, text: string | null) {
  const bar = $(id)
  bar.textContent = text ?? ''
  bar.hidden = !text
}

function fillOptions(listId: string, options: { id: string; label: string }[]) {
  const list = $(listId)
  list.replaceChildren(
    ...options.map(({ id, label }) => {
      const option = document.createElement('fluent-option')
      option.setAttribute('value', id)
      option.textContent = label
      return option
    }),
  )
}

/** Wert erst setzen, wenn die neu eingefügten Optionen verbunden sind. */
function selectValue(dropdown: DropdownElement, value: string | null | undefined) {
  if (!value) return
  requestAnimationFrame(() => {
    dropdown.value = value
  })
}

// ── Ansichten ────────────────────────────────────────────────────────

function showView(view: 'login' | 'main') {
  $('view-login').hidden = view !== 'login'
  $('view-main').hidden = view !== 'main'
}

async function enterApp() {
  try {
    context = await backend.sessionContext()
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) return showLogin()
    showView('main')
    showMessage('capture-error', `Dashboard nicht erreichbar: ${errorText(error)}`)
    return
  }
  $('account-name').textContent = context.user.displayName
  $('permission-warning').hidden = context.canUpload
  ;($('capture-button') as ButtonElement).disabled = !context.canUpload
  ;($('pick-button') as ButtonElement).disabled = !context.canUpload

  // Eigene Akten zuerst – die braucht man fast immer.
  const investigations = [...context.investigations].sort((a, b) => Number(b.mine) - Number(a.mine))
  fillOptions('f-investigation-list', investigations.map((i) => ({ id: i.id, label: i.mine ? `★ ${i.label}` : i.label })))
  fillOptions('f-agent-list', context.agents)
  showMessage('capture-error', null)
  showView('main')
  if (queue.length) renderClip()
}

function showLogin() {
  context = null
  showView('login')
}

async function login() {
  const button = $('login-button') as ButtonElement
  button.disabled = true
  $('login-waiting').hidden = false
  showMessage('login-error', null)
  try {
    await backend.login()
    await enterApp()
  } catch (error) {
    showMessage('login-error', errorText(error))
  } finally {
    button.disabled = false
    $('login-waiting').hidden = true
  }
}

// ── Einstellungen ────────────────────────────────────────────────────

const bodycamHotkey = hotkeyInput($<ValueElement>('s-bodycam-hotkey'), {
  onChange: (hotkey) => updateSettings({ bodycamHotkey: hotkey }),
})
const clipperHotkey = hotkeyInput($<ValueElement>('s-clipper-hotkey'), {
  optional: true,
  placeholder: () => `Standard: ${displayHotkey(settingsView?.defaultClipperHotkey ?? '')}`,
  onChange: (hotkey) => updateSettings({ clipperHotkey: hotkey }),
})

function renderSettings(view: SettingsView) {
  settingsView = view
  const { settings } = view
  ;($('s-clipper') as DropdownElement).value = settings.clipper
  bodycamHotkey.set(settings.bodycamHotkey)
  clipperHotkey.set(settings.clipperHotkey)
  const dir = $<ValueElement>('s-clip-dir')
  dir.value = settings.clipDir
  dir.setAttribute('placeholder', view.defaultClipDir)
  renderCaptureIdle()
}

async function updateSettings(patch: Partial<Settings>) {
  if (!settingsView) return
  try {
    renderSettings(await backend.saveSettings({ ...settingsView.settings, ...patch }))
    showMessage('settings-error', null)
  } catch (error) {
    showMessage('settings-error', errorText(error))
    renderSettings(settingsView)
  }
}

// ── Aufnahme ─────────────────────────────────────────────────────────

function renderCaptureIdle() {
  if (!settingsView) return
  const program = settingsView.settings.clipper === 'nvidia' ? 'NVIDIA' : 'Medal'
  $('capture-title').textContent = 'Bereit'
  $('capture-hint').textContent =
    `Drücke ${displayHotkey(settingsView.settings.bodycamHotkey)} im Spiel – ${program} speichert den Clip, danach kannst du ihn hier hochladen.`
}

function addClip(clip: ClipInfo) {
  if (queue.some((queued) => queued.path === clip.path)) return
  queue.push(clip)
  showMessage('upload-success', null)
  renderClip()
}

function renderClip() {
  const clip = queue[0]
  $('clip-card').hidden = !clip
  if (!clip) return

  const preview = $('clip-preview') as HTMLVideoElement
  const source = convertFileSrc(clip.path)
  if (preview.getAttribute('src') !== source) preview.src = source

  const recordedAt = new Date(clip.savedAt - (clip.durationSeconds ?? 0) * 1000)
  $('clip-duration').textContent = formatDuration(clip.durationSeconds)
  $('clip-recorded').textContent = formatDateTime(recordedAt)
  $('clip-size').textContent = formatBytes(clip.sizeBytes)
  $('clip-name').textContent = clip.name
  $('clip-name').title = clip.path
  $('clip-queue-row').hidden = queue.length < 2
  $('clip-queue').textContent = `${queue.length - 1} weitere${queue.length === 2 ? 'r Clip' : ' Clips'}`

  $<ValueElement>('f-title').value = clipTitle(recordedAt)
  $<ValueElement>('f-location').value = ''
  $<ValueElement>('f-tags').value = ''
  $<ValueElement>('f-description').value = ''
  selectValue($<DropdownElement>('f-agent'), context?.ownAgent?.id)
  const lastInvestigation = settingsView?.settings.lastInvestigationId
  if (context?.investigations.some((i) => i.id === lastInvestigation)) {
    selectValue($<DropdownElement>('f-investigation'), lastInvestigation)
  }
  showMessage('upload-error', null)
}

async function pickClip() {
  const path = await open({
    multiple: false,
    directory: false,
    defaultPath: settingsView?.settings.clipDir || settingsView?.defaultClipDir,
    filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm'] }],
  })
  if (typeof path !== 'string') return
  try {
    addClip(await backend.inspectClip(path))
  } catch (error) {
    showMessage('capture-error', errorText(error))
  }
}

// ── Upload ───────────────────────────────────────────────────────────

let progressStartedAt = 0
let progressStartBytes = 0

function renderProgress(progress: UploadProgress) {
  const percent = progress.totalBytes ? Math.round((progress.sentBytes / progress.totalBytes) * 100) : 0
  ;($('upload-progress') as HTMLElement & { value: number }).value = percent
  if (progress.phase === 'finishing') {
    $('upload-progress-text').textContent = 'Wird im Dashboard abgelegt …'
    return
  }
  if (!progressStartedAt) {
    progressStartedAt = Date.now()
    progressStartBytes = progress.sentBytes
  }
  const seconds = (Date.now() - progressStartedAt) / 1000
  const rate = seconds > 0.5 ? (progress.sentBytes - progressStartBytes) / seconds : 0
  const rateText = rate > 0 ? ` · ${formatBytes(rate)}/s` : ''
  $('upload-progress-text').textContent = `${percent} % von ${formatBytes(progress.totalBytes)}${rateText}`
}

function setUploading(active: boolean) {
  uploading = active
  $('upload-progress-row').hidden = !active
  $('cancel-upload-button').hidden = !active
  $('discard-button').hidden = active
  ;($('upload-button') as ButtonElement).disabled = active
  progressStartedAt = 0
}

async function upload() {
  const clip = queue[0]
  if (!clip || uploading) return
  const investigationId = $<DropdownElement>('f-investigation').value
  const title = $<ValueElement>('f-title').value.trim()
  if (!investigationId) return showMessage('upload-error', 'Bitte eine Ermittlungsakte auswählen.')
  if (!title) return showMessage('upload-error', 'Bitte einen Titel angeben.')

  const recordedAt = new Date(clip.savedAt - (clip.durationSeconds ?? 0) * 1000)
  const text = (id: string) => $<ValueElement>(id).value.trim() || null
  showMessage('upload-error', null)
  setUploading(true)
  try {
    await backend.uploadClip(clip.path, {
      investigationId,
      title,
      description: text('f-description'),
      location: text('f-location'),
      recordedAt: recordedAt.toISOString(),
      recordedByAgentId: $<DropdownElement>('f-agent').value || null,
      durationSeconds: clip.durationSeconds,
      tags: $<ValueElement>('f-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean),
    })
    void backend.rememberInvestigation(investigationId)
    if (settingsView) settingsView.settings.lastInvestigationId = investigationId
    const caseLabel = context?.investigations.find((i) => i.id === investigationId)?.label ?? 'die Akte'
    queue.shift()
    renderClip()
    showMessage('upload-success', `„${title}“ wurde in ${caseLabel} hochgeladen.`)
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) return showLogin()
    showMessage('upload-error', errorText(error))
  } finally {
    setUploading(false)
  }
}

// ── Start ────────────────────────────────────────────────────────────

export async function startApp() {
  $('login-button').addEventListener('click', login)
  $('logout-button').addEventListener('click', async () => {
    await backend.logout()
    showLogin()
  })
  $('capture-button').addEventListener('click', () => backend.captureClip())
  $('pick-button').addEventListener('click', pickClip)
  $('upload-button').addEventListener('click', upload)
  $('cancel-upload-button').addEventListener('click', () => backend.cancelUpload())
  $('discard-button').addEventListener('click', () => {
    queue.shift()
    renderClip()
  })
  $('s-clipper').addEventListener('change', () => {
    const clipper = $<DropdownElement>('s-clipper').value as Clipper | null
    // Ordner und Taste gehören zum jeweiligen Programm – beim Wechsel auf dessen Standard.
    if (clipper && clipper !== settingsView?.settings.clipper) void updateSettings({ clipper, clipDir: '', clipperHotkey: '' })
  })
  $('s-clip-dir').addEventListener('change', () => updateSettings({ clipDir: $<ValueElement>('s-clip-dir').value.trim() }))
  $('s-clip-dir-browse').addEventListener('click', async () => {
    const dir = await open({ directory: true, defaultPath: settingsView?.settings.clipDir || settingsView?.defaultClipDir })
    if (typeof dir === 'string') void updateSettings({ clipDir: dir })
  })

  await listen<ClipInfo>('clip-ready', (event) => {
    renderCaptureIdle()
    addClip(event.payload)
  })
  await listen<{ state: 'saving' | 'error'; message?: string }>('capture-status', (event) => {
    if (event.payload.state === 'saving') {
      showMessage('capture-error', null)
      $('capture-title').textContent = 'Clip wird gespeichert …'
      $('capture-hint').textContent = 'Warte auf die Datei vom Clip-Programm.'
    } else {
      renderCaptureIdle()
      showMessage('capture-error', event.payload.message ?? 'Clip konnte nicht gespeichert werden.')
    }
  })
  await listen<UploadProgress>('upload-progress', (event) => renderProgress(event.payload))

  renderSettings(await backend.getSettings())
  if (await backend.isSignedIn()) await enterApp()
  else showLogin()
}
